// features/profile/interests.controller.ts
import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';

import { ProfileService } from './profile.service';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { InterestDto } from './dto/interest.dto';

/** All routes act on the profile of the logged-in user. */
@Controller('profile/me/interests')
@UseGuards(JwtAuthGuard)
export class InterestsController {
  constructor(private readonly profileService: ProfileService) {}

  @Get()
  list(@CurrentUser() user) {
    return this.profileService.listInterests(user.userId);
  }

  @Post()
  add(@CurrentUser() user, @Body() dto: InterestDto) {
    return this.profileService.addInterest(user.userId, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user, @Param('id') id: string) {
    return this.profileService.removeInterest(user.userId, id);
  }
}
