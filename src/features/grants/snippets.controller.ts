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
import { SnippetsService } from './snippets.service';
import { CreateSnippetDto, ListSnippetsQuery, UpdateSnippetDto } from './dto/snippet.dto';

const WRITE_LIMIT = { default: { limit: 30, ttl: 60_000 } };

@Controller('snippets')
@UseGuards(JwtAuthGuard, UserThrottlerGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class SnippetsController {
  constructor(private readonly snippets: SnippetsService) {}

  @Get()
  list(@CurrentUser() user, @Query() query: ListSnippetsQuery) {
    return this.snippets.list(user.userId, query);
  }

  @Post()
  @Throttle(WRITE_LIMIT)
  create(@CurrentUser() user, @Body() dto: CreateSnippetDto) {
    return this.snippets.create(user.userId, dto);
  }

  @Patch(':id')
  @Throttle(WRITE_LIMIT)
  update(@CurrentUser() user, @Param('id') id: string, @Body() dto: UpdateSnippetDto) {
    return this.snippets.update(id, user.userId, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user, @Param('id') id: string) {
    return this.snippets.remove(id, user.userId);
  }
}
