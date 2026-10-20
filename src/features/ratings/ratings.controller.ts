import { Body, Controller, Delete, Get, Param, ParseEnumPipe, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from 'src/common/guards/optional-jwt-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RatingsService } from './ratings.service';
import { RatingTarget } from './schemas/rating.schema';

/** `:type` is currently only "publication". */
@Controller('ratings')
export class RatingsController {
  constructor(private readonly ratingsService: RatingsService) {}

  @Get(':type/:id')
  @UseGuards(OptionalJwtAuthGuard)
  summary(
    @CurrentUser() viewer,
    @Param('type', new ParseEnumPipe(RatingTarget)) type: RatingTarget,
    @Param('id') id: string,
  ) {
    return this.ratingsService.getSummary(viewer?.userId ?? null, type, id);
  }

  @Put(':type/:id')
  @UseGuards(JwtAuthGuard)
  rate(
    @CurrentUser() user,
    @Param('type', new ParseEnumPipe(RatingTarget)) type: RatingTarget,
    @Param('id') id: string,
    @Body('value') value: number,
  ) {
    return this.ratingsService.rate(user.userId, type, id, value);
  }

  @Delete(':type/:id')
  @UseGuards(JwtAuthGuard)
  remove(
    @CurrentUser() user,
    @Param('type', new ParseEnumPipe(RatingTarget)) type: RatingTarget,
    @Param('id') id: string,
  ) {
    return this.ratingsService.remove(user.userId, type, id);
  }
}
