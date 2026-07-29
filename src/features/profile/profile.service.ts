// features/profile/profile.service.ts
import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { Profile } from './schemas/profile.schema';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { Position } from './schemas/profile-sub.schema';
import { EducationDto } from './dto/education.dto';
import { SkillDto } from './dto/skill.dto';
import { InterestDto } from './dto/interest.dto';

@Injectable()
export class ProfileService {
  constructor(@InjectModel(Profile.name) private profileModel: Model<Profile>) {}

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

  async updatePosition(userId: string, positionId: string, dto: Position): Promise<Profile> {
    const profile = await this.profileModel.findOneAndUpdate(
      { user: userId, 'positions._id': positionId },
      {
        $set: {
          'positions.$.title': dto.title,
          'positions.$.institution': dto.institution,
          'positions.$.department': dto.department,
          'positions.$.startDate': dto.startDate,
          'positions.$.endDate': dto.endDate ?? null,
          'positions.$.current': dto.current ?? false,
        },
      },
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

  async updateEducation(userId: string, educationId: string, dto: EducationDto): Promise<Profile> {
    const profile = await this.profileModel.findOneAndUpdate(
      { user: userId, 'education._id': educationId },
      {
        $set: {
          'education.$.degree': dto.degree,
          'education.$.institution': dto.institution,
          'education.$.startYear': dto.startYear,
          'education.$.endYear': dto.endYear ?? null,
        },
      },
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
    const profile = await this.profileModel.findOne({ user: userId });
    if (!profile) throw new NotFoundException('Profile not found.');

    const exists = profile.skills.some((s) => s.name.toLowerCase() === dto.name.toLowerCase());
    if (exists) throw new ConflictException('Skill already added.');

    profile.skills.push({ name: dto.name, endorsementCount: 0 } as any);
    return profile.save();
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

  async addInterest(userId: string, dto: InterestDto): Promise<Profile> {
    const profile = await this.profileModel.findOne({ user: userId });
    if (!profile) throw new NotFoundException('Profile not found.');

    const exists = profile.interests.some((i) => i.name.toLowerCase() === dto.name.toLowerCase());
    if (exists) throw new ConflictException('Interest already added.');

    profile.interests.push({ name: dto.name } as any);
    return profile.save();
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

  async searchProfiles(query: string, limit = 20) {
    return this.profileModel
      .find({
        $or: [
          { headline: { $regex: query, $options: 'i' } },
          { country: { $regex: query, $options: 'i' } },
          { 'interests.label': { $regex: query, $options: 'i' } },
        ],
      })
      .limit(limit)
      .populate('user', 'firstName lastName username profilePhotoUrl');
  }
}
