import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Project, ProjectDocument } from './schema/project.schema';
import { Board, BoardDocument } from './schema/board.schema';
import { Column, ColumnDocument } from './schema/column.schema';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectModel(Project.name) private projectModel: Model<ProjectDocument>,
    @InjectModel(Board.name) private boardModel: Model<BoardDocument>,
    @InjectModel(Column.name) private columnModel: Model<ColumnDocument>,
  ) {}

  async create(teamId: string, dto: CreateProjectDto, createdBy: string) {
    const project = await this.projectModel.create({ ...dto, teamId, createdBy });

    const board = await this.boardModel.create({
      projectId: project._id,
      name: 'Main Board',
      position: 1000,
    });
    await this.columnModel.insertMany([
      { boardId: board._id, name: 'To Do', position: 1000 },
      { boardId: board._id, name: 'In Progress', position: 2000 },
      { boardId: board._id, name: 'Done', position: 3000 },
    ]);

    return project;
  }

  async findForTeam(teamId: string, status?: string) {
    const query: any = { teamId };
    if (status) query.status = status;
    return this.projectModel.find(query).sort({ createdAt: -1 }).lean();
  }

  async findOne(projectId: string) {
    const project = await this.projectModel.findById(projectId).lean();
    if (!project) throw new NotFoundException('Project not found');

    const boards = await this.boardModel.find({ projectId }).sort({ position: 1 }).lean();
    const boardIds = boards.map((b) => b._id);
    const columns = await this.columnModel
      .find({ boardId: { $in: boardIds } })
      .sort({ position: 1 })
      .lean();

    return {
      ...project,
      boards: boards.map((b) => ({
        ...b,
        columns: columns.filter((c) => c.boardId.toString() === b._id.toString()),
      })),
    };
  }

  async update(projectId: string, dto: UpdateProjectDto) {
    const project = await this.projectModel.findByIdAndUpdate(projectId, dto, { new: true });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async remove(projectId: string) {
    const res = await this.projectModel.findByIdAndDelete(projectId);
    if (!res) throw new NotFoundException('Project not found');
    await this.boardModel.deleteMany({ projectId });
    return { deleted: true };
  }
}
