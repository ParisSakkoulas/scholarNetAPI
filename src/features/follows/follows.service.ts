import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Follow } from './schemas/follow.schema';
import { User } from '../users/schema/user.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification-type.enum';

const USER_CARD_FIELDS = 'firstName lastName username profilePhotoUrl';

@Injectable()
export class FollowsService {
  constructor(
    @InjectModel(Follow.name) private followModel: Model<Follow>,
    @InjectModel(User.name) private userModel: Model<User>,
    private notificationsService: NotificationsService,
  ) {}

  /** Idempotent: following someone twice is a no-op and does not notify again. */
  async follow(me: string, targetId: string) {
    this.assertValidId(targetId);
    if (me === targetId) throw new BadRequestException('You cannot follow yourself.');

    const target = await this.userModel.exists({ _id: targetId });
    if (!target) throw new NotFoundException('User not found.');

    const res = await this.followModel.updateOne(
      { follower: me, following: targetId },
      { $setOnInsert: { follower: me, following: targetId } },
      { upsert: true },
    );

    if (res.upsertedCount === 1) {
      const actor = await this.userModel.findById(me).select('firstName lastName username').lean();
      const name = actor ? `${actor.firstName} ${actor.lastName}` : 'Someone';
      await this.notificationsService.create({
        recipientId: targetId,
        actorId: me,
        type: NotificationType.NEW_FOLLOWER,
        message: `${name} started following you`,
        entityType: 'user',
        entityId: me,
        data: { username: actor?.username },
      });
    }

    return { following: true };
  }

  async unfollow(me: string, targetId: string) {
    this.assertValidId(targetId);
    const res = await this.followModel.deleteOne({ follower: me, following: targetId });

    // the "X started following you" notification is meaningless now
    if (res.deletedCount) {
      await this.notificationsService.removeByActor(targetId, me, NotificationType.NEW_FOLLOWER);
    }
    return { following: false };
  }

  async getFollowers(userId: string, page: number, limit: number, skip: number) {
    this.assertValidId(userId);
    const [rows, total] = await Promise.all([
      this.followModel
        .find({ following: userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('follower', USER_CARD_FIELDS)
        .lean(),
      this.followModel.countDocuments({ following: userId }),
    ]);
    return {
      data: rows.map((r) => ({ ...(r.follower as object), followedAt: r.createdAt })),
      total,
      page,
      limit,
    };
  }

  async getFollowing(userId: string, page: number, limit: number, skip: number) {
    this.assertValidId(userId);
    const [rows, total] = await Promise.all([
      this.followModel
        .find({ follower: userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('following', USER_CARD_FIELDS)
        .lean(),
      this.followModel.countDocuments({ follower: userId }),
    ]);
    return {
      data: rows.map((r) => ({ ...(r.following as object), followedAt: r.createdAt })),
      total,
      page,
      limit,
    };
  }

  async getCounts(userId: string) {
    this.assertValidId(userId);
    const [followers, following] = await Promise.all([
      this.followModel.countDocuments({ following: userId }),
      this.followModel.countDocuments({ follower: userId }),
    ]);
    return { followers, following };
  }

  /** Relationship between the logged-in user and another user, for the Follow button. */
  async getStatus(me: string, otherId: string) {
    this.assertValidId(otherId);
    const [isFollowing, isFollowedBy] = await Promise.all([
      this.followModel.exists({ follower: me, following: otherId }),
      this.followModel.exists({ follower: otherId, following: me }),
    ]);
    return { isFollowing: !!isFollowing, isFollowedBy: !!isFollowedBy };
  }

  private assertValidId(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid user id.');
  }
}
