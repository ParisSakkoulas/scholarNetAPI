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
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { parsePaging } from 'src/common/utils/paging';
import { PublicationAuthorsService } from './publication-authors.service';
import { AddAuthorDto, ReorderAuthorsDto, UpdateAuthorDto } from './dto/publication-author.dto';

/** Author list of a publication. Managing it is uploader-only; members answer for themselves. */
@Controller('publications')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class PublicationAuthorsController {
  constructor(private readonly authorsService: PublicationAuthorsService) {}

  /** GET /publications/authors/invitations?page=&limit= : papers I am listed on but have not answered. */
  @Get('authors/invitations')
  invitations(@CurrentUser() user, @Query() query: Record<string, string>) {
    const { page, limit, skip } = parsePaging(query.page, query.limit);
    return this.authorsService.invitations(user.userId, page, limit, skip);
  }

  @Post(':id/authors')
  add(@CurrentUser() user, @Param('id') id: string, @Body() dto: AddAuthorDto) {
    return this.authorsService.add(user.userId, id, dto);
  }

  @Put(':id/authors/order')
  reorder(@CurrentUser() user, @Param('id') id: string, @Body() dto: ReorderAuthorsDto) {
    return this.authorsService.reorder(user.userId, id, dto.order);
  }

  @Post(':id/authors/me/accept')
  accept(@CurrentUser() user, @Param('id') id: string) {
    return this.authorsService.accept(user.userId, id);
  }

  @Post(':id/authors/me/decline')
  decline(@CurrentUser() user, @Param('id') id: string) {
    return this.authorsService.decline(user.userId, id);
  }

  @Patch(':id/authors/:authorId')
  update(
    @CurrentUser() user,
    @Param('id') id: string,
    @Param('authorId') authorId: string,
    @Body() dto: UpdateAuthorDto,
  ) {
    return this.authorsService.update(user.userId, id, authorId, dto);
  }

  @Delete(':id/authors/:authorId')
  remove(@CurrentUser() user, @Param('id') id: string, @Param('authorId') authorId: string) {
    return this.authorsService.remove(user.userId, id, authorId);
  }
}
