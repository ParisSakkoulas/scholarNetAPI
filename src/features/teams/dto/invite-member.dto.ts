import { IsMongoId, IsOptional, IsIn } from 'class-validator';

export class InviteMemberDto {
  @IsMongoId()
  userId!: string;

  @IsOptional()
  @IsIn(['admin', 'member', 'viewer'])
  role?: string;
}
