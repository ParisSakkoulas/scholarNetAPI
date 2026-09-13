import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { TeamMember, TeamMemberDocument } from './schema/team-member.schema';
import { InviteMemberDto } from './dto/invite-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';

@Injectable()
export class TeamMembersService {
  constructor(@InjectModel(TeamMember.name) private memberModel: Model<TeamMemberDocument>) {}

  async invite(teamId: string, dto: InviteMemberDto, invitedBy: string) {
    const exists = await this.memberModel.findOne({ teamId, userId: dto.userId });
    if (exists) throw new ConflictException('User already invited or a member');
    return this.memberModel.create({
      teamId,
      userId: new Types.ObjectId(dto.userId),
      role: dto.role ?? 'member',
      status: 'invited',
      invitedBy: new Types.ObjectId(invitedBy),
    });
  }

  async list(teamId: string) {
    return this.memberModel
      .find({ teamId, status: { $ne: 'removed' } })
      .populate('userId', 'name email avatarUrl')
      .lean();
  }

  async accept(teamId: string, userId: string) {
    const member = await this.memberModel.findOneAndUpdate(
      { teamId, userId, status: 'invited' },
      { status: 'active', joinedAt: new Date() },
      { new: true },
    );
    if (!member) throw new NotFoundException('No pending invite found');
    return member;
  }

  async updateRole(teamId: string, userId: string, dto: UpdateMemberRoleDto) {
    const member = await this.memberModel.findOneAndUpdate(
      { teamId, userId },
      { role: dto.role },
      { new: true },
    );
    if (!member) throw new NotFoundException('Member not found');
    return member;
  }

  async remove(teamId: string, userId: string) {
    const member = await this.memberModel.findOneAndUpdate(
      { teamId, userId },
      { status: 'removed' },
      { new: true },
    );
    if (!member) throw new NotFoundException('Member not found');
    return { removed: true };
  }
}
