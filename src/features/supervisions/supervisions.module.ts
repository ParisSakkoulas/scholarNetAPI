import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { User, UserSchema } from '../users/schema/user.schema';
import { NotificationsModule } from '../notifications/notifications.module';
import { MailModule } from '../mail/mail.module';
import { Supervision, SupervisionSchema } from './schemas/supervision.schema';
import { Milestone, MilestoneSchema } from './schemas/milestone.schema';
import { Meeting, MeetingSchema } from './schemas/meeting.schema';
import { ActionItem, ActionItemSchema } from './schemas/action-item.schema';
import { SupervisionsController } from './supervisions.controller';
import {
  ActionItemsController,
  MeetingsController,
  MilestonesController,
} from './supervision-items.controllers';
import { SupervisionsService } from './supervisions.service';
import { MilestonesService } from './milestones.service';
import { MeetingsService } from './meetings.service';
import { ActionItemsService } from './action-items.service';
import { SupervisionRemindersService } from './supervision-reminders.service';
import { ThrottlerModule } from '@nestjs/throttler';
import { StorageModule } from '../../common/storage/storage.module';
import { ThesisDocument, ThesisDocumentSchema } from './schemas/thesis-document.schema';
import { DocumentVersion, DocumentVersionSchema } from './schemas/document-version.schema';
import { DocumentComment, DocumentCommentSchema } from './schemas/document-comment.schema';
import {
  DocumentCommentsController,
  SupervisionDocumentsController,
  ThesisDocumentsController,
  UserThrottlerGuard,
} from './thesis-documents.controllers';
import { ThesisDocumentsService } from './thesis-documents.service';
import { SupervisionAccessGuard } from './guards/supervision-access.guard';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Supervision.name, schema: SupervisionSchema },
      { name: Milestone.name, schema: MilestoneSchema },
      { name: Meeting.name, schema: MeetingSchema },
      { name: ActionItem.name, schema: ActionItemSchema },
      { name: ThesisDocument.name, schema: ThesisDocumentSchema },
      { name: DocumentVersion.name, schema: DocumentVersionSchema },
      { name: DocumentComment.name, schema: DocumentCommentSchema },
      { name: User.name, schema: UserSchema },
    ]),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    StorageModule,
    NotificationsModule,
    MailModule,
  ],
  controllers: [
    SupervisionsController,
    MilestonesController,
    MeetingsController,
    ActionItemsController,
    SupervisionDocumentsController,
    ThesisDocumentsController,
    DocumentCommentsController,
  ],
  providers: [
    SupervisionsService,
    MilestonesService,
    MeetingsService,
    ActionItemsService,
    SupervisionRemindersService,
    ThesisDocumentsService,
    SupervisionAccessGuard,
    UserThrottlerGuard,
  ],
})
export class SupervisionsModule {}
