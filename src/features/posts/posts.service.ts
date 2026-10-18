import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Post } from './schemas/post.schema';
import { PostLike } from './schemas/post-like.schema';
import { PostComment } from './schemas/post-comment.schema';
import { Follow } from '../follows/schemas/follow.schema';
import { User } from '../users/schema/user.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification-type.enum';

const AUTHOR_FIELDS = 'firstName lastName username profilePhotoUrl';
const MAX_POST_LENGTH = 5000;
const MAX_COMMENT_LENGTH = 1000;

@Injectable()
export class PostsService {
  constructor(
    @InjectModel(Post.name) private postModel: Model<Post>,
    @InjectModel(PostLike.name) private likeModel: Model<PostLike>,
    @InjectModel(PostComment.name) private commentModel: Model<PostComment>,
    @InjectModel(Follow.name) private followModel: Model<Follow>,
    @InjectModel(User.name) private userModel: Model<User>,
    private notificationsService: NotificationsService,
  ) {}

  // ---------------- POSTS ----------------

  async create(me: string, content: string) {
    const text = this.cleanText(content, MAX_POST_LENGTH, 'Post');
    const post = await this.postModel.create({ author: me, content: text });
    await post.populate('author', AUTHOR_FIELDS);
    return { ...post.toObject(), likedByMe: false };
  }

  /** Posts from the people I follow, plus my own, newest first. */
  async getFeed(me: string, page: number, limit: number, skip: number) {
    const following = await this.followModel.find({ follower: me }).select('following').lean();
    const authors = [me, ...following.map((f) => String(f.following))];
    return this.pagePosts({ author: { $in: authors } }, me, page, limit, skip);
  }

  /** Timeline of one user (profile page). */
  async getUserPosts(me: string, userId: string, page: number, limit: number, skip: number) {
    this.assertId(userId, 'user');
    return this.pagePosts({ author: userId }, me, page, limit, skip);
  }

  async getOne(me: string, postId: string) {
    this.assertId(postId, 'post');
    const post = await this.postModel.findById(postId).populate('author', AUTHOR_FIELDS).lean();
    if (!post) throw new NotFoundException('Post not found.');
    const [decorated] = await this.decorate([post], me);
    return decorated;
  }

  /** Only the author can delete; likes, comments and related notifications go with it. */
  async remove(me: string, postId: string) {
    this.assertId(postId, 'post');
    const post = await this.postModel.findById(postId).select('author').lean();
    if (!post) throw new NotFoundException('Post not found.');
    if (String(post.author) !== me) throw new ForbiddenException('You can only delete your own posts.');

    await Promise.all([
      this.postModel.deleteOne({ _id: postId }),
      this.likeModel.deleteMany({ post: postId }),
      this.commentModel.deleteMany({ post: postId }),
      this.notificationsService.removeByEntity('post', postId),
    ]);
    return { deleted: true };
  }

  // ---------------- LIKES ----------------

  /** Idempotent: liking twice neither double-counts nor re-notifies. */
  async like(me: string, postId: string) {
    this.assertId(postId, 'post');
    const post = await this.postModel.findById(postId).select('author').lean();
    if (!post) throw new NotFoundException('Post not found.');

    const res = await this.likeModel.updateOne(
      { post: postId, user: me },
      { $setOnInsert: { post: postId, user: me } },
      { upsert: true },
    );

    if (res.upsertedCount === 1) {
      await this.postModel.updateOne({ _id: postId }, { $inc: { likesCount: 1 } });
      const name = await this.displayName(me);
      await this.notificationsService.create({
        recipientId: post.author,
        actorId: me,
        type: NotificationType.POST_LIKED,
        message: `${name} liked your post`,
        entityType: 'post',
        entityId: postId,
      });
    }

    const likesCount = await this.currentCount(postId, 'likesCount');
    return { liked: true, likesCount };
  }

