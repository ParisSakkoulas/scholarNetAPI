import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { Model, Types } from 'mongoose';
import { FileStorage } from '../../common/storage/file-storage';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification-type.enum';
import { Milestone } from './schemas/milestone.schema';
import { Meeting } from './schemas/meeting.schema';
import { ThesisDocument, DocumentStatus } from './schemas/thesis-document.schema';
import { DocumentVersion } from './schemas/document-version.schema';
import { DocumentComment } from './schemas/document-comment.schema';
import { SupervisionAccess } from './guards/supervision-access.guard';
import { DOCUMENT_EXTENSIONS, decodeUploadName, detectDocumentType } from './document-file.util';
import { InvalidEditorContent, sanitizeEditorContent } from './editor-content.util';
import {
  CreateCommentDto,
  CreateDocumentDto,
  CreateWorkspaceDto,
  ResolveCommentDto,
  SaveDraftDto,
  UpdateDocumentStatusDto,
  UploadVersionDto,
} from './dto/thesis-document.dto';

const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };

const USER_FIELDS = 'username firstName lastName profilePhotoUrl';

@Injectable()
export class ThesisDocumentsService {
  readonly maxFileBytes: number;

  constructor(
    @InjectModel(ThesisDocument.name) private documentModel: Model<ThesisDocument>,
    @InjectModel(DocumentVersion.name) private versionModel: Model<DocumentVersion>,
    @InjectModel(DocumentComment.name) private commentModel: Model<DocumentComment>,
    @InjectModel(Milestone.name) private milestoneModel: Model<Milestone>,
    @InjectModel(Meeting.name) private meetingModel: Model<Meeting>,
    private notifications: NotificationsService,
    private storage: FileStorage,
    config: ConfigService,
  ) {
    this.maxFileBytes = Number(config.get('THESIS_DOC_MAX_MB') ?? 25) * 1024 * 1024;
  }

  // ---------------- DOCUMENTS ----------------

  async create(access: SupervisionAccess, dto: CreateDocumentDto) {
    const supervisionId = access.supervision._id;

    if (dto.milestoneId && !(await this.milestoneModel.exists({ _id: dto.milestoneId, supervisionId }))) {
      throw new BadRequestException('Milestone not found in this supervision.');
    }
    if (dto.meetingId && !(await this.meetingModel.exists({ _id: dto.meetingId, supervisionId }))) {
      throw new BadRequestException('Meeting not found in this supervision.');
    }

    return this.documentModel.create({
      supervisionId,
      milestoneId: dto.milestoneId ?? null,
      meetingId: dto.meetingId ?? null,
      title: dto.title,
      mode: 'upload',
      createdBy: access.userId,
    });
  }

  list(access: SupervisionAccess, filter: { milestoneId?: string; meetingId?: string }) {
    return this.documentModel
      .find({
        supervisionId: access.supervision._id,
        ...(filter.milestoneId && Types.ObjectId.isValid(filter.milestoneId)
          ? { milestoneId: filter.milestoneId }
          : {}),
        ...(filter.meetingId && Types.ObjectId.isValid(filter.meetingId)
          ? { meetingId: filter.meetingId }
          : {}),
      })
      .sort({ updatedAt: -1 })
      .lean();
  }

  /** The document with its version list (newest first) and the count of open comment threads. */
  async get(access: SupervisionAccess, docId: string) {
    const doc = await this.findOrFail(access, docId);
    const [versions, openThreads] = await Promise.all([
      this.versionModel
        .find({ documentId: doc._id })
        .sort({ number: -1 })
        .populate('createdBy', USER_FIELDS)
        .lean(),
      this.commentModel.countDocuments({ documentId: doc._id, parentId: null, status: 'open' }),
    ]);
    return { ...doc.toObject(), role: access.role, versions, openThreads };
  }

  async setStatus(access: SupervisionAccess, docId: string, dto: UpdateDocumentStatusDto) {
    const doc = await this.findOrFail(access, docId);
    const from = doc.status;
    const to = dto.status;
    if (from === to) return doc;

    // student: draft | changes_requested -> ready_for_review.
    // supervisor: ready_for_review -> reviewed | changes_requested
    const allowed =
      access.role === 'student'
        ? (from === 'draft' || from === 'changes_requested') && to === 'ready_for_review'
        : from === 'ready_for_review' && (to === 'reviewed' || to === 'changes_requested');
    if (!allowed) {
      throw new ForbiddenException(`You cannot move this document from "${from}" to "${to}".`);
    }
    if (to === 'ready_for_review' && doc.mode === 'upload' && doc.currentVersion < 1) {
      throw new BadRequestException('Upload a version before asking for a review.');
    }

    doc.status = to;
    await doc.save();
    await this.notifyStatus(access, doc, to);
    return doc;
  }

