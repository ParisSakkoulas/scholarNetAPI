import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { VenuesModule } from './shared/venues/venues.module';
import { ExternalSourcesModule } from './shared/external-sources/external-sources.module';
import { DatabaseModule } from './database/database.module';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration.module';
import { AuthModule } from './features/auth/auth.module';
import { UsersModule } from './features/users/users.module';
import { ProfileModule } from './features/profile/profile.module';
import { TeamsModule } from './features/teams/teams.module';
import { ProjectsModule } from './features/projects/projects.module';
import { TasksModule } from './features/tasks/task.module';
import { ActivityModule } from './features/activity/activity.module';
import { FollowsModule } from './features/follows/follows.module';
import { NotificationsModule } from './features/notifications/notifications.module';
import { PostsModule } from './features/posts/posts.module';
import { MessagesModule } from './features/messages/messages.module';
import { PublicationsModule } from './features/publications/publications.module';
import { RatingsModule } from './features/ratings/ratings.module';
import { SupervisionsModule } from './features/supervisions/supervisions.module';
import { CirclesModule } from './features/circles/circles.module';

@Module({
  imports: [
    VenuesModule,
    ExternalSourcesModule,
    DatabaseModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      load: [configuration],
    }),
    AuthModule,
    UsersModule,
    ProfileModule,
    TeamsModule,
    ProjectsModule,
    TasksModule,
    ActivityModule,
    FollowsModule,
    NotificationsModule,
    PostsModule,
    MessagesModule,
    PublicationsModule,
    RatingsModule,
    SupervisionsModule,
    CirclesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
