import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { TeamMember } from '../teams/schema/team-member.schema';
import { Snippet } from './schemas/snippet.schema';
import { CreateSnippetDto, ListSnippetsQuery, UpdateSnippetDto } from './dto/snippet.dto';
import { escapeRegex } from './util/grant-filter.util';

const PERSON_FIELDS = 'username firstName lastName';

const oid = (id: string) => {
  if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Snippet not found');
  return new Types.ObjectId(id);
};

@Injectable()
export class SnippetsService {
  constructor(
    @InjectModel(Snippet.name) private snippetModel: Model<Snippet>,
    @InjectModel(TeamMember.name) private memberModel: Model<TeamMember>,
  ) {}

  /** teamId -> my role, for the teams I am an active member of. */
  private async myTeams(userId: string) {
    const rows = await this.memberModel
      .find({ userId: new Types.ObjectId(userId), status: 'active' })
      .select('teamId role')
      .lean();
    return new Map(rows.map((r) => [r.teamId.toString(), r.role]));
  }

  /** What the caller can do with a snippet: read it, and whether they may change or delete it. */
  private async accessFor(snippet: Snippet, userId: string) {
    if (!snippet.teamId) {
      return snippet.ownerId.toString() === userId ? { canEdit: true } : null;
    }
    const role = (await this.myTeams(userId)).get(snippet.teamId.toString());
    if (!role) return null; // not in the team: it does not exist for them
    // the author, and the team's admins and owner, can change it; viewers only read
    const canEdit = role !== 'viewer' && (snippet.ownerId.toString() === userId || role === 'owner' || role === 'admin');
    return { canEdit };
  }

  private async load(id: string, userId: string) {
    const snippet = await this.snippetModel.findById(oid(id));
    if (!snippet) throw new NotFoundException('Snippet not found');
    const access = await this.accessFor(snippet, userId);
    if (!access) throw new NotFoundException('Snippet not found');
    return { snippet, ...access };
  }

  // ---------------- library ----------------

  /** My personal snippets plus those of every team I am in, newest first. */
  async list(userId: string, query: ListSnippetsQuery) {
    const uid = new Types.ObjectId(userId);
    const teams = await this.myTeams(userId);
    const teamIds = [...teams.keys()].map((t) => new Types.ObjectId(t));

    const scope = query.scope;
    const or: Record<string, unknown>[] = [];
    if (!scope || scope === 'personal') or.push({ teamId: null, ownerId: uid });
    if (!scope || scope === 'team') or.push({ teamId: { $in: teamIds } });
    if (scope && scope !== 'personal' && scope !== 'team') {
      // one specific team, and only one the caller belongs to
      if (!Types.ObjectId.isValid(scope) || !teams.has(scope)) return [];
      or.push({ teamId: new Types.ObjectId(scope) });
    }

    const filter: Record<string, unknown> = { $or: or };
    if (query.type) filter.type = query.type;
    if (query.search?.trim()) {
      const rx = { $regex: escapeRegex(query.search.trim()), $options: 'i' };
      filter.$and = [{ $or: [{ title: rx }, { content: rx }] }];
    }

    const snippets = await this.snippetModel
      .find(filter)
      .sort({ updatedAt: -1 })
      .populate('teamId', 'name')
      .populate('ownerId', PERSON_FIELDS)
      .lean();

    return snippets.map((s) => {
      const teamId = (s.teamId as any)?._id?.toString();
      const role = teamId ? teams.get(teamId) : undefined;
      const mine = (s.ownerId as any)?._id?.toString() === userId;
      const canEdit = teamId ? role !== 'viewer' && (mine || role === 'owner' || role === 'admin') : mine;
      return { ...s, canEdit };
    });
  }

  async create(userId: string, dto: CreateSnippetDto) {
    let teamId: Types.ObjectId | undefined;
    if (dto.teamId) {
      teamId = oid(dto.teamId);
      const role = (await this.myTeams(userId)).get(teamId.toString());
      if (!role || role === 'viewer') {
        throw new ForbiddenException('You need to be an active member of this team (not a viewer) to share a snippet with it');
      }
    }
    return this.snippetModel.create({
      ownerId: new Types.ObjectId(userId),
      teamId,
      type: dto.type,
      title: dto.title,
      content: dto.content,
    });
  }

  async update(id: string, userId: string, dto: UpdateSnippetDto) {
    const { snippet, canEdit } = await this.load(id, userId);
    if (!canEdit) throw new ForbiddenException('Only the author or the team\'s admins and owner can change this snippet');
    snippet.set(dto);
    await snippet.save();
    return snippet;
  }

  async remove(id: string, userId: string) {
    const { snippet, canEdit } = await this.load(id, userId);
    if (!canEdit) throw new ForbiddenException('Only the author or the team\'s admins and owner can delete this snippet');
    await snippet.deleteOne();
    return { deleted: true };
  }
}
