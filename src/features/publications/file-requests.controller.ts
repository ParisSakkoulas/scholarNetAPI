import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { AccessRequestStatus } from 'src/common/enums/file-access.enum';
import { parsePaging } from 'src/common/utils/paging';
import { PublicationFilesService } from './publication-files.service';
import { DecideFileAccessDto } from './dto/publication-file.dto';

/** Access requests, from both sides: the ones I received as uploader and the ones I sent. */
@Controller('file-requests')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class FileRequestsController {
  constructor(private readonly filesService: PublicationFilesService) {}

  /** GET /file-requests/incoming?status=pending&page=1&limit=20 */
  @Get('incoming')
  incoming(
    @CurrentUser() user,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    if (status && !Object.values(AccessRequestStatus).includes(status as AccessRequestStatus)) {
      throw new BadRequestException('Unknown status.');
    }
    const p = parsePaging(page, limit);
    return this.filesService.incoming(
      user.userId,
      status as AccessRequestStatus | undefined,
      p.page,
      p.limit,
      p.skip,
    );
  }

  /** GET /file-requests/mine */
  @Get('mine')
  mine(@CurrentUser() user, @Query('page') page?: string, @Query('limit') limit?: string) {
    const p = parsePaging(page, limit);
    return this.filesService.mine(user.userId, p.page, p.limit, p.skip);
  }

  /** PATCH /file-requests/:requestId  { decision: 'approve' | 'reject' } (uploader only) */
  @Patch(':requestId')
  decide(
    @CurrentUser() user,
    @Param('requestId') requestId: string,
    @Body() dto: DecideFileAccessDto,
  ) {
    return this.filesService.decide(user.userId, requestId, dto);
  }

  /** Withdraw my own request. */
  @Delete(':requestId')
  cancel(@CurrentUser() user, @Param('requestId') requestId: string) {
    return this.filesService.cancelRequest(user.userId, requestId);
  }
}
