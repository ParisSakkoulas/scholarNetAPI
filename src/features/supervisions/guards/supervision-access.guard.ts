import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  createParamDecorator,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Supervision } from '../schemas/supervision.schema';
import { ThesisDocument } from '../schemas/thesis-document.schema';
import { DocumentComment } from '../schemas/document-comment.schema';

export type SupervisionRole = 'student' | 'supervisor';

export interface SupervisionAccess {
  supervision: Supervision;
  role: SupervisionRole;
  userId: string;
}

/**
 * The one place that decides who may touch a supervision: its student or one of its
 * supervisors. There is deliberately no admin bypass, the record is private to them.
 *
 * - a supervisor who has not accepted yet sees nothing (they answer through /respond)
 * - ended or declined supervisions are read-only history
 * Every handler below `supervisions/:id` therefore only has to scope its queries by id.
 *
 * Routes that name a child instead (`documents/:docId`, `comments/:commentId`) are mapped back to
 * their supervision first, so documents and comments go through this same check.
 */
@Injectable()
export class SupervisionAccessGuard implements CanActivate {
  constructor(
    @InjectModel(Supervision.name) private supervisionModel: Model<Supervision>,
    @InjectModel(ThesisDocument.name) private documentModel: Model<ThesisDocument>,
    @InjectModel(DocumentComment.name) private commentModel: Model<DocumentComment>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const userId = String(req.user?.userId ?? '');
    const id = await this.supervisionIdFor(req.params);

    if (!id || !Types.ObjectId.isValid(id)) throw new NotFoundException('Supervision not found.');
    const supervision = await this.supervisionModel.findById(id).exec();
    // same answer for "missing" and "not yours": do not reveal that it exists
    if (!supervision) throw new NotFoundException('Supervision not found.');

    const isStudent = String(supervision.studentId) === userId;
    const isSupervisor = supervision.supervisorIds.some((s) => String(s) === userId);
    if (!isStudent && !isSupervisor) throw new NotFoundException('Supervision not found.');

    const role: SupervisionRole = isStudent ? 'student' : 'supervisor';
    if (role === 'supervisor' && supervision.status === 'pending') {
      throw new ForbiddenException('Accept the invitation to see this supervision.');
    }

    const readOnly = supervision.status === 'ended' || supervision.status === 'declined';
    if (readOnly && req.method !== 'GET') {
      throw new ForbiddenException('This supervision has ended and is read-only.');
    }

    req.supervisionAccess = { supervision, role, userId } satisfies SupervisionAccess;
    return true;
  }

  /** `:id` is the supervision itself; `:docId` / `:commentId` are looked up to find theirs. */
  private async supervisionIdFor(params: Record<string, string>): Promise<string | null> {
    if (params.id) return params.id;

    let docId = params.docId;
    if (!docId && params.commentId) {
      if (!Types.ObjectId.isValid(params.commentId)) return null;
      const comment = await this.commentModel.findById(params.commentId).select('documentId').lean();
      docId = String(comment?.documentId ?? '');
    }
    if (!docId || !Types.ObjectId.isValid(docId)) return null;
    const doc = await this.documentModel.findById(docId).select('supervisionId').lean();
    return doc ? String(doc.supervisionId) : null;
  }
}

export const Access = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): SupervisionAccess =>
    ctx.switchToHttp().getRequest().supervisionAccess,
);
