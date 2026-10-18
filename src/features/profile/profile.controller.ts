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
import { OptionalJwtAuthGuard } from 'src/common/guards/optional-jwt-auth.guard';

@Controller('profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  // ---------------- READ ----------------

  /**
   * Anyone can view a profile by userId, but location, website and phone are only included
   * when the owner's visibility setting allows it for this viewer (anonymous, signed in, or
   * connected = they follow each other).
   */
  @Get(':userId')
  @UseGuards(OptionalJwtAuthGuard)
  async getProfile(@CurrentUser() viewer, @Param('userId') userId: string) {
    return this.profileService.getForViewer(userId, viewer?.userId);
  }

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  async searchProfiles(
    @CurrentUser() viewer,
    @Query('q') query: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.profileService.searchProfiles(
      query ?? '',
      Number(page),
      Number(limit),
      viewer?.userId,
    );
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
