import { IsString, MinLength, IsOptional, IsInt } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @MinLength(3)
  name: string;

  @IsInt()
  ownerId: number;
}
