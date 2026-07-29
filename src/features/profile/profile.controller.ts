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
import { PositionDto } from './dto/position.dto';
import { EducationDto } from './dto/education.dto';
import { SkillDto } from './dto/skill.dto';
import { InterestDto } from './dto/interest.dto';

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
  async searchProfiles(@Query('q') query: string) {
    return this.profileService.searchProfiles(query ?? '');
  }

  // ---------------- OWN PROFILE — UPDATE ----------------

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  updateProfile(@CurrentUser() user, @Body() dto: UpdateProfileDto) {
    console.log('DTO 123 : ', dto);
    return this.profileService.updateProfile(user.userId, dto);
  }

  // ---------------- POSITIONS ----------------

  @Post('me/positions')
  @UseGuards(JwtAuthGuard)
  addPosition(@CurrentUser() user, @Body() dto: PositionDto) {
    return this.profileService.addPosition(user.userId, dto);
  }

  @Patch('me/positions/:positionId')
  @UseGuards(JwtAuthGuard)
  updatePosition(
    @CurrentUser() user,
    @Param('positionId') positionId: string,
    @Body() dto: PositionDto,
  ) {
    return this.profileService.updatePosition(user.userId, positionId, dto);
  }

  @Delete('me/positions/:positionId')
  @UseGuards(JwtAuthGuard)
  removePosition(@CurrentUser() user, @Param('positionId') positionId: string) {
    return this.profileService.removePosition(user.userId, positionId);
  }

  // ---------------- EDUCATION ----------------

  @Post('me/education')
  @UseGuards(JwtAuthGuard)
  addEducation(@CurrentUser() user, @Body() dto: EducationDto) {
    return this.profileService.addEducation(user.userId, dto);
  }

  @Patch('me/education/:educationId')
  @UseGuards(JwtAuthGuard)
  updateEducation(
    @CurrentUser() user,
    @Param('educationId') educationId: string,
    @Body() dto: EducationDto,
  ) {
    return this.profileService.updateEducation(user.userId, educationId, dto);
  }

  @Delete('me/education/:educationId')
  @UseGuards(JwtAuthGuard)
  removeEducation(@CurrentUser() user, @Param('educationId') educationId: string) {
    return this.profileService.removeEducation(user.userId, educationId);
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

  // ---------------- INTERESTS ----------------

  @Post('me/interests')
  @UseGuards(JwtAuthGuard)
  addInterest(@CurrentUser() user, @Body() dto: InterestDto) {
    return this.profileService.addInterest(user.userId, dto);
  }

  @Delete('me/interests/:interestId')
  @UseGuards(JwtAuthGuard)
  removeInterest(@CurrentUser() user, @Param('interestId') interestId: string) {
    return this.profileService.removeInterest(user.userId, interestId);
  }
}
