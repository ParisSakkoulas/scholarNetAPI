import {
    // FilterQuery,
    Model,
    Document,
    UpdateQuery,
    SortOrder as MongooseSortOrder,
} from 'mongoose';
import { NotFoundException } from '@nestjs/common';
import { IRepository } from '../interfaces/repository.interface';
import { PaginationDto } from '../dto/pagination.dto';
import { PaginatedResult, buildMeta } from '../dto/api-response.dto';

export abstract class BaseRepository<T extends Document>
    implements IRepository<T> {
    constructor(protected readonly model: Model<T>) { }

    async findAll(filter: Record<string, any> = {}): Promise<T[]> {
        return this.model.find(filter).exec();
    }

    async findById(id: string): Promise<T | null> {
        return this.model.findById(id).exec();
    }

    async findByIdOrFail(id: string): Promise<T> {
        const doc = await this.findById(id);
        if (!doc) {
            throw new NotFoundException(`${this.model.modelName} #${id} not found`);
        }
        return doc;
    }

    async findOne(filter: Record<string, any> = {}): Promise<T | null> {
        return this.model.findOne(filter).exec();
    }

    async paginate(
        filter: Record<string, any> = {},
        pagination: PaginationDto,
    ): Promise<PaginatedResult<T>> {
        const { skip, limit, page, sortBy, sortOrder } = pagination;

        const sortStage: Record<string, MongooseSortOrder> = sortBy
            ? { [sortBy]: sortOrder === 'asc' ? 1 : -1 }
            : { createdAt: -1 };

        const [data, total] = await Promise.all([
            this.model.find(filter).sort(sortStage).skip(skip).limit(limit).exec(),
            this.model.countDocuments(filter).exec(),
        ]);

        return { data, meta: buildMeta(total, page, limit) };
    }

    async create(data: Partial<T>): Promise<T> {
        const doc = new this.model(data);
        return doc.save() as Promise<T>;
    }

    async updateById(id: string, update: UpdateQuery<T>): Promise<T | null> {
        return this.model
            .findByIdAndUpdate(id, update, { new: true, runValidators: true })
            .exec();
    }

    async updateByIdOrFail(id: string, update: UpdateQuery<T>): Promise<T> {
        const updated = await this.updateById(id, update);
        if (!updated) {
            throw new NotFoundException(`${this.model.modelName} #${id} not found`);
        }
        return updated;
    }

    async deleteById(id: string): Promise<boolean> {
        const result = await this.model.findByIdAndDelete(id).exec();
        return result !== null;
    }

    async exists(filter: Record<string, any> = {}): Promise<boolean> {
        const count = await this.model.countDocuments(filter).limit(1).exec();
        return count > 0;
    }

    async count(filter: Record<string, any> = {}): Promise<number> {
        return this.model.countDocuments(filter).exec();
    }

    protected async fullTextSearch(
        text: string,
        filter: Record<string, any> = {},
        pagination: PaginationDto,
    ): Promise<PaginatedResult<T>> {
        const textFilter: Record<string, any> = {
            ...filter,
            $text: { $search: text },
        }

        return this.paginate(textFilter, pagination);
    }
}