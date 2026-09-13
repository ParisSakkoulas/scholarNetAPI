import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ActivityLog, ActivityLogDocument } from './schemas/activity-log.schema';

@Injectable()
export class ActivityService {
  constructor(@InjectModel(ActivityLog.name) private activityModel: Model<ActivityLogDocument>) {}

  async log(params: {
    teamId: string | Types.ObjectId;
    projectId?: string | Types.ObjectId;
    entityType: string;
    entityId: string | Types.ObjectId;
    actorId: string | Types.ObjectId;
    action: string;
    metadata?: Record<string, any>;
  }) {
    return this.activityModel.create(params);
  }
}
