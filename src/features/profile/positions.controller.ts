// features/profile/positions.controller.ts
import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';

import { ProfileService } from './profile.service';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { PositionDto } from './dto/position.dto';

/** All routes act on the profile of the logged-in user. */
@Controller('profile/me/positions')
@UseGuards(JwtAuthGuard)
export class PositionsController {
  constructor(private readonly profileService: ProfileService) {}

  @Get()
  list(@CurrentUser() user) {
    return this.profileService.listPositions(user.userId);
  }

  @Post()
  add(@CurrentUser() user, @Body() dto: PositionDto) {
    return this.profileService.addPosition(user.userId, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user, @Param('id') id: string, @Body() dto: Partial<PositionDto>) {
    return this.profileService.updatePosition(user.userId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user, @Param('id') id: string) {
    return this.profileService.removePosition(user.userId, id);
  }
}
