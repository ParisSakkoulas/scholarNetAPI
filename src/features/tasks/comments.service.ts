import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Comment, CommentDocument } from './schema/comment.schema';
import { CreateCommentDto } from './dto/create-comment.dto';

@Injectable()
export class CommentsService {
  constructor(@InjectModel(Comment.name) private commentModel: Model<CommentDocument>) {}

  async create(entityType: string, entityId: string, dto: CreateCommentDto, authorId: string) {
    return this.commentModel.create({ entityType, entityId, authorId, body: dto.body });
  }

  async findForEntity(entityType: string, entityId: string) {
    return this.commentModel
      .find({ entityType, entityId })
      .populate('authorId', 'name avatarUrl')
      .sort({ createdAt: 1 })
      .lean();
  }

  async remove(commentId: string, requesterId: string) {
    const comment = await this.commentModel.findById(commentId);
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.authorId.toString() !== requesterId)
      throw new ForbiddenException('You can only delete your own comments');
    await comment.deleteOne();
    return { deleted: true };
  }
}
