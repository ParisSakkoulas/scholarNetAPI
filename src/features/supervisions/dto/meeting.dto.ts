import { Type } from 'class-transformer';
import { IsDate, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { MEETING_STATUSES, MeetingStatus } from '../schemas/meeting.schema';

export class CreateMeetingDto {
  @Type(() => Date)
  @IsDate()
  scheduledAt!: Date;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  firstAgendaItem?: string;
}

export class UpdateMeetingDto {
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  scheduledAt?: Date;

  @IsOptional()
  @IsIn(MEETING_STATUSES)
  status?: MeetingStatus;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  notes?: string;
}

export class AgendaItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  text!: string;
}
