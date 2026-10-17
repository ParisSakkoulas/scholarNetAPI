// features/profile/profile.controller.ts
import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';

import { ProfileService } from './profile.service';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { SkillDto } from './dto/skill.dto';

@Controller('profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  // ---------------- READ ----------------

  /** Public — anyone can view a profile by userId. Counts as a profile view. */
  @Get(':userId')
  async getProfile(@Param('userId') userId: string) {
    const profile = await this.profileService.getByUserId(userId);
    // this.profileService.incrementProfileView(userId);
    return profile;
  }

  @Get()
  async searchProfiles(
    @Query('q') query: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.profileService.searchProfiles(query ?? '', Number(page), Number(limit));
  }

  // ---------------- OWN PROFILE — UPDATE ----------------

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  updateProfile(@CurrentUser() user, @Body() dto: UpdateProfileDto) {
    console.log('DTO 123 : ', dto);
    return this.profileService.updateProfile(user.userId, dto);
  }

  // ---------------- SKILLS ----------------

  @Post('me/skills')
  @UseGuards(JwtAuthGuard)
  addSkill(@CurrentUser() user, @Body() dto: SkillDto) {
    return this.profileService.addSkill(user.userId, dto);
  }

  @Delete('me/skills/:skillId')
  @UseGuards(JwtAuthGuard)
  removeSkill(@CurrentUser() user, @Param('skillId') skillId: string) {
    return this.profileService.removeSkill(user.userId, skillId);
  }
}
