// features/profile/education.controller.ts
import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';

import { ProfileService } from './profile.service';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { EducationDto } from './dto/education.dto';

/** All routes act on the profile of the logged-in user. */
@Controller('profile/me/education')
@UseGuards(JwtAuthGuard)
export class EducationController {
  constructor(private readonly profileService: ProfileService) {}

  @Get()
  list(@CurrentUser() user) {
    return this.profileService.listEducation(user.userId);
  }

  @Post()
  add(@CurrentUser() user, @Body() dto: EducationDto) {
    return this.profileService.addEducation(user.userId, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user, @Param('id') id: string, @Body() dto: Partial<EducationDto>) {
    return this.profileService.updateEducation(user.userId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user, @Param('id') id: string) {
    return this.profileService.removeEducation(user.userId, id);
  }
}
