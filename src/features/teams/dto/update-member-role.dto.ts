import { IsIn } from 'class-validator';

export class UpdateMemberRoleDto {
  @IsIn(['admin', 'member', 'viewer'])
  role!: string;
}
