import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ActivityLog, ActivityLogSchema } from './schemas/activity-log.schema';
import { ActivityService } from './activity.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: ActivityLog.name, schema: ActivityLogSchema }])],
  providers: [ActivityService],
  exports: [ActivityService],
})
export class ActivityModule {}
