// features/profile/profile.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { Profile } from './schemas/profile.schema';
import { User } from '../users/schema/user.schema';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { Position, Education, Interest } from './schemas/profile-sub.schema';
import { EducationDto } from './dto/education.dto';
import { SkillDto } from './dto/skill.dto';
import { InterestDto } from './dto/interest.dto';
import { Follow } from '../follows/schemas/follow.schema';
import { ProfileView } from './schemas/profile-view.schema';
import { Publication, PublicationVisibility } from '../publications/schemas/publication.schema';
import {
  CONTACT_FIELDS,
  CONTACT_VISIBILITY_VALUES,
  ViewerRelation,
  redactContact,
} from './contact-visibility';

const PHONE_RE = /^\+?[0-9\s\-().]{6,24}$/;

const escapeRegex = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

@Injectable()
export class ProfileService {
  constructor(
    @InjectModel(Profile.name) private profileModel: Model<Profile>,
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Follow.name) private followModel: Model<Follow>,
    @InjectModel(ProfileView.name) private profileViewModel: Model<ProfileView>,
    @InjectModel(Publication.name) private publicationModel: Model<Publication>,
  ) {}

  /**
   * Every user gets a Profile document created automatically the first
   * time it's requested — called from getByUserId() as a fallback,
   * and explicitly right after registration/onboarding completes.
   */
  async createForUser(userId: string): Promise<Profile> {
    const existing = await this.profileModel.findOne({ user: userId });
    if (existing) return existing;

    const profile = new this.profileModel({ user: userId });
    return profile.save();
  }

  async getByUserId(userId: string): Promise<Profile> {
    const profile = await this.profileModel
      .findOne({ user: userId })
      .populate('user', 'firstName lastName username email profilePhotoUrl')
      .lean()
      .exec();
    if (!profile) {
      throw new NotFoundException(`Profile not found for user ${userId}`);
    }
    return profile;
  }
  /** The profile as `viewerId` (or an anonymous visitor) is allowed to see it. */
  async getForViewer(userId: string, viewerId?: string | null) {
    const profile = await this.getByUserId(userId);
    const relation = await this.relationTo(viewerId, userId);
    const stats = await this.publicationStats(userId, relation);
    return redactContact({ ...profile, ...stats }, relation);
  }

  /**
   * Publication-derived stats, computed on read so they never go stale. Counts what the
   * viewer can see: the owner sees everything, a connection sees public + followers,
   * everyone else only public.
   */
  private async publicationStats(userId: string, relation: ViewerRelation) {
    if (!Types.ObjectId.isValid(userId)) {
      return { publicationCount: 0, citationCount: 0, hIndex: 0, i10Index: 0, yearlyPublications: [] };
    }
    const visibility =
      relation === 'self'
        ? undefined
        : relation === 'connected'
          ? { $in: [PublicationVisibility.PUBLIC, PublicationVisibility.FOLLOWERS] }
          : PublicationVisibility.PUBLIC;
    const uid = new Types.ObjectId(userId);

    const pubs = await this.publicationModel
      .find({
        $or: [{ uploadedBy: uid }, { 'authors.user': uid }],
        ...(visibility && { visibility }),
      })
      .select('year metrics.citations')
      .lean();

    const citations = pubs.map((p) => p.metrics?.citations ?? 0).sort((a, b) => b - a);
    const byYear = new Map<number, number>();
    for (const p of pubs) byYear.set(p.year, (byYear.get(p.year) ?? 0) + 1);

    return {
      publicationCount: pubs.length,
      citationCount: citations.reduce((sum, c) => sum + c, 0),
      hIndex: citations.filter((c, i) => c >= i + 1).length,
      i10Index: citations.filter((c) => c >= 10).length,
      yearlyPublications: [...byYear]
        .map(([year, count]) => ({ year, count }))
        .sort((a, b) => a.year - b.year),
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<Profile> {
    const { contactVisibility, ...rest } = dto as UpdateProfileDto & {
      contactVisibility?: Record<string, string>;
    };
    const set: Record<string, unknown> = { ...rest };
    const unset: Record<string, 1> = {};

    // phone and website: an empty value clears the field
    for (const key of ['phone', 'website'] as const) {
      if (key in set && (set[key] === '' || set[key] === null)) {
        delete set[key];
        unset[key] = 1;
      }
    }
    if (typeof set['phone'] === 'string' && !PHONE_RE.test(set['phone'])) {
      throw new BadRequestException('phone must be a valid phone number.');
    }
    if (typeof set['website'] === 'string' && !/^https?:\/\/\S+$/i.test(set['website'])) {
      throw new BadRequestException('website must be a valid URL starting with http:// or https://');
    }

    // set each visibility key on its own so saving one never resets the others
    if (contactVisibility) {
      for (const [group, level] of Object.entries(contactVisibility)) {
        if (!(CONTACT_FIELDS as readonly string[]).includes(group)) continue;
        if (!(CONTACT_VISIBILITY_VALUES as readonly string[]).includes(level)) {
          throw new BadRequestException(
            `${group} visibility must be one of: ${CONTACT_VISIBILITY_VALUES.join(', ')}.`,
          );
        }
        set[`contactVisibility.${group}`] = level;
      }
    }

    const profile = await this.profileModel.findOneAndUpdate(
      { user: userId },
      {
        ...(Object.keys(set).length && { $set: set }),
        ...(Object.keys(unset).length && { $unset: unset }),
      },
      { new: true, upsert: true },
    );

    return profile;
  }

  /**
   * Counts one view per viewer per day. The owner's own visits never count; anonymous
   * visitors are told apart by IP. A duplicate-key error means "already counted today".
   */
  async recordProfileView(userId: string, viewerId?: string | null, ip?: string): Promise<void> {
    if (!Types.ObjectId.isValid(userId) || viewerId === userId) return;
    const viewer = viewerId ? `u:${viewerId}` : ip ? `ip:${ip}` : null;
    if (!viewer) return;

    try {
      await this.profileViewModel.create({
        profile: userId,
        viewer,
        day: new Date().toISOString().slice(0, 10),
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) return;
      throw err;
    }
    await this.profileModel.updateOne({ user: userId }, { $inc: { profileViews: 1 } });
  }

  // ---------------- POSITIONS ----------------

  async addPosition(userId: string, dto: Position): Promise<Profile> {
    const profile = await this.profileModel.findOneAndUpdate(
      { user: userId },
      { $push: { positions: dto } },
      { new: true, upsert: true },
    );
    return profile;
  }

  async listPositions(userId: string): Promise<Position[]> {
    const profile = await this.profileModel.findOne({ user: userId }).lean();
    return profile?.positions ?? [];
  }

  async updatePosition(userId: string, positionId: string, dto: Partial<Position>): Promise<Profile> {
    const profile = await this.profileModel.findOneAndUpdate(
      { user: userId, 'positions._id': positionId },
      { $set: this.prefixed('positions', dto) },
      { new: true },
    );
    if (!profile) throw new NotFoundException('Position not found.');
    return profile;
  }

  async removePosition(userId: string, positionId: string): Promise<Profile> {
    const profile = await this.profileModel.findOneAndUpdate(
      { user: userId },
      { $pull: { positions: { _id: positionId } } },
      { new: true },
    );
    if (!profile) throw new NotFoundException('Profile not found.');
    return profile;
  }

  // ---------------- EDUCATION ----------------

  async addEducation(userId: string, dto: EducationDto): Promise<Profile> {
    const profile = await this.profileModel.findOneAndUpdate(
      { user: userId },
      { $push: { education: dto } },
      { new: true, upsert: true },
    );
    return profile;
  }

  async listEducation(userId: string): Promise<Education[]> {
    const profile = await this.profileModel.findOne({ user: userId }).lean();
    return profile?.education ?? [];
  }

  async updateEducation(
    userId: string,
    educationId: string,
    dto: Partial<EducationDto>,
  ): Promise<Profile> {
    const profile = await this.profileModel.findOneAndUpdate(
      { user: userId, 'education._id': educationId },
      { $set: this.prefixed('education', dto) },
      { new: true },
    );
    if (!profile) throw new NotFoundException('Education entry not found.');
    return profile;
  }

  async removeEducation(userId: string, educationId: string): Promise<Profile> {
    const profile = await this.profileModel.findOneAndUpdate(
      { user: userId },
      { $pull: { education: { _id: educationId } } },
      { new: true },
    );
    if (!profile) throw new NotFoundException('Profile not found.');
    return profile;
  }

  // ---------------- SKILLS ----------------

  async addSkill(userId: string, dto: SkillDto): Promise<Profile> {
    const name = dto.name.trim();
    // Atomic push guarded by a case-insensitive duplicate check. Avoids
    // profile.save(), which re-validates the whole document (including any
    // legacy sub-documents) and made this endpoint fail.
    const profile = await this.profileModel.findOneAndUpdate(
      { user: userId, skills: { $not: { $elemMatch: { name: this.exactNameRegex(name) } } } },
      { $push: { skills: { name, endorsementCount: 0 } } },
      { new: true, upsert: false },
    );
    if (!profile) await this.throwNotFoundOrConflict(userId, 'Skill already added.');
    return profile!;
  }

  async removeSkill(userId: string, skillId: string): Promise<Profile> {
    const profile = await this.profileModel.findOneAndUpdate(
      { user: userId },
      { $pull: { skills: { _id: skillId } } },
      { new: true },
    );
    if (!profile) throw new NotFoundException('Profile not found.');
    return profile;
  }

  // ---------------- INTERESTS ----------------

  async listInterests(userId: string): Promise<Interest[]> {
    const profile = await this.profileModel.findOne({ user: userId }).lean();
    return profile?.interests ?? [];
  }

  async addInterest(userId: string, dto: InterestDto): Promise<Profile> {
    const name = dto.name.trim();
    const profile = await this.profileModel.findOneAndUpdate(
      { user: userId, interests: { $not: { $elemMatch: { name: this.exactNameRegex(name) } } } },
      { $push: { interests: { name } } },
      { new: true, upsert: false },
    );
    if (!profile) await this.throwNotFoundOrConflict(userId, 'Interest already added.');
    return profile!;
  }

  private exactNameRegex(name: string): RegExp {
    return new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  }

  /** Called when a guarded push matched nothing: no profile → 404, else it's a duplicate → 409. */
  private async throwNotFoundOrConflict(userId: string, conflictMessage: string): Promise<never> {
    const exists = await this.profileModel.exists({ user: userId });
    if (!exists) throw new NotFoundException('Profile not found.');
    throw new ConflictException(conflictMessage);
  }

  async removeInterest(userId: string, interestId: string): Promise<Profile> {
    const profile = await this.profileModel.findOneAndUpdate(
      { user: userId },
      { $pull: { interests: { _id: interestId } } },
      { new: true },
    );
    if (!profile) throw new NotFoundException('Profile not found.');
    return profile;
  }

  /** Builds a `$set` payload like { 'positions.$.title': ... } from defined dto fields only. */
  private prefixed(field: string, dto: object): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(dto)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [`${field}.$.${k}`, v]),
    );
  }

  /**
   * People search. Names live on the User document, so first find users whose
   * first name / last name / username match every word typed ("jane do"), then
   * return their profiles plus any profile matching on headline, country,
   * interests or skills. Only users that already have a Profile document appear.
   */
  async searchProfiles(query: string, page = 1, limit = 10, viewerId?: string | null) {
    const term = query?.trim();
    page = Math.max(1, Math.floor(page) || 1);
    limit = Math.min(50, Math.max(1, Math.floor(limit) || 10));
    if (!term) return { items: [], total: 0, page, limit };

    const regexOf = (text: string) => new RegExp(escapeRegex(text), 'i');
    const whole = regexOf(term);

    const users = await this.userModel
      .find({
        $and: term.split(/\s+/).map((word) => {
          const rx = regexOf(word);
          return { $or: [{ firstName: rx }, { lastName: rx }, { username: rx }] };
        }),
      })
      .select('_id')
      .lean();

    const filter = {
      $or: [
        { user: { $in: users.map((u) => u._id) } },
        { headline: whole },
        { country: whole },
        { 'interests.name': whole },
        { 'skills.name': whole },
      ],
    };

    const [items, total] = await Promise.all([
      this.profileModel
        .find(filter)
        .sort({ _id: 1 }) // stable order so pages don't overlap
        .skip((page - 1) * limit)
        .limit(limit)
        .select('user headline country city verified interests skills contactVisibility')
        .populate('user', 'firstName lastName username profilePhotoUrl')
        .lean(),
      this.profileModel.countDocuments(filter),
    ]);

    // city/country honour each person's visibility setting
    const ownerOf = (p: { user: unknown }) =>
      String((p.user as { _id?: Types.ObjectId })?._id ?? p.user);
    const connected = await this.connectedAmong(viewerId, items.map(ownerOf));
    const visible = items.map((p) => {
      const ownerId = ownerOf(p);
      const relation: ViewerRelation =
        ownerId === viewerId ? 'self' : connected.has(ownerId) ? 'connected' : 'other';
      const { contactVisibility: _omit, ...safe } = redactContact(p, relation);
      return safe;
    });

    return { items: visible, total, page, limit };
  }

  // ---------------- VISIBILITY HELPERS ----------------

  private async relationTo(
    viewerId: string | null | undefined,
    ownerId: string,
  ): Promise<ViewerRelation> {
    if (!viewerId) return 'other';
    if (viewerId === ownerId) return 'self';
    const connected = await this.connectedAmong(viewerId, [ownerId]);
    return connected.has(ownerId) ? 'connected' : 'other';
  }

  /** Which of `ownerIds` the viewer is connected with (they follow each other). */
  private async connectedAmong(viewerId: string | null | undefined, ownerIds: string[]) {
    const result = new Set<string>();
    if (!viewerId || !ownerIds.length) return result;
    const others = ownerIds.filter((id) => id !== viewerId && Types.ObjectId.isValid(id));
    if (!others.length) return result;

    const [iFollow, followMe] = await Promise.all([
      this.followModel
        .find({ follower: viewerId, following: { $in: others } })
        .select('following')
        .lean(),
      this.followModel
        .find({ following: viewerId, follower: { $in: others } })
        .select('follower')
        .lean(),
    ]);
    const mine = new Set(iFollow.map((f) => String(f.following)));
    for (const f of followMe) {
      if (mine.has(String(f.follower))) result.add(String(f.follower));
    }
    return result;
  }
}
