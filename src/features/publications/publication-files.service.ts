import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { Model, Types } from 'mongoose';
import { Readable } from 'stream';
import { AccessRequestStatus, FileAccessMode } from 'src/common/enums/file-access.enum';
import { FileStorage } from 'src/common/storage/file-storage';
import { Publication, PublicationFile } from './schemas/publication.schema';
import { FileAccessRequest } from './schemas/file-access-request.schema';
import { User } from '../users/schema/user.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification-type.enum';
import { PublicationsService } from './publications.service';
import { ALLOWED_EXTENSIONS, detectFileType } from './file-signature.util';
import {
  DecideFileAccessDto,
  RequestFileAccessDto,
  UpdatePublicationFileDto,
  UploadPublicationFileDto,
} from './dto/publication-file.dto';

const USER_CARD_FIELDS = 'firstName lastName username profilePhotoUrl';
const MAX_FILES_PER_PUBLICATION = 20;

/** Public shape of a file: never exposes where it is stored. */
type FileView = Omit<PublicationFile, 'storageKey'> & {
  _id: Types.ObjectId;
  canDownload: boolean;
  /** The viewer's own access request for this file, if any. */
  request: { _id: Types.ObjectId; status: AccessRequestStatus } | null;
};

@Injectable()
export class PublicationFilesService {
  private readonly logger = new Logger(PublicationFilesService.name);
  readonly maxFileBytes: number;

  constructor(
    @InjectModel(Publication.name) private publicationModel: Model<Publication>,
    @InjectModel(FileAccessRequest.name) private requestModel: Model<FileAccessRequest>,
    @InjectModel(User.name) private userModel: Model<User>,
    private publicationsService: PublicationsService,
    private notificationsService: NotificationsService,
    private storage: FileStorage,
    config: ConfigService,
  ) {
    this.maxFileBytes = Number(config.get('MAX_FILE_SIZE_MB') ?? 50) * 1024 * 1024;
  }

  // ---------------- UPLOADER: UPLOAD / EDIT / DELETE ----------------

  async upload(
    me: string,
    publicationId: string,
    file: Express.Multer.File | undefined,
    dto: UploadPublicationFileDto,
  ) {
    await this.publicationsService.findOwned(me, publicationId);
    if (!file) throw new BadRequestException('No file received (send it as the "file" field).');

    const type = detectFileType(file.originalname, file.buffer);
    if (!type) {
      throw new BadRequestException(
        `Only ${ALLOWED_EXTENSIONS.join(', ')} files are accepted, and the content must match the extension.`,
      );
    }

    const current = await this.publicationModel.findById(publicationId).select('files').lean();
    if ((current?.files.length ?? 0) >= MAX_FILES_PER_PUBLICATION) {
      throw new BadRequestException(`A publication can have at most ${MAX_FILES_PER_PUBLICATION} files.`);
    }

    const storageKey = `publications/${publicationId}/${randomUUID()}${type.ext}`;
    await this.storage.save(storageKey, file.buffer);

    const entry = {
      _id: new Types.ObjectId(),
      role: dto.role ?? type.defaultRole,
      name: this.cleanName(file.originalname),
      mimeType: type.mimeType,
      size: file.size,
      storageKey,
      version: dto.version,
      embargoUntil: dto.embargoUntil ? new Date(dto.embargoUntil) : undefined,
      accessMode: dto.accessMode ?? FileAccessMode.PUBLIC,
      uploadedAt: new Date(),
    };

    try {
      await this.publicationModel.updateOne({ _id: publicationId }, { $push: { files: entry } });
    } catch (err) {
      await this.storage.delete(storageKey); // do not leave an orphan on disk
      throw err;
    }
    return this.toView(entry, true, null);
  }

  async update(me: string, publicationId: string, fileId: string, dto: UpdatePublicationFileDto) {
    await this.publicationsService.findOwned(me, publicationId);
    const file = await this.findFile(publicationId, fileId);

    const set: Record<string, unknown> = {};
    const unset: Record<string, 1> = {};
    if (dto.role) set['files.$.role'] = dto.role;
    if (dto.accessMode) set['files.$.accessMode'] = dto.accessMode;
    if (dto.version) set['files.$.version'] = dto.version;
    if (dto.embargoUntil === '') unset['files.$.embargoUntil'] = 1;
    else if (dto.embargoUntil) set['files.$.embargoUntil'] = new Date(dto.embargoUntil);
    if (!Object.keys(set).length && !Object.keys(unset).length) {
      throw new BadRequestException('Nothing to update.');
    }

    await this.publicationModel.updateOne(
      { _id: publicationId, 'files._id': fileId },
      {
        ...(Object.keys(set).length && { $set: set }),
        ...(Object.keys(unset).length && { $unset: unset }),
      },
      { runValidators: true },
    );

    // nobody can ask for (or keep waiting on) a file that became uploader-only
    if (dto.accessMode === FileAccessMode.RESTRICTED && file.accessMode !== FileAccessMode.RESTRICTED) {
      await this.requestModel.updateMany(
        { fileId, status: AccessRequestStatus.PENDING },
        { $set: { status: AccessRequestStatus.REJECTED, decidedAt: new Date() } },
      );
    }

    const fresh = await this.findFile(publicationId, fileId);
    return this.toView(fresh, true, null);
  }

