import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { UserThrottlerGuard } from '../../common/guards/user-throttler.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { GrantsService } from './grants.service';
import {
  CreateGrantDto,
  ListGrantsQuery,
  ManageGrantsQuery,
  MatchesQuery,
  PreferenceDto,
  ReviewGrantDto,
  UpdateGrantDto,
} from './dto/grant.dto';

/** Submissions are limited tightly: 5 per 10 minutes per user. */
const SUBMIT_LIMIT = { default: { limit: 5, ttl: 600_000 } };

@Controller('grants')
@UseGuards(JwtAuthGuard, UserThrottlerGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class GrantsController {
  constructor(private readonly grants: GrantsService) {}

  // ---- admin ----

  @Post()
  @UseGuards(AdminGuard)
  create(@CurrentUser() user, @Body() dto: CreateGrantDto) {
    return this.grants.create(user.userId, dto);
  }

  /** Moderator table. Declared before ':id' so "manage" is not read as an id. */
  @Get('manage')
  @UseGuards(AdminGuard)
  manage(@Query() query: ManageGrantsQuery) {
    return this.grants.manage(query);
  }

  @Patch(':id/review')
  @UseGuards(AdminGuard)
  review(@CurrentUser() user, @Param('id') id: string, @Body() dto: ReviewGrantDto) {
    return this.grants.review(id, user.userId, dto);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  update(@CurrentUser() user, @Param('id') id: string, @Body() dto: UpdateGrantDto) {
    return this.grants.update(id, user.userId, dto);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  remove(@Param('id') id: string) {
    return this.grants.remove(id);
  }

  // ---- users ----

  @Post('submit')
  @Throttle(SUBMIT_LIMIT)
  submit(@CurrentUser() user, @Body() dto: CreateGrantDto) {
    return this.grants.submit(user.userId, dto);
  }

  @Get('preferences')
  preferences(@CurrentUser() user) {
    return this.grants.getPreferences(user.userId);
  }

  @Put('preferences')
  setPreferences(@CurrentUser() user, @Body() dto: PreferenceDto) {
    return this.grants.setPreferences(user.userId, dto);
  }

  /** "For you": open calls that fit the saved preferences, best fit first. */
  @Get('matches')
  matches(@CurrentUser() user, @Query() query: MatchesQuery) {
    return this.grants.matches(user.userId, query);
  }

  @Get('submissions/mine')
  mySubmissions(@CurrentUser() user) {
    return this.grants.mySubmissions(user.userId);
  }

  @Get()
  list(@CurrentUser() user, @Query() query: ListGrantsQuery) {
    return this.grants.list(user.userId, query);
  }

  @Get(':id')
  findOne(@CurrentUser() user, @Param('id') id: string) {
    return this.grants.findOne(id, user.userId);
  }

  @Post(':id/save')
  save(@CurrentUser() user, @Param('id') id: string) {
    return this.grants.save(id, user.userId);
  }

  @Post(':id/dismiss')
  dismiss(@CurrentUser() user, @Param('id') id: string) {
    return this.grants.dismiss(id, user.userId);
  }

  /** Clears a save or a dismissal. */
  @Delete(':id/save')
  unmark(@CurrentUser() user, @Param('id') id: string) {
    return this.grants.unmark(id, user.userId);
  }
}
