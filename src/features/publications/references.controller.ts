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
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { parsePaging } from 'src/common/utils/paging';
import { ReferencesService } from './references.service';
import { CreateReferenceDto, ImportReferencesDto, UpdateReferenceDto } from './dto/reference.dto';

/** Reference list of a publication. Reads follow publication visibility; writes are uploader-only. */
@Controller('publications/:id')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class ReferencesController {
  constructor(private readonly referencesService: ReferencesService) {}

  /** GET /publications/:id/references?page=1&limit=50 */
  @Get('references')
  list(
    @CurrentUser() user,
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const p = parsePaging(page, limit, 200);
    return this.referencesService.list(user.userId, id, p.page, p.limit, p.skip);
  }

  /** Publications on scholarNet that cite this one. */
  @Get('cited-by')
  citedBy(
    @CurrentUser() user,
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const p = parsePaging(page, limit);
    return this.referencesService.citedBy(user.userId, id, p.page, p.limit, p.skip);
  }

  @Post('references')
  add(@CurrentUser() user, @Param('id') id: string, @Body() dto: CreateReferenceDto) {
    return this.referencesService.add(user.userId, id, dto);
  }

  /** Paste BibTeX or one-reference-per-line text. */
  @Post('references/import')
  importReferences(@CurrentUser() user, @Param('id') id: string, @Body() dto: ImportReferencesDto) {
    return this.referencesService.importReferences(user.userId, id, dto);
  }

  /** "Refresh from OpenAlex": adds missing references, keeps edited and deleted ones as they are. */
  @Post('references/sync')
  sync(@CurrentUser() user, @Param('id') id: string) {
    return this.referencesService.syncFromOpenAlex(user.userId, id);
  }

  @Patch('references/:refId')
  update(
    @CurrentUser() user,
    @Param('id') id: string,
    @Param('refId') refId: string,
    @Body() dto: UpdateReferenceDto,
  ) {
    return this.referencesService.update(user.userId, id, refId, dto);
  }

  @Delete('references/:refId')
  remove(@CurrentUser() user, @Param('id') id: string, @Param('refId') refId: string) {
    return this.referencesService.remove(user.userId, id, refId);
  }
}
