import {
  BadRequestException,
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
import { PublicationType } from 'src/common/enums/publication-type.enum';
import { parsePaging } from 'src/common/utils/paging';
import { PublicationQuery, PublicationsService } from './publications.service';
import { ReferencesService } from './references.service';
import { PublicationFilesService } from './publication-files.service';
import { PublicationAuthorsService } from './publication-authors.service';
import { CreatePublicationDto } from './dto/create-publication.dto';
import { UpdatePublicationDto } from './dto/update-publication.dto';

/**
 * whitelist is off on purpose: type-specific fields (journalName, degree...) are not in the
 * DTO; they are validated by the Mongoose discriminator for the chosen `type`.
 */
@Controller('publications')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: false }))
export class PublicationsController {
  constructor(
    private readonly publicationsService: PublicationsService,
    private readonly referencesService: ReferencesService,
    private readonly filesService: PublicationFilesService,
    private readonly authorsService: PublicationAuthorsService,
  ) {}

  // ---------------- CREATE ----------------

  @Post()
  async create(@CurrentUser() user, @Body() dto: CreatePublicationDto) {
    const created = await this.publicationsService.create(user.userId, dto);
    // background: link waiting references and import its reference list; never blocks the response
    void this.referencesService.onPublicationSaved(String(created!._id));
    // invite the listed members; also in the background
    void this.authorsService.notifyInvites(user.userId, String(created!._id));
    return created;
  }

  // ---------------- READ ----------------

  /**
   * GET /publications?q=&type=&yearFrom=&yearTo=&field=&keyword=&authorId=&page=1&limit=20
   * Everything the logged-in user may see.
   */
  @Get()
  search(@CurrentUser() user, @Query() query: Record<string, string>) {
    return this.publicationsService.search(user.userId, this.toQuery(query));
  }

  /** My own publications (including private ones). Same filters as the search. */
  @Get('me')
  mine(@CurrentUser() user, @Query() query: Record<string, string>) {
    return this.publicationsService.getMine(user.userId, this.toQuery(query));
  }

  /** A user's publications, filtered by what I am allowed to see. */
  @Get('user/:userId')
  byUser(
    @CurrentUser() user,
    @Param('userId') userId: string,
    @Query() query: Record<string, string>,
  ) {
    return this.publicationsService.getByUser(user.userId, userId, this.toQuery(query));
  }

  @Get(':id')
  getOne(@CurrentUser() user, @Param('id') id: string) {
    return this.publicationsService.getOne(user.userId, id);
  }

  // ---------------- UPDATE (uploader or confirmed co-author) / DELETE (uploader only) ----------------

  @Patch(':id')
  async update(@CurrentUser() user, @Param('id') id: string, @Body() dto: UpdatePublicationDto) {
    const updated = await this.publicationsService.update(user.userId, id, dto);
    // new identity (DOI/OpenAlex id): link waiting references. The user triggers a re-sync themselves.
    if (dto.identifiers) void this.referencesService.linkIncoming(id);
    return updated;
  }

  @Delete(':id')
  async remove(@CurrentUser() user, @Param('id') id: string) {
    const files = await this.publicationsService.fileKeys(user.userId, id);
    const result = await this.publicationsService.remove(user.userId, id);
    await this.filesService.purge(id, files); // stored PDFs/slides and access requests
    return result;
  }

  // ---------------- HELPERS ----------------

  private toQuery(raw: Record<string, string>): PublicationQuery {
    if (raw.type && !Object.values(PublicationType).includes(raw.type as PublicationType)) {
      throw new BadRequestException('Unknown publication type.');
    }
    const year = (v?: string) => parseInt(v ?? '', 10) || undefined;
    return {
      ...parsePaging(raw.page, raw.limit),
      q: raw.q,
      type: raw.type as PublicationType | undefined,
      yearFrom: year(raw.yearFrom),
      yearTo: year(raw.yearTo),
      field: raw.field,
      keyword: raw.keyword,
      authorId: raw.authorId,
    };
  }
}
