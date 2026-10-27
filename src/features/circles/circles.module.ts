import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { User, UserSchema } from '../users/schema/user.schema';
import { NotificationsModule } from '../notifications/notifications.module';
import { UserThrottlerGuard } from '../../common/guards/user-throttler.guard';
import { Circle, CircleSchema } from './schemas/circle.schema';
import { CircleMember, CircleMemberSchema } from './schemas/circle-member.schema';
import { CircleSession, CircleSessionSchema } from './schemas/circle-session.schema';
import { CircleReport, CircleReportSchema } from './schemas/circle-report.schema';
import { CirclesController } from './circles.controller';
import { CirclesService } from './circles.service';
import { CircleSessionsService } from './circle-sessions.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Circle.name, schema: CircleSchema },
      { name: CircleMember.name, schema: CircleMemberSchema },
      { name: CircleSession.name, schema: CircleSessionSchema },
      { name: CircleReport.name, schema: CircleReportSchema },
      { name: User.name, schema: UserSchema },
    ]),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    NotificationsModule,
  ],
  controllers: [CirclesController],
  providers: [CirclesService, CircleSessionsService, UserThrottlerGuard],
})
export class CirclesModule {}
