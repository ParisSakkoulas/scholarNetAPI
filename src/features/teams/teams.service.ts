import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { Team, TeamDocument } from './schema/team.schema';

import { TeamMember, TeamMemberDocument } from './schema/team-member.schema';

import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';

@Injectable()
export class TeamsService {
  constructor(
    @InjectModel(Team.name) private teamModel: Model<TeamDocument>,
    @InjectModel(TeamMember.name) private memberModel: Model<TeamMemberDocument>,
  ) {}

  async create(dto: CreateTeamDto, ownerId: string) {
    const team = await this.teamModel.create({ ...dto, ownerId });
    await this.memberModel.create({
      teamId: team._id,
      userId: new Types.ObjectId(ownerId),
      role: 'owner',
      status: 'active',
      joinedAt: new Date(),
    });
    return team;
  }

  async findAllForUser(userId: string) {
    const memberships = await this.memberModel
      .find({ userId: new Types.ObjectId(userId), status: 'active' })
      .lean();
    const teamIds = memberships.map((m) => m.teamId);
    return this.teamModel.find({ _id: { $in: teamIds } }).lean();
  }

  async findOne(teamId: string) {
    const team = await this.teamModel.findById(teamId).lean();
    if (!team) throw new NotFoundException('Team not found');
    return team;
  }

  async update(teamId: string, dto: UpdateTeamDto) {
    const team = await this.teamModel.findByIdAndUpdate(teamId, dto, { new: true });
    if (!team) throw new NotFoundException('Team not found');
    return team;
  }

  async remove(teamId: string, requesterId: string) {
    const team = await this.teamModel.findById(teamId);
    if (!team) throw new NotFoundException('Team not found');
    if (team.ownerId.toString() !== requesterId)
      throw new ForbiddenException('Only the owner can delete this team');
    await this.memberModel.deleteMany({ teamId });
    await team.deleteOne();
    return { deleted: true };
  }
}
