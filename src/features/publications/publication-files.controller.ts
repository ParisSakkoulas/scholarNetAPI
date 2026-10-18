import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { PublicationFilesService } from './publication-files.service';
import {
  RequestFileAccessDto,
  UpdatePublicationFileDto,
  UploadPublicationFileDto,
} from './dto/publication-file.dto';

/** Files of one publication (PDF / PPT / PPTX). Uploading and editing is uploader-only. */
@Controller('publications/:id/files')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class PublicationFilesController {
  constructor(private readonly filesService: PublicationFilesService) {}

  /** multipart/form-data: file (required), role, accessMode, version, embargoUntil */
  @Post()
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @CurrentUser() user,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadPublicationFileDto,
  ) {
    return this.filesService.upload(user.userId, id, file, dto);
  }

  /** Each file with `canDownload` and my access `request` (if any). */
  @Get()
  list(@CurrentUser() user, @Param('id') id: string) {
    return this.filesService.list(user.userId, id);
  }

  /** Streams the file after the access check. The client must send the JWT (fetch + blob). */
  @Get(':fileId/download')
  async download(
    @CurrentUser() user,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { stream, name, mimeType, size } = await this.filesService.download(user.userId, id, fileId);
    res.set({
      'Content-Type': mimeType,
      'Content-Length': String(size),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(stream);
  }

  @Patch(':fileId')
  update(
    @CurrentUser() user,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
    @Body() dto: UpdatePublicationFileDto,
  ) {
    return this.filesService.update(user.userId, id, fileId, dto);
  }

  @Delete(':fileId')
  remove(@CurrentUser() user, @Param('id') id: string, @Param('fileId') fileId: string) {
    return this.filesService.remove(user.userId, id, fileId);
  }

  /** Ask the uploader for access to an approval-based file. */
  @Post(':fileId/request')
  request(
    @CurrentUser() user,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
    @Body() dto: RequestFileAccessDto,
  ) {
    return this.filesService.requestAccess(user.userId, id, fileId, dto);
  }
}
