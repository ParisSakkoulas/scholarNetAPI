import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Role } from '../enums/roles.enum';
import { User } from '../../features/users/schema/user.schema';

/**
 * Lets only admins through. Run it after JwtAuthGuard. The role is read from the database,
 * because the access token does not carry it. Modules using this guard must register the User model.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@InjectModel(User.name) private userModel: Model<User>) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const userId = ctx.switchToHttp().getRequest().user?.userId;
    const user = userId ? await this.userModel.findById(userId).select('role').lean() : null;
    if (user?.role !== Role.ADMIN) throw new ForbiddenException('Only administrators can do this');
    return true;
  }
}
