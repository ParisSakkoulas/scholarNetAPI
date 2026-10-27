import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Task, TaskSchema } from './schema/task.schema';
import { Comment, CommentSchema } from './schema/comment.schema';
import { TasksController } from './task.controller';
import { TasksService } from './task.service';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { TeamsModule } from '../teams/teams.module';
import { ActivityModule } from '../activity/activity.module';

import { ColumnSchema, Column } from '../projects/schema/column.schema';
import { Project, ProjectSchema } from '../projects/schema/project.schema';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Task.name, schema: TaskSchema },
      { name: Comment.name, schema: CommentSchema },
      { name: Column.name, schema: ColumnSchema },
      { name: Project.name, schema: ProjectSchema },
    ]),
    TeamsModule,
    ActivityModule,
    NotificationsModule,
  ],
  controllers: [TasksController, CommentsController],
  providers: [TasksService, CommentsService],
})
export class TasksModule {}
