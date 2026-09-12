import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Reflector } from '@nestjs/core';
import { TeamMember, TeamMemberDocument } from '../schema/team-member.schema';

@Injectable()
export class TeamRoleGuard implements CanActivate {
  constructor(
    @InjectModel(TeamMember.name) private memberModel: Model<TeamMemberDocument>,
    private reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const requiredRoles = this.reflector.get<string[]>('roles', ctx.getHandler()) ?? [];
    const member = await this.memberModel
      .findOne({
        teamId: req.params.teamId,
        userId: req.user._id,
        status: 'active',
      })
      .lean();
    if (!member) return false;
    req.teamMember = member;
    return requiredRoles.length === 0 || requiredRoles.includes(member.role);
  }
}
