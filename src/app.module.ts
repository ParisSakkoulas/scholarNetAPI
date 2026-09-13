import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthorsModule } from './shared/authors/authors.module';
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

@Module({
  imports: [
    AuthorsModule,
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
