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
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UserThrottlerGuard } from '../../common/guards/user-throttler.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ProposalsService } from './proposals.service';
import { ProposalReviewsService } from './proposal-reviews.service';
import {
  CommentDto,
  CreateSectionDto,
  RequestReviewDto,
  RespondReviewDto,
  StartProposalDto,
  UpdateProposalDto,
  UpdateSectionDto,
} from './dto/proposal.dto';

/** Hard ceiling for multer's in-memory buffer; the configurable limit is checked in the service. */
const MULTER_CEILING = 100 * 1024 * 1024;
const WRITE_LIMIT = { default: { limit: 20, ttl: 60_000 } };

@Controller()
@UseGuards(JwtAuthGuard, UserThrottlerGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class ProposalsController {
  constructor(
    private readonly proposals: ProposalsService,
    private readonly reviews: ProposalReviewsService,
  ) {}

  /** "Start proposal" on a call. */
  @Post('grants/:callId/proposals')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  start(@CurrentUser() user, @Param('callId') callId: string, @Body() dto: StartProposalDto) {
    return this.proposals.start(user.userId, callId, dto);
  }

  @Get('proposals')
  list(@CurrentUser() user, @Query('callId') callId?: string) {
    return this.proposals.list(user.userId, callId);
  }

  /** My own track record. Declared before ':id' so "history" is not read as an id. */
  @Get('proposals/history')
  history(@CurrentUser() user) {
    return this.proposals.history(user.userId);
  }

  /** Review requests waiting for me. */
  @Get('proposals/reviews/mine')
  myReviews(@CurrentUser() user) {
    return this.reviews.mine(user.userId);
  }

  @Get('proposals/:id')
  get(@CurrentUser() user, @Param('id') id: string) {
    return this.proposals.get(id, user.userId);
  }

  @Patch('proposals/:id')
  update(@CurrentUser() user, @Param('id') id: string, @Body() dto: UpdateProposalDto) {
    return this.proposals.update(id, user.userId, dto);
  }

  @Delete('proposals/:id')
  remove(@CurrentUser() user, @Param('id') id: string) {
    return this.proposals.remove(id, user.userId);
  }

  // ---- sections ----

  @Post('proposals/:id/sections')
  @Throttle(WRITE_LIMIT)
  addSection(@CurrentUser() user, @Param('id') id: string, @Body() dto: CreateSectionDto) {
    return this.proposals.addSection(id, user.userId, dto);
  }

  @Patch('proposals/:id/sections/:sid')
  updateSection(
    @CurrentUser() user,
    @Param('id') id: string,
    @Param('sid') sid: string,
    @Body() dto: UpdateSectionDto,
  ) {
    return this.proposals.updateSection(id, sid, user.userId, dto);
  }

  @Delete('proposals/:id/sections/:sid')
  removeSection(@CurrentUser() user, @Param('id') id: string, @Param('sid') sid: string) {
    return this.proposals.removeSection(id, sid, user.userId);
  }

  // ---- review and comments ----

  /** Teammates and supervisors that can be asked to review. */
  @Get('proposals/:id/reviewers')
  reviewers(@CurrentUser() user, @Param('id') id: string) {
    return this.reviews.candidates(id, user.userId);
  }

  @Post('proposals/:id/sections/:sid/reviews')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  requestReview(
    @CurrentUser() user,
    @Param('id') id: string,
    @Param('sid') sid: string,
    @Body() dto: RequestReviewDto,
  ) {
    return this.reviews.request(id, sid, user.userId, dto);
  }

  @Patch('proposals/:id/reviews/:rid')
  respondReview(
    @CurrentUser() user,
    @Param('id') id: string,
    @Param('rid') rid: string,
    @Body() dto: RespondReviewDto,
  ) {
    return this.reviews.respond(id, rid, user.userId, dto);
  }

  @Delete('proposals/:id/reviews/:rid')
  cancelReview(@CurrentUser() user, @Param('id') id: string, @Param('rid') rid: string) {
    return this.reviews.cancel(id, rid, user.userId);
  }

  @Get('proposals/:id/sections/:sid/comments')
  comments(@CurrentUser() user, @Param('id') id: string, @Param('sid') sid: string) {
    return this.reviews.listComments(id, sid, user.userId);
  }

  @Post('proposals/:id/sections/:sid/comments')
  @Throttle(WRITE_LIMIT)
  addComment(
    @CurrentUser() user,
    @Param('id') id: string,
    @Param('sid') sid: string,
    @Body() dto: CommentDto,
  ) {
    return this.reviews.addComment(id, sid, user.userId, dto);
  }

  @Delete('proposals/:id/comments/:cid')
  removeComment(@CurrentUser() user, @Param('id') id: string, @Param('cid') cid: string) {
    return this.reviews.removeComment(id, cid, user.userId);
  }

  // ---- attached drafts ----

  @Post('proposals/:id/sections/:sid/files')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MULTER_CEILING, files: 1 } }))
  upload(
    @CurrentUser() user,
    @Param('id') id: string,
    @Param('sid') sid: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.proposals.uploadFile(id, sid, user.userId, file);
  }

  @Get('proposals/:id/files/:fid')
  async download(
    @CurrentUser() user,
    @Param('id') id: string,
    @Param('fid') fid: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { stream, name, mimeType, size } = await this.proposals.openFile(id, fid, user.userId);
    res.set({
      'Content-Type': mimeType,
      'Content-Length': String(size),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(stream);
  }

  @Delete('proposals/:id/files/:fid')
  removeFile(@CurrentUser() user, @Param('id') id: string, @Param('fid') fid: string) {
    return this.proposals.removeFile(id, fid, user.userId);
  }
}
