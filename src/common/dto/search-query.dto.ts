import { Type } from 'class-transformer';
import {
    IsArray,
    IsInt,
    IsOptional,
    IsString,
    Max,
    Min,
    ValidateNested,
} from 'class-validator';
import { PaginationDto } from './pagination.dto';

export class DateRangeDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1000)
    @Max(9999)
    from?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1000)
    @Max(9999)
    to?: number;
}

export class SearchQueryDto extends PaginationDto {
    @IsOptional()
    @IsString()
    q?: string;
}

export class AdvancedSearchDto extends PaginationDto {
    @IsOptional()
    @IsString()
    title?: string;

    @IsOptional()
    @IsString()
    abstract?: string;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    authors?: string[];

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    venues?: string[];

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    keywords?: string[];

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    types?: string[];

    @IsOptional()
    @ValidateNested()
    @Type(() => DateRangeDto)
    yearRange?: DateRangeDto;
}