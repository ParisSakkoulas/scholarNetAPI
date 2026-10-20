// features/profile/profile.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { ProfileController } from './profile.controller';
import { PositionsController } from './positions.controller';
import { EducationController } from './education.controller';
import { InterestsController } from './interests.controller';
import { ProfileService } from './profile.service';
import { Profile, ProfileSchema } from './schemas/profile.schema';
import { MailModule } from '../mail';
import { Follow, FollowSchema } from '../follows/schemas/follow.schema';
import { User, UserSchema } from '../users/schema/user.schema';
import { ProfileView, ProfileViewSchema } from './schemas/profile-view.schema';
import { Publication, PublicationSchema } from '../publications/schemas/publication.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Profile.name, schema: ProfileSchema },
      { name: User.name, schema: UserSchema },
      { name: Follow.name, schema: FollowSchema },
      { name: ProfileView.name, schema: ProfileViewSchema },
      { name: Publication.name, schema: PublicationSchema },
    ]),
    MailModule,
  ],
  controllers: [ProfileController, PositionsController, EducationController, InterestsController],
  providers: [ProfileService],
  exports: [ProfileService],
})
export class ProfileModule {}