  async unlike(me: string, postId: string) {
    this.assertId(postId, 'post');
    const res = await this.likeModel.deleteOne({ post: postId, user: me });

    if (res.deletedCount) {
      await this.postModel.updateOne({ _id: postId }, { $inc: { likesCount: -1 } });
      const post = await this.postModel.findById(postId).select('author').lean();
      if (post) {
        await this.notificationsService.removeByActor(
          post.author,
          me,
          NotificationType.POST_LIKED,
          postId,
        );
      }
    }

    const likesCount = await this.currentCount(postId, 'likesCount');
    return { liked: false, likesCount };
  }

  // ---------------- COMMENTS ----------------

  async addComment(me: string, postId: string, content: string) {
    this.assertId(postId, 'post');
    const text = this.cleanText(content, MAX_COMMENT_LENGTH, 'Comment');

    const post = await this.postModel.findById(postId).select('author').lean();
    if (!post) throw new NotFoundException('Post not found.');

    const comment = await this.commentModel.create({ post: postId, author: me, content: text });
    await this.postModel.updateOne({ _id: postId }, { $inc: { commentsCount: 1 } });
    await comment.populate('author', AUTHOR_FIELDS);

    const name = await this.displayName(me);
    await this.notificationsService.create({
      recipientId: post.author,
      actorId: me,
      type: NotificationType.POST_COMMENTED,
      message: `${name} commented on your post`,
      entityType: 'post',
      entityId: postId,
      data: { commentId: String(comment._id), preview: text.slice(0, 80) },
    });

    return comment.toObject();
  }

  async getComments(postId: string, page: number, limit: number, skip: number) {
    this.assertId(postId, 'post');
    const [data, total] = await Promise.all([
      this.commentModel
        .find({ post: postId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('author', AUTHOR_FIELDS)
        .lean(),
      this.commentModel.countDocuments({ post: postId }),
    ]);
    return { data, total, page, limit };
  }

  /** The comment's author or the post's author may delete a comment. */
  async removeComment(me: string, postId: string, commentId: string) {
    this.assertId(postId, 'post');
    this.assertId(commentId, 'comment');

    const [post, comment] = await Promise.all([
      this.postModel.findById(postId).select('author').lean(),
      this.commentModel.findOne({ _id: commentId, post: postId }).lean(),
    ]);
    if (!post || !comment) throw new NotFoundException('Comment not found.');
    if (String(comment.author) !== me && String(post.author) !== me) {
      throw new ForbiddenException('You cannot delete this comment.');
    }

    await this.commentModel.deleteOne({ _id: commentId });
    await this.postModel.updateOne({ _id: postId }, { $inc: { commentsCount: -1 } });
    return { deleted: true };
  }

  // ---------------- helpers ----------------

  private async pagePosts(
    filter: Record<string, unknown>,
    me: string,
    page: number,
    limit: number,
    skip: number,
  ) {
    const [posts, total] = await Promise.all([
      this.postModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('author', AUTHOR_FIELDS)
        .lean(),
      this.postModel.countDocuments(filter),
    ]);
    return { data: await this.decorate(posts, me), total, page, limit };
  }

  /** Adds `likedByMe` to each post with a single query. */
  private async decorate<T extends { _id: Types.ObjectId }>(posts: T[], me: string) {
    if (!posts.length) return [];
    const liked = await this.likeModel
      .find({ user: me, post: { $in: posts.map((p) => p._id) } })
      .select('post')
      .lean();
    const likedIds = new Set(liked.map((l) => String(l.post)));
    return posts.map((p) => ({ ...p, likedByMe: likedIds.has(String(p._id)) }));
  }

  private async currentCount(postId: string, field: 'likesCount' | 'commentsCount') {
    const post = await this.postModel.findById(postId).select(field).lean();
    return post?.[field] ?? 0;
  }

  private async displayName(userId: string) {
    const user = await this.userModel.findById(userId).select('firstName lastName').lean();
    return user ? `${user.firstName} ${user.lastName}` : 'Someone';
  }

  private cleanText(text: unknown, max: number, label: string): string {
    const value = typeof text === 'string' ? text.trim() : '';
    if (!value) throw new BadRequestException(`${label} cannot be empty.`);
    if (value.length > max) throw new BadRequestException(`${label} is too long (max ${max}).`);
    return value;
  }

  private assertId(id: string, what: string) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException(`Invalid ${what} id.`);
  }
}
