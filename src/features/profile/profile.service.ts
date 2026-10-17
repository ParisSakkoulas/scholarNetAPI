// features/profile/profile.service.ts
import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { Profile } from './schemas/profile.schema';
import { User } from '../users/schema/user.schema';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { Position, Education, Interest } from './schemas/profile-sub.schema';
import { EducationDto } from './dto/education.dto';
import { SkillDto } from './dto/skill.dto';
import { InterestDto } from './dto/interest.dto';

const escapeRegex = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

@Injectable()
export class ProfileService {
  constructor(
    @InjectModel(Profile.name) private profileModel: Model<Profile>,
    @InjectModel(User.name) private userModel: Model<User>,
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
  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<Profile> {
    const profile = await this.profileModel.findOneAndUpdate(
      { user: userId },
      { $set: dto },
      { new: true, upsert: true },
    );

    return profile;
  }

  async incrementProfileView(userId: string): Promise<void> {
    await this.profileModel.findOneAndUpdate({ user: userId }, { $inc: { profileViews: 1 } });
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
  async searchProfiles(query: string, page = 1, limit = 10) {
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
        .select('user headline country city verified interests skills')
        .populate('user', 'firstName lastName username profilePhotoUrl')
        .lean(),
      this.profileModel.countDocuments(filter),
    ]);

    return { items, total, page, limit };
  }
}