  async remove(me: string, publicationId: string, fileId: string) {
    await this.publicationsService.findOwned(me, publicationId);
    const file = await this.findFile(publicationId, fileId);

    await this.publicationModel.updateOne({ _id: publicationId }, { $pull: { files: { _id: fileId } } });
    await this.requestModel.deleteMany({ fileId });
    await this.storage.delete(file.storageKey);
    return { deleted: true };
  }

  // ---------------- VIEWER: LIST / DOWNLOAD ----------------

  /** Files of a publication, each with "can I download it?" and my request status. */
  async list(me: string, publicationId: string): Promise<FileView[]> {
    await this.publicationsService.assertCanView(me, publicationId);
    const pub = await this.publicationModel.findById(publicationId).select('uploadedBy files').lean();
    if (!pub) throw new NotFoundException('Publication not found.');

    const isOwner = String(pub.uploadedBy) === me;
    const requests = isOwner
      ? []
      : await this.requestModel
          .find({ publication: publicationId, requester: me })
          .select('fileId status')
          .lean();
    const byFile = new Map(requests.map((r) => [String(r.fileId), r]));

    return pub.files.map((f) => {
      const req = byFile.get(String((f as unknown as { _id: Types.ObjectId })._id)) ?? null;
      return this.toView(
        f,
        isOwner || this.canAccess(f, req?.status),
        req ? { _id: req._id as Types.ObjectId, status: req.status } : null,
      );
    });
  }

  /** Checks access and opens the stream. The controller sets the headers. */
  async download(me: string, publicationId: string, fileId: string) {
    await this.publicationsService.assertCanView(me, publicationId);
    const pub = await this.publicationModel.findById(publicationId).select('uploadedBy files').lean();
    if (!pub) throw new NotFoundException('Publication not found.');
    const file = this.pickFile(pub.files, fileId);

    const isOwner = String(pub.uploadedBy) === me;
    if (!isOwner) {
      const req = await this.requestModel
        .findOne({ fileId, requester: me })
        .select('status')
        .lean();
      if (!this.canAccess(file, req?.status)) {
        throw new ForbiddenException(this.denialReason(file));
      }
      void this.publicationModel
        .updateOne({ _id: publicationId }, { $inc: { 'metrics.downloads': 1 } })
        .exec()
        .catch(() => undefined);
    }

    const stream: Readable = await this.storage.read(file.storageKey);
    return { stream, name: file.name, mimeType: file.mimeType, size: file.size };
  }

  // ---------------- REQUESTER: ASK FOR ACCESS ----------------

