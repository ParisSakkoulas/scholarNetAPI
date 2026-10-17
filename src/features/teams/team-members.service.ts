import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { TeamMember, TeamMemberDocument } from './schema/team-member.schema';
import { Team, TeamDocument } from './schema/team.schema';
import { User } from '../users/schema/user.schema';
import { InviteMemberDto } from './dto/invite-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification-type.enum';

/** Matches the real User schema — not `name`/`avatarUrl`, which don't exist on it. */
const USER_POPULATE_FIELDS = 'username email firstName lastName profilePhotoUrl';
const INVITER_POPULATE_FIELDS = 'username firstName lastName profilePhotoUrl';
const TEAM_POPULATE_FIELDS = 'name slug description avatarUrl visibility';

@Injectable()
export class TeamMembersService {
  constructor(
    @InjectModel(TeamMember.name) private memberModel: Model<TeamMemberDocument>,
    @InjectModel(Team.name) private teamModel: Model<TeamDocument>,
    @InjectModel(User.name) private userModel: Model<User>,
    private notificationsService: NotificationsService,
  ) {}

  // ---------------- INVITE FLOW ----------------

  async invite(teamId: string, dto: InviteMemberDto, invitedBy: string) {
    const [team, invitee, inviter] = await Promise.all([
      this.teamModel.findById(teamId).lean(),
      this.userModel.exists({ _id: dto.userId }),
      this.userModel.findById(invitedBy).select('firstName lastName').lean(),
    ]);
    if (!team) throw new NotFoundException('Team not found');
    if (!invitee) throw new NotFoundException('User not found');

    const existing = await this.memberModel.findOne({ teamId, userId: dto.userId });
    if (existing && existing.status === 'active') {
      throw new ConflictException('User is already a member');
    }
    if (existing && existing.status === 'invited') {
      throw new ConflictException('User already has a pending invite');
    }

    // a removed / declined / left member can be invited again: reuse the same row
    const member = await this.memberModel.findOneAndUpdate(
      { teamId, userId: dto.userId },
      {
        $set: {
          role: dto.role ?? 'member',
          status: 'invited',
          invitedBy: new Types.ObjectId(invitedBy),
        },
        $unset: { joinedAt: '' },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    const inviterName = inviter ? `${inviter.firstName} ${inviter.lastName}` : 'Someone';
    await this.notificationsService.create({
      recipientId: dto.userId,
      actorId: invitedBy,
      type: NotificationType.TEAM_INVITE,
      message: `${inviterName} invited you to join ${team.name}`,
      entityType: 'team',
      entityId: teamId,
      data: { teamName: team.name, teamSlug: team.slug, role: member.role },
    });

    // populate before returning, so the frontend shows username/email
    // immediately instead of a bare id until the next list() refetch
    return member.populate('userId', USER_POPULATE_FIELDS);
  }

  /** The logged-in user's pending invitations, across all teams. */
  async listInvitations(userId: string) {
    return this.memberModel
      .find({ userId, status: 'invited' })
      .sort({ createdAt: -1 })
      .populate('teamId', TEAM_POPULATE_FIELDS)
      .populate('invitedBy', INVITER_POPULATE_FIELDS)
      .lean();
  }

  async accept(teamId: string, userId: string) {
    const member = await this.memberModel.findOneAndUpdate(
      { teamId, userId, status: 'invited' },
      { status: 'active', joinedAt: new Date() },
      { new: true },
    );
    if (!member) throw new NotFoundException('No pending invite found');

    // let the inviter know
    if (member.invitedBy) {
      const [team, user] = await Promise.all([
        this.teamModel.findById(teamId).select('name').lean(),
        this.userModel.findById(userId).select('firstName lastName').lean(),
      ]);
      await this.notificationsService.create({
        recipientId: member.invitedBy,
        actorId: userId,
        type: NotificationType.TEAM_INVITE_ACCEPTED,
        message: `${user?.firstName ?? 'Someone'} ${user?.lastName ?? ''} joined ${team?.name ?? 'your team'}`.replace(
          /\s+/g,
          ' ',
        ),
        entityType: 'team',
        entityId: teamId,
      });
    }
    return member;
  }

  async decline(teamId: string, userId: string) {
    const member = await this.memberModel.findOneAndUpdate(
      { teamId, userId, status: 'invited' },
      { status: 'removed' },
      { new: true },
    );
    if (!member) throw new NotFoundException('No pending invite found');
    return { declined: true };
  }

  // ---------------- MEMBERS ----------------

  async list(teamId: string) {
    return this.memberModel
      .find({ teamId, status: { $ne: 'removed' } })
      .populate('userId', USER_POPULATE_FIELDS)
      .lean();
  }

  async updateRole(teamId: string, userId: string, dto: UpdateMemberRoleDto) {
    await this.assertNotOwner(teamId, userId, 'The owner role cannot be changed');

    const member = await this.memberModel
      .findOneAndUpdate({ teamId, userId, status: { $ne: 'removed' } }, { role: dto.role }, { new: true })
      .populate('userId', USER_POPULATE_FIELDS);
    if (!member) throw new NotFoundException('Member not found');
    return member;
  }

  /** Removes a member, or cancels their pending invite. The owner can never be removed. */
  async remove(teamId: string, userId: string) {
    await this.assertNotOwner(teamId, userId, 'The owner cannot be removed from the team');

    const member = await this.memberModel.findOneAndUpdate(
      { teamId, userId, status: { $ne: 'removed' } },
      { status: 'removed' },
      { new: true },
    );
    if (!member) throw new NotFoundException('Member not found');
    return { removed: true };
  }

  async leave(teamId: string, userId: string) {
    await this.assertNotOwner(
      teamId,
      userId,
      'The owner cannot leave the team; delete the team instead',
    );

    const member = await this.memberModel.findOneAndUpdate(
      { teamId, userId, status: 'active' },
      { status: 'removed' },
      { new: true },
    );
    if (!member) throw new NotFoundException('You are not a member of this team');
    return { left: true };
  }

  private async assertNotOwner(teamId: string, userId: string, message: string) {
    if (!Types.ObjectId.isValid(userId)) throw new BadRequestException('Invalid user id');
    const target = await this.memberModel.findOne({ teamId, userId }).lean();
    if (target?.role === 'owner') throw new ForbiddenException(message);
  }
}
