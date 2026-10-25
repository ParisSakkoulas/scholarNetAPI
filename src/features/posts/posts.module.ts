import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Post, PostSchema } from './schemas/post.schema';
import { PostLike, PostLikeSchema } from './schemas/post-like.schema';
import { PostReport, PostReportSchema } from './schemas/post-report.schema';
import { PostComment, PostCommentSchema } from './schemas/post-comment.schema';
import { Follow, FollowSchema } from '../follows/schemas/follow.schema';
import { User, UserSchema } from '../users/schema/user.schema';
import { NotificationsModule } from '../notifications/notifications.module';
import { PostsService } from './posts.service';
import { PostsController } from './posts.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Post.name, schema: PostSchema },
      { name: PostLike.name, schema: PostLikeSchema },
      { name: PostComment.name, schema: PostCommentSchema },
      { name: PostReport.name, schema: PostReportSchema },
      { name: Follow.name, schema: FollowSchema },
      { name: User.name, schema: UserSchema },
    ]),
    NotificationsModule,
  ],
  controllers: [PostsController],
  providers: [PostsService],
  exports: [PostsService],
})
export class PostsModule {}
