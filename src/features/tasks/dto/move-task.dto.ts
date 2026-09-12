import { IsMongoId, IsNumber } from 'class-validator';

export class MoveTaskDto {
  @IsMongoId()
  columnId!: string;

  @IsNumber()
  position!: number;
}
