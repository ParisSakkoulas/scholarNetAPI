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
import { UserThrottlerGuard } from '../../common/guards/user-throttler.guard';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Access, SupervisionAccess, SupervisionAccessGuard } from './guards/supervision-access.guard';
import { ThesisDocumentsService } from './thesis-documents.service';
import {
  CreateCommentDto,
  CreateDocumentDto,
  CreateWorkspaceDto,
  ResolveCommentDto,
  SaveDraftDto,
  UpdateDocumentStatusDto,
  UploadVersionDto,
} from './dto/thesis-document.dto';

export { UserThrottlerGuard };

/** Hard ceiling for multer's in-memory buffer; the configurable limit is checked in the service. */
const MULTER_CEILING = 100 * 1024 * 1024;

const pipe = new ValidationPipe({ transform: true, whitelist: true });
const guards = [JwtAuthGuard, SupervisionAccessGuard, UserThrottlerGuard] as const;

@Controller('supervisions/:id/documents')
@UseGuards(...guards)
@UsePipes(pipe)
export class SupervisionDocumentsController {
  constructor(private readonly service: ThesisDocumentsService) {}

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  create(@Access() access: SupervisionAccess, @Body() dto: CreateDocumentDto) {
    return this.service.create(access, dto);
  }

  /** The supervision co-working document (null until the student starts it). */
  @Get('workspace')
  workspace(@Access() access: SupervisionAccess) {
    return this.service.getWorkspace(access);
  }

  @Post('workspace')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  createWorkspace(@Access() access: SupervisionAccess, @Body() dto: CreateWorkspaceDto) {
    return this.service.createWorkspace(access, dto);
  }

  /** GET ?milestoneId= &meetingId= */
  @Get()
  list(
    @Access() access: SupervisionAccess,
    @Query('milestoneId') milestoneId?: string,
    @Query('meetingId') meetingId?: string,
  ) {
    return this.service.list(access, { milestoneId, meetingId });
  }
}

@Controller('documents/:docId')
@UseGuards(...guards)
@UsePipes(pipe)
export class ThesisDocumentsController {
  constructor(private readonly service: ThesisDocumentsService) {}

  @Get()
  get(@Access() access: SupervisionAccess, @Param('docId') docId: string) {
    return this.service.get(access, docId);
  }

  /** multipart/form-data: file (required), note */
  @Post('versions')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MULTER_CEILING, files: 1 } }))
  uploadVersion(
    @Access() access: SupervisionAccess,
    @Param('docId') docId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadVersionDto,
  ) {
    return this.service.uploadVersion(access, docId, file, dto);
  }

  // ---- co-working document: live draft and snapshots ----

  @Get('draft')
  draft(@Access() access: SupervisionAccess, @Param('docId') docId: string) {
    return this.service.getDraft(access, docId);
  }

  /** Autosave, called every couple of seconds while the student types. */
  @Put('draft')
  @Throttle({ default: { limit: 90, ttl: 60_000 } })
  saveDraft(
    @Access() access: SupervisionAccess,
    @Param('docId') docId: string,
    @Body() dto: SaveDraftDto,
  ) {
    return this.service.saveDraft(access, docId, dto);
  }

  @Post('versions/editor')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  saveEditorVersion(
    @Access() access: SupervisionAccess,
    @Param('docId') docId: string,
    @Body() dto: UploadVersionDto,
  ) {
    return this.service.saveEditorVersion(access, docId, dto);
  }

  @Get('versions/:number/content')
  versionContent(
    @Access() access: SupervisionAccess,
    @Param('docId') docId: string,
    @Param('number') number: string,
  ) {
    return this.service.versionContent(access, docId, number);
  }

  /** Streams the file after the access check. The client must send the JWT (fetch + blob). */
  @Get('versions/:number/file')
  async file(
    @Access() access: SupervisionAccess,
    @Param('docId') docId: string,
    @Param('number') number: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { stream, name, mimeType, size } = await this.service.openVersionFile(access, docId, number);
    res.set({
      'Content-Type': mimeType,
      'Content-Length': String(size),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(stream);
  }

  @Patch('status')
  setStatus(
    @Access() access: SupervisionAccess,
    @Param('docId') docId: string,
    @Body() dto: UpdateDocumentStatusDto,
  ) {
    return this.service.setStatus(access, docId, dto);
  }

  /** GET ?versionId= &status=open|resolved */
  @Get('comments')
  comments(
    @Access() access: SupervisionAccess,
    @Param('docId') docId: string,
    @Query('versionId') versionId?: string,
    @Query('status') status?: string,
  ) {
    return this.service.listComments(access, docId, { versionId, status });
  }

  @Post('comments')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  addComment(
    @Access() access: SupervisionAccess,
    @Param('docId') docId: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.service.addComment(access, docId, dto);
  }
}

@Controller('comments/:commentId')
@UseGuards(...guards)
@UsePipes(pipe)
export class DocumentCommentsController {
  constructor(private readonly service: ThesisDocumentsService) {}

  @Patch('resolve')
  resolve(
    @Access() access: SupervisionAccess,
    @Param('commentId') commentId: string,
    @Body() dto: ResolveCommentDto,
  ) {
    return this.service.resolveComment(access, commentId, dto);
  }

  @Delete()
  remove(@Access() access: SupervisionAccess, @Param('commentId') commentId: string) {
    return this.service.deleteComment(access, commentId);
  }
}
