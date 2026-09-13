import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Team, TeamSchema } from './schema/team.schema';
import { TeamMember, TeamMemberSchema } from './schema/team-member.schema';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';
import { TeamMembersController } from './team-members.controller';
import { TeamMembersService } from './team-members.service';
import { TeamRoleGuard } from './guards/team-role.guard';
import { ActivityModule } from '../activity/activity.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Team.name, schema: TeamSchema },
      { name: TeamMember.name, schema: TeamMemberSchema },
    ]),
    ActivityModule,
  ],
  controllers: [TeamsController, TeamMembersController],
  providers: [TeamsService, TeamMembersService, TeamRoleGuard],
  exports: [MongooseModule, TeamRoleGuard],
})
export class TeamsModule {}
