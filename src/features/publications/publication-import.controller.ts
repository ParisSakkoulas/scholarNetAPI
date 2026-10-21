import { Body, Controller, Get, Param, Post, Query, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { PublicationImportService } from './publication-import.service';
import { ImportPublicationDto } from './dto/import-publication.dto';

/** Import a publication by DOI in two steps: look it up, then import the source the user picked. */
@Controller('publications/import')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class PublicationImportController {
  constructor(private readonly importService: PublicationImportService) {}

  /**
   * GET /publications/import/lookup?doi=10.1038/nature14539
   * Nothing is saved. Returns what OpenAlex and DBLP have, and the publication already in
   * scholarNet with that DOI (`existing`), if any.
   */
  @Get('lookup')
  lookup(@CurrentUser() user, @Query('doi') doi: string) {
    return this.importService.lookup(user.userId, doi);
  }

  /** GET /publications/import/authors?name=Yann LeCun - OpenAlex authors with that name. */
  @Get('authors')
  searchAuthors(@Query('name') name: string) {
    return this.importService.searchAuthors(name);
  }

  /** GET /publications/import/authors/A5086198262/works?page=1 - their works that have a DOI. */
  @Get('authors/:authorId/works')
  authorWorks(
    @CurrentUser() user,
    @Param('authorId') authorId: string,
    @Query('page') page?: string,
  ) {
    return this.importService.authorWorks(user.userId, authorId, Number(page) || 1);
  }

  /** POST /publications/import { doi, source: "openalex" | "dblp", visibility? } */
  @Post()
  import(@CurrentUser() user, @Body() dto: ImportPublicationDto) {
    return this.importService.importPublication(user.userId, dto);
  }
}
