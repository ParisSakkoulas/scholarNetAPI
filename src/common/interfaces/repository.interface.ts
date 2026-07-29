import { UpdateQuery } from 'mongoose';

import { PaginationDto } from '../dto/pagination.dto';
import { PaginatedResult } from '../dto/api-response.dto';

export interface IRepository<T> {
    findAll(filter?: Record<string, any>): Promise<T[]>;
    findById(id: string): Promise<T | null>;
    findOne(filter: Record<string, any>): Promise<T | null>;
    paginate(filter: Record<string, any>, pagination: PaginationDto): Promise<PaginatedResult<T>>;
    create(data: Partial<T>): Promise<T>;
    updateById(id: string, update: UpdateQuery<T>): Promise<T | null>;
    deleteById(id: string): Promise<boolean>;
    exists(filter: Record<string, any>): Promise<boolean>;
    count(filter?: Record<string, any>): Promise<number>;
}