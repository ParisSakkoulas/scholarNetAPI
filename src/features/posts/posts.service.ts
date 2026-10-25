import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Post } from './schemas/post.schema';
import { PostLike, REACTION_TYPES, ReactionType } from './schemas/post-like.schema';
import { PostComment } from './schemas/post-comment.schema';
import { PostReport, REPORT_REASONS } from './schemas/post-report.schema';
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
    @InjectModel(PostReport.name) private reportModel: Model<PostReport>,
    @InjectModel(Follow.name) private followModel: Model<Follow>,
    @InjectModel(User.name) private userModel: Model<User>,
    private notificationsService: NotificationsService,
  ) {}

  // ---------------- POSTS ----------------

  async create(me: string, content: string) {
    const text = this.cleanText(content, MAX_POST_LENGTH, 'Post');
    const post = await this.postModel.create({ author: me, content: text });
    await post.populate('author', AUTHOR_FIELDS);
    return { ...post.toObject(), likedByMe: false, myReaction: null, reactions: {} };
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

  /** Only the author can edit. The text is stored as given and the post is marked as edited. */
  async edit(me: string, postId: string, content: string) {
    this.assertId(postId, 'post');
    const text = this.cleanText(content, MAX_POST_LENGTH, 'Post');
    const post = await this.postModel.findById(postId);
    if (!post) throw new NotFoundException('Post not found.');
    if (String(post.author) !== me) throw new ForbiddenException('You can only edit your own posts.');
    if (post.content !== text) {
      post.content = text;
      post.editedAt = new Date();
      await post.save();
    }
    const populated = await this.postModel.findById(postId).populate('author', AUTHOR_FIELDS).lean();
    const [decorated] = await this.decorate([populated!], me);
    return decorated;
  }

  /** Flags someone else's post. Reporting twice is a no-op. */
  async report(me: string, postId: string, reason: string, details?: string) {
    this.assertId(postId, 'post');
    if (!(REPORT_REASONS as readonly string[]).includes(reason)) {
      throw new BadRequestException('Pick a reason for the report.');
    }
    const post = await this.postModel.findById(postId).select('author').lean();
    if (!post) throw new NotFoundException('Post not found.');
    if (String(post.author) === me) throw new BadRequestException('You cannot report your own post.');
    await this.reportModel.updateOne(
      { post: postId, reporter: me },
      {
        $setOnInsert: {
          post: postId,
          reporter: me,
          reason,
          details: typeof details === 'string' ? details.trim().slice(0, 1000) : '',
        },
      },
      { upsert: true },
    );
    return { reported: true };
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
      this.reportModel.deleteMany({ post: postId }),
      this.commentModel.deleteMany({ post: postId }),
      this.notificationsService.removeByEntity('post', postId),
    ]);
    return { deleted: true };
  }

  // ---------------- LIKES ----------------

  /**
   * React to a post. Idempotent: reacting twice neither double-counts nor re-notifies, and
   * reacting again with another type just changes the reaction.
   */
  async like(me: string, postId: string, type: string = 'like') {
    this.assertId(postId, 'post');
    if (!(REACTION_TYPES as readonly string[]).includes(type)) {
      throw new BadRequestException('Unknown reaction.');
    }
    const post = await this.postModel.findById(postId).select('author').lean();
    if (!post) throw new NotFoundException('Post not found.');

    // returns the row as it was before: null means this is a new reaction
    const before = await this.likeModel.findOneAndUpdate(
      { post: postId, user: me },
      { $set: { type }, $setOnInsert: { post: postId, user: me } },
      { upsert: true, new: false },
    );

    if (!before) {
      await this.postModel.updateOne({ _id: postId }, { $inc: { likesCount: 1 } });
      const name = await this.displayName(me);
      await this.notificationsService.create({
        recipientId: post.author,
        actorId: me,
        type: NotificationType.POST_LIKED,
        message:
          type === 'like'
            ? `${name} liked your post`
            : `${name} reacted "${type}" to your post`,
        entityType: 'post',
        entityId: postId,
      });
    }

    const likesCount = await this.currentCount(postId, 'likesCount');
    const [reactions] = await this.reactionCounts([postId]);
    return { liked: true, likesCount, myReaction: type, reactions: reactions ?? {} };
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
    const [reactions] = await this.reactionCounts([postId]);
    return { liked: false, likesCount, myReaction: null, reactions: reactions ?? {} };
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

  /** Adds my reaction and the reaction breakdown to each post (two queries for the whole page). */
  private async decorate<T extends { _id: Types.ObjectId }>(posts: T[], me: string) {
    if (!posts.length) return [];
    const ids = posts.map((p) => p._id);
    const [mine, breakdown] = await Promise.all([
      this.likeModel.find({ user: me, post: { $in: ids } }).select('post type').lean(),
      this.reactionCounts(ids),
    ]);
    const myTypes = new Map(mine.map((l) => [String(l.post), l.type ?? 'like']));
    return posts.map((p, i) => ({
      ...p,
      likedByMe: myTypes.has(String(p._id)),
      myReaction: myTypes.get(String(p._id)) ?? null,
      reactions: breakdown[i] ?? {},
    }));
  }

  /** Reactions per post, in the same order as `postIds`: { like: 3, love: 1 }. Rows with no type are likes. */
  private async reactionCounts(postIds: (Types.ObjectId | string)[]) {
    const ids = postIds.map((id) => new Types.ObjectId(String(id)));
    const rows = await this.likeModel.aggregate<{
      _id: { post: Types.ObjectId; type: ReactionType };
      n: number;
    }>([
      { $match: { post: { $in: ids } } },
      { $group: { _id: { post: '$post', type: { $ifNull: ['$type', 'like'] } }, n: { $sum: 1 } } },
    ]);
    const byPost = new Map<string, Partial<Record<ReactionType, number>>>();
    for (const r of rows) {
      const key = String(r._id.post);
      byPost.set(key, { ...byPost.get(key), [r._id.type]: r.n });
    }
    return ids.map((id) => byPost.get(String(id)) ?? {});
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
