import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Rating, RatingSchema } from './schemas/rating.schema';
import { Publication, PublicationSchema } from '../publications/schemas/publication.schema';
import { PublicationsModule } from '../publications/publications.module';
import { RatingsService } from './ratings.service';
import { RatingsController } from './ratings.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Rating.name, schema: RatingSchema },
      // discriminators are registered once, in PublicationsModule
      { name: Publication.name, schema: PublicationSchema },
    ]),
    PublicationsModule,
  ],
  controllers: [RatingsController],
  providers: [RatingsService],
})
export class RatingsModule {}
