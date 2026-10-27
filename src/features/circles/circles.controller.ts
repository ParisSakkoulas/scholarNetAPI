import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UserThrottlerGuard } from '../../common/guards/user-throttler.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CirclesService } from './circles.service';
import { CircleSessionsService } from './circle-sessions.service';
import {
  CheckoutDto,
  CreateCircleDto,
  GoalDto,
  ListCirclesQuery,
  ReportCircleDto,
  UpdateCircleDto,
  UpdateMemberDto,
  UpdateSessionDto,
} from './dto/circle.dto';

/** Tighter limit for actions that create or spam-prone records. */
const WRITE_LIMIT = { default: { limit: 10, ttl: 60_000 } };

@Controller('circles')
@UseGuards(JwtAuthGuard, UserThrottlerGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class CirclesController {
  constructor(
    private readonly circles: CirclesService,
    private readonly sessions: CircleSessionsService,
  ) {}

  @Post()
  @Throttle(WRITE_LIMIT)
  create(@CurrentUser() user, @Body() dto: CreateCircleDto) {
    return this.circles.create(user.userId, dto);
  }

  @Get()
  list(@CurrentUser() user, @Query() query: ListCirclesQuery) {
    return this.circles.list(user.userId, query);
  }

  /** Declared before ':id' so "mine" is not read as an id. */
  @Get('mine')
  mine(@CurrentUser() user) {
    return this.circles.mine(user.userId);
  }

  @Get(':id')
  findOne(@CurrentUser() user, @Param('id') id: string) {
    return this.circles.findOne(id, user.userId);
  }

  @Patch(':id')
  update(@CurrentUser() user, @Param('id') id: string, @Body() dto: UpdateCircleDto) {
    return this.circles.update(id, user.userId, dto);
  }

  @Delete(':id')
  close(@CurrentUser() user, @Param('id') id: string) {
    return this.circles.close(id, user.userId);
  }

  @Post(':id/join')
  @Throttle(WRITE_LIMIT)
  join(@CurrentUser() user, @Param('id') id: string) {
    return this.circles.join(id, user.userId);
  }

  @Post(':id/leave')
  leave(@CurrentUser() user, @Param('id') id: string) {
    return this.circles.leave(id, user.userId);
  }

  @Patch(':id/members/:userId')
  updateMember(
    @CurrentUser() user,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.circles.updateMember(id, user.userId, userId, dto);
  }

  @Post(':id/report')
  @Throttle(WRITE_LIMIT)
  report(@CurrentUser() user, @Param('id') id: string, @Body() dto: ReportCircleDto) {
    return this.circles.report(id, user.userId, dto);
  }

  // ---------------- sessions ----------------

  @Get(':id/sessions')
  listSessions(@CurrentUser() user, @Param('id') id: string) {
    return this.sessions.list(id, user.userId);
  }

  @Get(':id/sessions/:sid')
  getSession(@CurrentUser() user, @Param('id') id: string, @Param('sid') sid: string) {
    return this.sessions.findOne(id, sid, user.userId);
  }

  @Post(':id/sessions/:sid/goal')
  setGoal(
    @CurrentUser() user,
    @Param('id') id: string,
    @Param('sid') sid: string,
    @Body() dto: GoalDto,
  ) {
    return this.sessions.setGoal(id, sid, user.userId, dto);
  }

  @Post(':id/sessions/:sid/checkout')
  checkout(
    @CurrentUser() user,
    @Param('id') id: string,
    @Param('sid') sid: string,
    @Body() dto: CheckoutDto,
  ) {
    return this.sessions.checkout(id, sid, user.userId, dto);
  }

  @Patch(':id/sessions/:sid')
  updateSession(
    @CurrentUser() user,
    @Param('id') id: string,
    @Param('sid') sid: string,
    @Body() dto: UpdateSessionDto,
  ) {
    return this.sessions.updateStatus(id, sid, user.userId, dto);
  }
}
