import { SearchQueryDto } from '../dto/search-query.dto';
import { PaginatedResult } from '../dto/api-response.dto';

export interface ISearchable<T> {
    search(query: SearchQueryDto): Promise<PaginatedResult<T>>;
    suggest(partial: string, limit?: number): Promise<string[]>;
}