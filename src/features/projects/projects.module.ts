import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Project, ProjectSchema } from './schema/project.schema';
import { Board, BoardSchema } from './schema/board.schema';
import { Column, ColumnSchema } from './schema/column.schema';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { BoardsController } from './boards.controller';
import { BoardsService } from './boards.service';
import { ColumnsController } from './columns.controller';
import { ColumnsService } from './columns.service';
import { TeamsModule } from '../teams/teams.module';
import { ActivityModule } from '../activity/activity.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Project.name, schema: ProjectSchema },
      { name: Board.name, schema: BoardSchema },
      { name: Column.name, schema: ColumnSchema },
    ]),
    TeamsModule,
    ActivityModule,
  ],
  controllers: [ProjectsController, BoardsController, ColumnsController],
  providers: [ProjectsService, BoardsService, ColumnsService],
  exports: [MongooseModule],
})
export class ProjectsModule {}