  // ---------------- CO-WORKING DOCUMENT (editor mode, one per supervision) ----------------

  /** The supervision co-working document, or null while the student has not started it. */
  async getWorkspace(access: SupervisionAccess) {
    return this.documentModel
      .findOne({ supervisionId: access.supervision._id, mode: 'editor' })
      .lean();
  }

  async createWorkspace(access: SupervisionAccess, dto: CreateWorkspaceDto) {
    this.assertStudent(access, 'Only the student can start the co-working document.');
    try {
      return await this.documentModel.create({
        supervisionId: access.supervision._id,
        title: dto.title ?? 'Co-working document',
        mode: 'editor',
        createdBy: access.userId,
        draftContent: EMPTY_DOC,
        draftUpdatedAt: new Date(),
      });
    } catch (err) {
      // the partial unique index: this supervision already has one
      if ((err as { code?: number }).code === 11000) {
        throw new ConflictException('This supervision already has a co-working document.');
      }
      throw err;
    }
  }

  /** The live working copy. Supervisors poll this to follow the progress. */
  async getDraft(access: SupervisionAccess, docId: string) {
    const doc = await this.findEditorDoc(access, docId, true);
    return {
      content: doc.draftContent ?? EMPTY_DOC,
      revision: doc.draftRevision,
      updatedAt: doc.draftUpdatedAt ?? null,
    };
  }

  /** Autosave. Rejected when another tab saved first, so one tab never silently overwrites the other. */
  async saveDraft(access: SupervisionAccess, docId: string, dto: SaveDraftDto) {
    this.assertStudent(access, 'Only the student can edit the document.');
    await this.findEditorDoc(access, docId);
    const content = this.cleanContent(dto.content);

    const updated = await this.documentModel
      .findOneAndUpdate(
        { _id: docId, supervisionId: access.supervision._id, draftRevision: dto.baseRevision },
        { $set: { draftContent: content, draftUpdatedAt: new Date() }, $inc: { draftRevision: 1 } },
        { new: true },
      )
      .select('draftRevision draftUpdatedAt');
    if (!updated) {
      throw new ConflictException('The document was changed somewhere else. Reload to continue.');
    }
    return { revision: updated.draftRevision, updatedAt: updated.draftUpdatedAt };
  }

  /** "Save version": freezes the current draft as the next numbered version. */
  async saveEditorVersion(access: SupervisionAccess, docId: string, dto: UploadVersionDto) {
    this.assertStudent(access, 'Only the student can save versions.');
    const doc = await this.findEditorDoc(access, docId, true);

    const bumped = await this.documentModel.findByIdAndUpdate(
      doc._id,
      { $inc: { currentVersion: 1 }, $set: { status: 'draft' } },
      { new: true },
    );
    const version = await this.versionModel.create({
      documentId: doc._id,
      number: bumped!.currentVersion,
      note: dto.note ?? '',
      createdBy: access.userId,
      content: doc.draftContent ?? EMPTY_DOC,
    });
    const { content: _omit, ...view } = version.toObject();
    return view;
  }

  async versionContent(access: SupervisionAccess, docId: string, number: string) {
    const doc = await this.findEditorDoc(access, docId);
    const n = Number(number);
    if (!Number.isInteger(n) || n < 1) throw new NotFoundException('Version not found.');
    const version = await this.versionModel.findOne({ documentId: doc._id, number: n }).lean();
    if (!version?.content) throw new NotFoundException('Version not found.');
    return { number: n, content: version.content };
  }

  // ---------------- VERSIONS ----------------