  async requestAccess(me: string, publicationId: string, fileId: string, dto: RequestFileAccessDto) {
    await this.publicationsService.assertCanView(me, publicationId);
    const pub = await this.publicationModel
      .findById(publicationId)
      .select('uploadedBy files title')
      .lean();
    if (!pub) throw new NotFoundException('Publication not found.');
    const file = this.pickFile(pub.files, fileId);

    if (String(pub.uploadedBy) === me) throw new BadRequestException('This is your own file.');
    if (file.accessMode === FileAccessMode.PUBLIC) {
      throw new BadRequestException('This file is public; you can download it directly.');
    }
    if (file.accessMode === FileAccessMode.RESTRICTED) {
      throw new ForbiddenException('The uploader does not accept access requests for this file.');
    }

    const existing = await this.requestModel.findOne({ fileId, requester: me });
    if (existing && existing.status !== AccessRequestStatus.REJECTED) {
      return existing.toObject(); // already pending or approved: idempotent
    }

    // first request, or asking again after a rejection
    const request = await this.requestModel.findOneAndUpdate(
      { fileId, requester: me },
      {
        $set: {
          publication: publicationId,
          owner: pub.uploadedBy,
          publicationTitle: pub.title,
          fileName: file.name,
          message: dto.message?.trim() || undefined,
          status: AccessRequestStatus.PENDING,
          decidedAt: null,
        },
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );

    const name = await this.displayName(me);
    await this.notificationsService.create({
      recipientId: pub.uploadedBy,
      actorId: me,
      type: NotificationType.FILE_ACCESS_REQUEST,
      message: `${name} requested access to "${file.name}"`,
      entityType: 'publication',
      entityId: publicationId,
      data: { fileId, requestId: String(request._id), publicationTitle: pub.title },
    });
    return request.toObject();
  }

  /** Requester withdraws their own request. */
  async cancelRequest(me: string, requestId: string) {
    this.assertId(requestId);
    const res = await this.requestModel.deleteOne({ _id: requestId, requester: me });
    if (!res.deletedCount) throw new NotFoundException('Request not found.');
    return { deleted: true };
  }

  // ---------------- UPLOADER: INBOX & DECISION ----------------

  /** Requests for my files. GET ?status=pending to build the "to review" list. */
  async incoming(
    me: string,
    status: AccessRequestStatus | undefined,
    page: number,
    limit: number,
    skip: number,
  ) {
    const filter = { owner: me, ...(status && { status }) };
    return this.pageRequests(filter, 'requester', page, limit, skip);
  }

  /** Requests I made, with their current status. */
  async mine(me: string, page: number, limit: number, skip: number) {
    return this.pageRequests({ requester: me }, 'owner', page, limit, skip);
  }

  /** Approve or reject. Can be changed later (e.g. revoke an approval). */
  async decide(me: string, requestId: string, dto: DecideFileAccessDto) {
    this.assertId(requestId);
    const request = await this.requestModel.findById(requestId);
    if (!request) throw new NotFoundException('Request not found.');
    if (String(request.owner) !== me) {
      throw new ForbiddenException('Only the uploader can answer this request.');
    }

    const status =
      dto.decision === 'approve' ? AccessRequestStatus.APPROVED : AccessRequestStatus.REJECTED;
    if (request.status === status) return request.toObject();

    request.status = status;
    request.decidedAt = new Date();
    await request.save();

    const approved = status === AccessRequestStatus.APPROVED;
    await this.notificationsService.create({
      recipientId: request.requester,
      actorId: me,
      type: approved ? NotificationType.FILE_ACCESS_APPROVED : NotificationType.FILE_ACCESS_REJECTED,
      message: approved
        ? `Your request for "${request.fileName}" was approved`
        : `Your request for "${request.fileName}" was declined`,
      entityType: 'publication',
      entityId: request.publication,
      data: { fileId: String(request.fileId), requestId, publicationTitle: request.publicationTitle },
    });
    return request.toObject();
  }

  // ---------------- CALLED BY PublicationsService ----------------

  /** Deletes every stored file of a publication (when the publication is deleted). */
  async purge(publicationId: string, files: { storageKey: string }[]) {
    await Promise.all(
      files.map((f) =>
        this.storage.delete(f.storageKey).catch((e) => this.logger.warn(`Could not delete ${f.storageKey}: ${e}`)),
      ),
    );
    await this.requestModel.deleteMany({ publication: publicationId });
  }

  // ---------------- HELPERS ----------------

  /** The access rule for non-owners. */
  private canAccess(file: PublicationFile, requestStatus?: AccessRequestStatus): boolean {
    if (file.embargoUntil && file.embargoUntil > new Date()) return false;
    switch (file.accessMode) {
      case FileAccessMode.PUBLIC:
        return true;
      case FileAccessMode.APPROVAL_BASED:
        return requestStatus === AccessRequestStatus.APPROVED;
      default:
        return false;
    }
  }

  private denialReason(file: PublicationFile): string {
    if (file.embargoUntil && file.embargoUntil > new Date()) {
      return `This file is under embargo until ${file.embargoUntil.toISOString().slice(0, 10)}.`;
    }
    return file.accessMode === FileAccessMode.APPROVAL_BASED
      ? 'You need the uploader\'s approval to download this file. Request access first.'
      : 'This file is only available to the uploader.';
  }

  private async pageRequests(
    filter: Record<string, unknown>,
    populate: 'requester' | 'owner',
    page: number,
    limit: number,
    skip: number,
  ) {
    const [data, total] = await Promise.all([
      this.requestModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate(populate, USER_CARD_FIELDS)
        .lean(),
      this.requestModel.countDocuments(filter),
    ]);
    return { data, total, page, limit };
  }

  private async findFile(publicationId: string, fileId: string) {
    this.assertId(fileId);
    const pub = await this.publicationModel.findById(publicationId).select('files').lean();
    if (!pub) throw new NotFoundException('Publication not found.');
    return this.pickFile(pub.files, fileId);
  }

  private pickFile(files: PublicationFile[], fileId: string) {
    this.assertId(fileId);
    const file = files.find((f) => String((f as unknown as { _id: Types.ObjectId })._id) === fileId);
    if (!file) throw new NotFoundException('File not found.');
    return file;
  }

  private toView(
    f: PublicationFile & { _id?: Types.ObjectId },
    canDownload: boolean,
    request: FileView['request'],
  ): FileView {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { storageKey, ...safe } = f as PublicationFile & { _id: Types.ObjectId };
    return { ...safe, canDownload, request };
  }

  private async displayName(userId: string) {
    const u = await this.userModel.findById(userId).select('firstName lastName').lean();
    return u ? `${u.firstName} ${u.lastName}` : 'Someone';
  }

  /** Keep the display name only: no path parts, no control characters. */
  private cleanName(name: string) {
    // eslint-disable-next-line no-control-regex
    return name.split(/[\\/]/).pop()!.replace(/[\x00-\x1f]/g, '').slice(0, 200) || 'file';
  }

  private assertId(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid id.');
  }
}
