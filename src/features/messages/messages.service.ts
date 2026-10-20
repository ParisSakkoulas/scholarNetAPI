import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Conversation } from './schemas/conversation.schema';
import { Message } from './schemas/message.schema';
import { Follow } from '../follows/schemas/follow.schema';
import { User } from '../users/schema/user.schema';
import { MessageCryptoService } from './message-crypto.service';

const USER_CARD_FIELDS = 'firstName lastName username profilePhotoUrl';
export const MAX_MESSAGE_LENGTH = 4000;

@Injectable()
export class MessagesService {
  constructor(
    @InjectModel(Conversation.name) private conversationModel: Model<Conversation>,
    @InjectModel(Message.name) private messageModel: Model<Message>,
    @InjectModel(Follow.name) private followModel: Model<Follow>,
    @InjectModel(User.name) private userModel: Model<User>,
    private crypto: MessageCryptoService,
  ) {}

  // ---------------- CONNECTIONS ----------------

  /** Two users are "connected" when they follow each other. */
  async areConnected(a: string, b: string): Promise<boolean> {
    const count = await this.followModel.countDocuments({
      $or: [
        { follower: a, following: b },
        { follower: b, following: a },
      ],
    });
    return count === 2;
  }

  // ---------------- CONVERSATIONS ----------------

  /** Returns the existing conversation with `otherId`, or creates it. Both must be connected. */
  async getOrCreateConversation(me: string, otherId: string) {
    this.assertValidId(otherId, 'user');
    if (me === otherId) throw new BadRequestException('You cannot message yourself.');

    const other = await this.userModel.exists({ _id: otherId });
    if (!other) throw new NotFoundException('User not found.');
    if (!(await this.areConnected(me, otherId))) {
      throw new ForbiddenException('You can only message users you are connected with.');
    }

    const pairKey = [me, otherId].sort().join('_');
    const convo = await this.conversationModel.findOneAndUpdate(
      { pairKey },
      { $setOnInsert: { pairKey, participants: [me, otherId], unread: {} } },
      { upsert: true, returnDocument: 'after' },
    );
    return this.toConversationView(await this.populate(convo._id), me);
  }

  async listConversations(me: string, page: number, limit: number, skip: number) {
    const filter = { participants: new Types.ObjectId(me), lastMessage: { $ne: null } };
    const [rows, total] = await Promise.all([
      this.conversationModel
        .find(filter)
        .sort({ lastMessageAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('participants', USER_CARD_FIELDS)
        .lean(),
      this.conversationModel.countDocuments(filter),
    ]);
    return { data: rows.map((c) => this.toConversationView(c, me)), total, page, limit };
  }

  async getUnreadTotal(me: string) {
    const rows = await this.conversationModel
      .find({ participants: new Types.ObjectId(me) })
      .select('unread')
      .lean();
    return { unread: rows.reduce((sum, c) => sum + (c.unread?.[me] ?? 0), 0) };
  }

  /** Returns the other participant's id if `me` belongs to the conversation, else null. */
  async getOtherParticipant(me: string, conversationId: string): Promise<string | null> {
    if (!Types.ObjectId.isValid(conversationId)) return null;
    const convo = await this.conversationModel
      .findOne({ _id: conversationId, participants: new Types.ObjectId(me) })
      .select('participants')
      .lean();
    if (!convo) return null;
    return convo.participants.map(String).find((id) => id !== me) ?? null;
  }

  // ---------------- MESSAGES ----------------

  /** Newest first. Pass `before` (a message id) to load the next older page. */
  async getMessages(me: string, conversationId: string, limit: number, before?: string) {
    await this.assertMember(me, conversationId);
    const filter: Record<string, unknown> = { conversation: conversationId };
    if (before) {
      this.assertValidId(before, 'message');
      filter._id = { $lt: new Types.ObjectId(before) };
    }
    const rows = await this.messageModel
      .find(filter)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean();
    const hasMore = rows.length > limit;
    const data = rows.slice(0, limit).map((m) => ({ ...m, text: this.crypto.decrypt(m.text) }));
    return { data, hasMore };
  }

  async sendMessage(me: string, conversationId: string, rawText: string) {
    const text = (rawText ?? '').toString().trim();
    if (!text) throw new BadRequestException('Message cannot be empty.');
    if (text.length > MAX_MESSAGE_LENGTH) {
      throw new BadRequestException(`Message is too long (max ${MAX_MESSAGE_LENGTH} characters).`);
    }

    const convo = await this.assertMember(me, conversationId);
    const recipientId = convo.participants.map(String).find((id) => id !== me)!;
    if (!(await this.areConnected(me, recipientId))) {
      throw new ForbiddenException('You can only message users you are connected with.');
    }

    const encrypted = this.crypto.encrypt(text);
    const message = await this.messageModel.create({
      conversation: convo._id,
      sender: me,
      text: encrypted,
    });

    await this.conversationModel.updateOne(
      { _id: convo._id },
      {
        $set: {
          lastMessage: { sender: me, text: encrypted, createdAt: message.createdAt },
          lastMessageAt: message.createdAt,
        },
        $inc: { [`unread.${recipientId}`]: 1 },
      },
    );

    return { message: { ...message.toObject(), text }, recipientId };
  }

  /** Marks everything the other participant sent as read. Returns who should be told, or null. */
  async markRead(me: string, conversationId: string) {
    const convo = await this.assertMember(me, conversationId);
    const otherId = convo.participants.map(String).find((id) => id !== me)!;
    const readAt = new Date();

    const res = await this.messageModel.updateMany(
      { conversation: convo._id, sender: otherId, readAt: null },
      { $set: { readAt } },
    );
    if ((convo.unread?.[me] ?? 0) > 0) {
      await this.conversationModel.updateOne({ _id: convo._id }, { $set: { [`unread.${me}`]: 0 } });
    }
    return { conversationId, otherId, readAt, updated: res.modifiedCount };
  }

  // ---------------- HELPERS ----------------

  private async assertMember(me: string, conversationId: string) {
    this.assertValidId(conversationId, 'conversation');
    const convo = await this.conversationModel.findById(conversationId).lean();
    if (!convo) throw new NotFoundException('Conversation not found.');
    if (!convo.participants.map(String).includes(me)) {
      throw new ForbiddenException('You are not part of this conversation.');
    }
    return convo;
  }

  private populate(id: Types.ObjectId) {
    return this.conversationModel
      .findById(id)
      .populate('participants', USER_CARD_FIELDS)
      .lean()
      .orFail();
  }

  private toConversationView(
    c: {
      _id: Types.ObjectId;
      participants: unknown[];
      lastMessage?: unknown;
      lastMessageAt: Date;
      unread?: Record<string, number>;
    },
    me: string,
  ) {
    const users = c.participants as { _id: Types.ObjectId }[];
    const last = c.lastMessage as { text: string } | undefined | null;
    return {
      _id: c._id,
      user: users.find((u) => String(u._id) !== me) ?? null,
      lastMessage: last ? { ...last, text: this.crypto.decrypt(last.text) } : null,
      lastMessageAt: c.lastMessageAt,
      unreadCount: c.unread?.[me] ?? 0,
    };
  }

  private assertValidId(id: string, what: string) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException(`Invalid ${what} id.`);
  }
}