  async uploadVersion(
    access: SupervisionAccess,
    docId: string,
    file: Express.Multer.File | undefined,
    dto: UploadVersionDto,
  ) {
    const doc = await this.findOrFail(access, docId);
    if (doc.mode !== 'upload') throw new BadRequestException('This document is edited in the editor.');
    if (!file) throw new BadRequestException('No file received (send it as the "file" field).');
    if (file.size > this.maxFileBytes) {
      throw new BadRequestException(`The file is larger than ${Math.round(this.maxFileBytes / 1048576)} MB.`);
    }

    const type = detectDocumentType(file.originalname, file.buffer);
    if (!type) {
      throw new BadRequestException(
        `Only ${DOCUMENT_EXTENSIONS.join(', ')} files are accepted, and the content must match the extension.`,
      );
    }

    const storageKey = `thesis-documents/${doc._id}/${randomUUID()}${type.ext}`;
    await this.storage.save(storageKey, file.buffer);

    try {
      // the atomic increment hands every upload its own number, even for parallel requests;
      // a failed insert below can leave a gap in the numbers but never a duplicate
      const bumped = await this.documentModel.findByIdAndUpdate(
        doc._id,
        {
          $inc: { currentVersion: 1 },
          // new work from the student starts over; a supervisor's reviewed copy leaves the status alone
          ...(access.role === 'student' ? { $set: { status: 'draft' } } : {}),
        },
        { new: true },
      );
      const version = await this.versionModel.create({
        documentId: doc._id,
        number: bumped!.currentVersion,
        note: dto.note ?? '',
        createdBy: access.userId,
        byRole: access.role,
        storageKey,
        fileName: this.cleanName(file.originalname),
        mimeType: type.mimeType,
        size: file.size,
      });
      if (access.role === 'supervisor') {
        await this.notify(
          access,
          [access.supervision.studentId],
          NotificationType.DOCUMENT_REVIEWED,
          `A reviewed copy of "${doc.title}" was uploaded`,
          doc,
        );
      }
      const { storageKey: _omit, ...view } = version.toObject();
      return view;
    } catch (err) {
      await this.storage.delete(storageKey); // do not leave an orphan on disk
      throw err;
    }
  }

  async openVersionFile(access: SupervisionAccess, docId: string, number: string) {
    const doc = await this.findOrFail(access, docId);
    const n = Number(number);
    if (!Number.isInteger(n) || n < 1) throw new NotFoundException('Version not found.');

    const version = await this.versionModel
      .findOne({ documentId: doc._id, number: n })
      .select('+storageKey')
      .lean();
    if (!version?.storageKey) throw new NotFoundException('Version not found.');

    return {
      stream: await this.storage.read(version.storageKey),
      name: version.fileName ?? `${doc.title}-v${n}`,
      mimeType: version.mimeType ?? 'application/octet-stream',
      size: version.size ?? 0,
    };
  }

  // ---------------- COMMENTS ----------------

  async listComments(
    access: SupervisionAccess,
    docId: string,
    filter: { versionId?: string; status?: string },
  ) {
    const doc = await this.findOrFail(access, docId);
    // the filters apply to threads; replies always come along with their thread
    const roots = await this.commentModel
      .find({
        documentId: doc._id,
        parentId: null,
        ...(filter.versionId && Types.ObjectId.isValid(filter.versionId)
          ? { versionId: filter.versionId }
          : {}),
        ...(filter.status === 'open' || filter.status === 'resolved' ? { status: filter.status } : {}),
      })
      .sort({ createdAt: 1 })
      .populate('authorId', USER_FIELDS)
      .lean();

    const replies = roots.length
      ? await this.commentModel
          .find({ documentId: doc._id, parentId: { $in: roots.map((r) => r._id) } })
          .sort({ createdAt: 1 })
          .populate('authorId', USER_FIELDS)
          .lean()
      : [];

    return roots.map((root) => ({
      ...root,
      replies: replies.filter((r) => String(r.parentId) === String(root._id)),
    }));
  }

  async addComment(access: SupervisionAccess, docId: string, dto: CreateCommentDto) {
    const doc = await this.findOrFail(access, docId);

    let parent: DocumentComment | null = null;
    if (dto.parentId) {
      parent = await this.commentModel.findOne({ _id: dto.parentId, documentId: doc._id });
      if (!parent) throw new NotFoundException('Comment not found.');
      if (parent.parentId) throw new BadRequestException('You can only reply to a top-level comment.');
    }

    const versionId = parent ? parent.versionId : await this.resolveVersionId(doc, dto.versionId);

    const comment = await this.commentModel.create({
      documentId: doc._id,
      versionId,
      authorId: access.userId,
      text: dto.text,
      parentId: parent?._id ?? null,
      anchor: parent ? null : dto.anchor ?? null,
    });

    await this.notifyComment(access, doc, comment, parent);
    return comment.populate('authorId', USER_FIELDS);
  }

  /** A thread is closed by a supervisor, or by whoever started it. */
  async resolveComment(access: SupervisionAccess, commentId: string, dto: ResolveCommentDto) {
    const comment = await this.commentModel.findById(commentId);
    if (!comment) throw new NotFoundException('Comment not found.');
    if (access.role !== 'supervisor' && String(comment.authorId) !== access.userId) {
      throw new ForbiddenException('Only a supervisor or the author can resolve or reopen a thread.');
    }
    if (comment.parentId) throw new BadRequestException('Resolve the top-level comment of the thread.');
    comment.status = dto.status;
    return comment.save();
  }

