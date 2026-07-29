export class ApiResponseDto<T = unknown> {
    success: boolean;
    message: string;
    data?: T;
    meta?: ResponseMeta;
    statusCode: number;
    timestamp: string;

    private constructor(partial: Partial<ApiResponseDto<T>>) {
        Object.assign(this, partial);
        this.timestamp = new Date().toISOString();
    }

    static success<T>(
        data: T,
        message = 'OK',
        statusCode = 200,
        meta?: ResponseMeta,
    ): ApiResponseDto<T> {
        return new ApiResponseDto<T>({ success: true, message, data, statusCode, meta });
    }

    static paginated<T>(result: PaginatedResult<T>, message = 'OK'): ApiResponseDto<T[]> {
        return new ApiResponseDto<T[]>({
            success: true,
            message,
            statusCode: 200,
            data: result.data,
            meta: result.meta,
        });
    }

    static error(message: string, statusCode = 400): ApiResponseDto<null> {
        return new ApiResponseDto<null>({ success: false, message, statusCode, data: null });
    }
}

export interface ResponseMeta {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
}

export interface PaginatedResult<T> {
    data: T[];
    meta: ResponseMeta;
}

export function buildMeta(total: number, page: number, limit: number): ResponseMeta {
    const totalPages = Math.ceil(total / limit);
    return {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
    };
}