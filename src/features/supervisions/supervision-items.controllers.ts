import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { UserThrottlerGuard } from './thesis-documents.controllers';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Access, SupervisionAccess, SupervisionAccessGuard } from './guards/supervision-access.guard';
import { MilestonesService } from './milestones.service';
import { MeetingsService } from './meetings.service';
import { ActionItemsService } from './action-items.service';
import { ApplyTemplateDto, CreateMilestoneDto, UpdateMilestoneDto } from './dto/milestone.dto';
import { AgendaItemDto, CreateMeetingDto, UpdateMeetingDto } from './dto/meeting.dto';
import { CreateActionItemDto, UpdateActionItemDto } from './dto/action-item.dto';

// The guard runs once per request and is the only permission check; services just scope by id.
const pipe = new ValidationPipe({ transform: true, whitelist: true });

@Controller('supervisions/:id/milestones')
@UseGuards(JwtAuthGuard, SupervisionAccessGuard)
@UsePipes(pipe)
export class MilestonesController {
  constructor(private readonly service: MilestonesService) {}

  @Get()
  list(@Access() access: SupervisionAccess) {
    return this.service.list(access);
  }

  @Post()
  create(@Access() access: SupervisionAccess, @Body() dto: CreateMilestoneDto) {
    return this.service.create(access, dto);
  }

  @Post('template')
  applyTemplate(@Access() access: SupervisionAccess, @Body() dto: ApplyTemplateDto) {
    return this.service.applyTemplate(access, dto);
  }

  @Patch(':milestoneId')
  update(
    @Access() access: SupervisionAccess,
    @Param('milestoneId') milestoneId: string,
    @Body() dto: UpdateMilestoneDto,
  ) {
    return this.service.update(access, milestoneId, dto);
  }

  @Delete(':milestoneId')
  remove(@Access() access: SupervisionAccess, @Param('milestoneId') milestoneId: string) {
    return this.service.remove(access, milestoneId);
  }
}

@Controller('supervisions/:id/meetings')
@UseGuards(JwtAuthGuard, SupervisionAccessGuard)
@UsePipes(pipe)
export class MeetingsController {
  constructor(private readonly service: MeetingsService) {}

  @Get()
  list(@Access() access: SupervisionAccess) {
    return this.service.list(access);
  }

  @Post()
  create(@Access() access: SupervisionAccess, @Body() dto: CreateMeetingDto) {
    return this.service.create(access, dto);
  }

  @Get(':meetingId')
  get(@Access() access: SupervisionAccess, @Param('meetingId') meetingId: string) {
    return this.service.get(access, meetingId);
  }

  @Patch(':meetingId')
  update(
    @Access() access: SupervisionAccess,
    @Param('meetingId') meetingId: string,
    @Body() dto: UpdateMeetingDto,
  ) {
    return this.service.update(access, meetingId, dto);
  }

  @Delete(':meetingId')
  remove(@Access() access: SupervisionAccess, @Param('meetingId') meetingId: string) {
    return this.service.remove(access, meetingId);
  }

  @Post(':meetingId/agenda')
  addAgendaItem(
    @Access() access: SupervisionAccess,
    @Param('meetingId') meetingId: string,
    @Body() dto: AgendaItemDto,
  ) {
    return this.service.addAgendaItem(access, meetingId, dto);
  }

  @Delete(':meetingId/agenda/:itemId')
  removeAgendaItem(
    @Access() access: SupervisionAccess,
    @Param('meetingId') meetingId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.service.removeAgendaItem(access, meetingId, itemId);
  }
}

@Controller('supervisions/:id/action-items')
@UseGuards(JwtAuthGuard, SupervisionAccessGuard)
@UsePipes(pipe)
export class ActionItemsController {
  constructor(private readonly service: ActionItemsService) {}

  /** GET ?status=open|done &meetingId= &mine=true */
  @Get()
  list(
    @Access() access: SupervisionAccess,
    @Query('status') status?: string,
    @Query('meetingId') meetingId?: string,
    @Query('mine') mine?: string,
  ) {
    return this.service.list(access, { status, meetingId, mine: mine === 'true' });
  }

  @Post()
  create(@Access() access: SupervisionAccess, @Body() dto: CreateActionItemDto) {
    return this.service.create(access, dto);
  }

  @Patch(':itemId')
  update(
    @Access() access: SupervisionAccess,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateActionItemDto,
  ) {
    return this.service.update(access, itemId, dto);
  }

  @Delete(':itemId')
  remove(@Access() access: SupervisionAccess, @Param('itemId') itemId: string) {
    return this.service.remove(access, itemId);
  }

  /** multipart/form-data: file. Supervisors only. */
  @Post(':itemId/files')
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024, files: 1 } }))
  addFile(
    @Access() access: SupervisionAccess,
    @Param('itemId') itemId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.service.addFile(access, itemId, file);
  }

  /** Streams the file after the access check. The client must send the JWT (fetch + blob). */
  @Get(':itemId/files/:fileId')
  async file(
    @Access() access: SupervisionAccess,
    @Param('itemId') itemId: string,
    @Param('fileId') fileId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { stream, name, mimeType, size } = await this.service.openFile(access, itemId, fileId);
    res.set({
      'Content-Type': mimeType,
      'Content-Length': String(size),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(stream);
  }

  @Delete(':itemId/files/:fileId')
  removeFile(
    @Access() access: SupervisionAccess,
    @Param('itemId') itemId: string,
    @Param('fileId') fileId: string,
  ) {
    return this.service.removeFile(access, itemId, fileId);
  }
}
