import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { Team, TeamDocument } from './schema/team.schema';
import { TeamMember, TeamMemberDocument } from './schema/team-member.schema';

import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { PageQuery, Page } from 'src/common/models/pagination-types';

/** Only these can be sorted on — never pass the query param straight to Mongoose. */
const SORTABLE_FIELDS = new Set(['name', 'visibility', 'createdAt']);

/** Escapes regex special characters so a search term can't break or hijack the query. */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

  /** Unchanged — the card-grid view keeps using this. */
  async findAllForUser(userId: string) {
    const memberships = await this.memberModel
      .find({ userId: new Types.ObjectId(userId), status: 'active' })
      .lean();
    const teamIds = memberships.map((m) => m.teamId);
    return this.teamModel.find({ _id: { $in: teamIds } }).lean();
  }

  /** Paged (and now searchable) version of findAllForUser, for app-generic-table. */
  async findPageForUser(userId: string, query: PageQuery): Promise<Page<Team>> {
    const memberships = await this.memberModel
      .find({ userId: new Types.ObjectId(userId), status: 'active' })
      .lean();
    const teamIds = memberships.map((m) => m.teamId);

    const filter: Record<string, any> = { _id: { $in: teamIds } };
    if (query.search?.trim()) {
      filter.name = { $regex: escapeRegex(query.search.trim()), $options: 'i' };
    }

    const sortField =
      query.sortField && SORTABLE_FIELDS.has(query.sortField) ? query.sortField : 'name';
    const sort: Record<string, 1 | -1> = { [sortField]: query.sortOrder === 'desc' ? -1 : 1 };

    const page = Math.max(query.page, 1);
    const pageSize = Math.max(query.pageSize, 1);

    const [data, total] = await Promise.all([
      this.teamModel
        .find(filter)
        .sort(sort)
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      this.teamModel.countDocuments(filter),
    ]);

    return { data, total };
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
