import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { User, UserSchema } from '../users/schema/user.schema';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminGuard } from '../../common/guards/admin.guard';
import { UserThrottlerGuard } from '../../common/guards/user-throttler.guard';
import { GrantCall, GrantCallSchema } from './schemas/grant-call.schema';
import { GrantSave, GrantSaveSchema } from './schemas/grant-save.schema';
import { GrantPreference, GrantPreferenceSchema } from './schemas/grant-preference.schema';
import { GrantsController } from './grants.controller';
import { GrantsService } from './grants.service';
import { Proposal, ProposalSchema } from './schemas/proposal.schema';
import { ProposalSection, ProposalSectionSchema } from './schemas/proposal-section.schema';
import { ProposalFile, ProposalFileSchema } from './schemas/proposal-file.schema';
import { ProposalsController } from './proposals.controller';
import { ProposalsService } from './proposals.service';
import { ProposalReviewsService } from './proposal-reviews.service';
import { SnippetsController } from './snippets.controller';
import { SnippetsService } from './snippets.service';
import { Snippet, SnippetSchema } from './schemas/snippet.schema';
import { ProposalReview, ProposalReviewSchema } from './schemas/proposal-review.schema';
import { Comment, CommentSchema } from '../tasks/schema/comment.schema';
import { Supervision, SupervisionSchema } from '../supervisions/schemas/supervision.schema';
import { Task, TaskSchema } from '../tasks/schema/task.schema';
import { TeamsModule } from '../teams/teams.module';
import { ProjectsModule } from '../projects/projects.module';
import { StorageModule } from '../../common/storage/storage.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: GrantCall.name, schema: GrantCallSchema },
      { name: GrantSave.name, schema: GrantSaveSchema },
      { name: GrantPreference.name, schema: GrantPreferenceSchema },
      { name: Proposal.name, schema: ProposalSchema },
      { name: ProposalSection.name, schema: ProposalSectionSchema },
      { name: ProposalFile.name, schema: ProposalFileSchema },
      { name: Task.name, schema: TaskSchema },
      { name: Snippet.name, schema: SnippetSchema },
      { name: ProposalReview.name, schema: ProposalReviewSchema },
      { name: Comment.name, schema: CommentSchema },
      { name: Supervision.name, schema: SupervisionSchema },
      { name: User.name, schema: UserSchema },
    ]),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    NotificationsModule,
    TeamsModule,
    ProjectsModule,
    StorageModule,
  ],
  controllers: [GrantsController, ProposalsController, SnippetsController],
  providers: [GrantsService, ProposalsService, ProposalReviewsService, SnippetsService, AdminGuard, UserThrottlerGuard],
})
export class GrantsModule {}