  /** A supervisor can remove any comment, anyone else only their own. Removing a thread removes its replies. */
  async deleteComment(access: SupervisionAccess, commentId: string) {
    const comment = await this.commentModel.findById(commentId);
    if (!comment) throw new NotFoundException('Comment not found.');
    if (access.role !== 'supervisor' && String(comment.authorId) !== access.userId) {
      throw new ForbiddenException('Only a supervisor or the author can delete a comment.');
    }
    await this.commentModel.deleteMany({ $or: [{ _id: comment._id }, { parentId: comment._id }] });
    return { deleted: true };
  }

  // ---------------- helpers ----------------

  private assertStudent(access: SupervisionAccess, message: string) {
    if (access.role !== 'student') throw new ForbiddenException(message);
  }

  /** Scoped by supervision, so an id from another supervision is simply "not found". */
  private async findOrFail(access: SupervisionAccess, docId: string) {
    if (!Types.ObjectId.isValid(docId)) throw new NotFoundException('Document not found.');
    const doc = await this.documentModel.findOne({
      _id: docId,
      supervisionId: access.supervision._id,
    });
    if (!doc) throw new NotFoundException('Document not found.');
    return doc;
  }

  private async resolveVersionId(doc: ThesisDocument, requested?: string) {
    // comments on the live draft of an editor document belong to no version
    if (doc.mode === 'editor' && !requested) return null;
    if (doc.currentVersion < 1) {
      throw new ConflictException('There is no version to comment on yet.');
    }
    const version = await this.versionModel
      .findOne(requested ? { _id: requested, documentId: doc._id } : { documentId: doc._id, number: doc.currentVersion })
      .select('_id')
      .lean();
    if (!version) throw new NotFoundException('Version not found.');
    return version._id;
  }

  private async findEditorDoc(access: SupervisionAccess, docId: string, withDraft = false) {
    if (!Types.ObjectId.isValid(docId)) throw new NotFoundException('Document not found.');
    const query = this.documentModel.findOne({
      _id: docId,
      supervisionId: access.supervision._id,
      mode: 'editor',
    });
    const doc = await (withDraft ? query.select('+draftContent') : query);
    if (!doc) throw new NotFoundException('Document not found.');
    return doc;
  }

  private cleanContent(content: unknown) {
    try {
      return sanitizeEditorContent(content);
    } catch (err) {
      if (err instanceof InvalidEditorContent) throw new BadRequestException(err.message);
      throw err;
    }
  }

  private cleanName(name: string) {
    // eslint-disable-next-line no-control-regex
    return decodeUploadName(name).replace(/[\u0000-\u001F\u007F"\\/]/g, '_').slice(0, 200);
  }

  private notify(
    access: SupervisionAccess,
    recipients: Types.ObjectId[],
    type: NotificationType,
    message: string,
    doc: ThesisDocument,
  ) {
    return Promise.all(
      [...new Set(recipients.map(String))].map((recipientId) =>
        this.notifications.create({
          recipientId,
          actorId: access.userId,
          type,
          message,
          entityType: 'supervision',
          entityId: access.supervision._id as Types.ObjectId,
          data: { documentId: String(doc._id), title: doc.title, mode: doc.mode },
        }),
      ),
    );
  }

  private notifyStatus(access: SupervisionAccess, doc: ThesisDocument, to: DocumentStatus) {
    const { studentId, supervisorIds } = access.supervision;
    if (to === 'ready_for_review') {
      return this.notify(
        access,
        supervisorIds,
        NotificationType.DOCUMENT_READY_FOR_REVIEW,
        `"${doc.title}" (v${doc.currentVersion}) is ready for your review`,
        doc,
      );
    }
    return this.notify(
      access,
      [studentId],
      NotificationType.DOCUMENT_REVIEWED,
      to === 'reviewed'
        ? `"${doc.title}" was marked as reviewed`
        : `Changes were requested on "${doc.title}"`,
      doc,
    );
  }

  private notifyComment(
    access: SupervisionAccess,
    doc: ThesisDocument,
    comment: DocumentComment,
    parent: DocumentComment | null,
  ) {
    if (!parent) {
      // a new thread goes to the other side: the student hears the supervisors, and the reverse
      const { studentId, supervisorIds } = access.supervision;
      return this.notify(
        access,
        access.role === 'student' ? supervisorIds : [studentId],
        NotificationType.DOCUMENT_COMMENT,
        `New comment on "${doc.title}"`,
        doc,
      );
    }
    // a reply goes to the other side of the conversation: the thread starter, plus the student
    return this.notify(
      access,
      [parent.authorId, access.supervision.studentId].filter((u) => String(u) !== access.userId),
      NotificationType.DOCUMENT_REPLY,
      `New reply on "${doc.title}"`,
      doc,
    );
  }
}
