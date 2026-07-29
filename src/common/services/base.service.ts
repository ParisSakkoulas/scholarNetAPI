import { Document, UpdateQuery } from 'mongoose';
import { NotFoundException } from '@nestjs/common';
import { BaseRepository } from '../repositories/base.repository';
import { PaginationDto } from '../dto/pagination.dto';
import { PaginatedResult } from '../dto/api-response.dto';

export abstract class BaseService<T extends Document> {
    constructor(protected readonly repository: BaseRepository<T>) { }

    async findAll(filter?: Record<string, any>): Promise<T[]> {
        return this.repository.findAll(filter);
    }

    async findById(id: string): Promise<T | null> {
        return this.repository.findById(id);
    }

    async findByIdOrFail(id: string): Promise<T> {
        const doc = await this.repository.findById(id);
        if (!doc) {
            throw new NotFoundException(`Resource #${id} not found`);
        }
        return doc;
    }

    async findOne(filter: Record<string, any>): Promise<T | null> {
        return this.repository.findOne(filter);
    }

    async paginate(
        filter: Record<string, any>,
        pagination: PaginationDto,
    ): Promise<PaginatedResult<T>> {
        return this.repository.paginate(filter, pagination);
    }

    async create(data: Partial<T>): Promise<T> {
        return this.repository.create(data);
    }

    async updateById(id: string, update: UpdateQuery<T>): Promise<T | null> {
        return this.repository.updateById(id, update);
    }

    async updateByIdOrFail(id: string, update: UpdateQuery<T>): Promise<T> {
        return this.repository.updateByIdOrFail(id, update);
    }

    async deleteById(id: string): Promise<boolean> {
        const deleted = await this.repository.deleteById(id);
        if (!deleted) {
            throw new NotFoundException(`Resource #${id} not found`);
        }
        return true;
    }

    async exists(filter: Record<string, any>): Promise<boolean> {
        return this.repository.exists(filter);
    }

    async count(filter?: Record<string, any>): Promise<number> {
        return this.repository.count(filter);
    }
}