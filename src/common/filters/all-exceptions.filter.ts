import {
    ExceptionFilter,
    Catch,
    ArgumentsHost,
    HttpException,
    HttpStatus,
    Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Error as MongooseError } from 'mongoose';
import { MongoServerError } from 'mongodb';

/**
 * AllExceptionsFilter
 *
 * Global exception filter — catches every unhandled exception in the app
 * and returns a consistent JSON shape that matches ApiResponseDto.
 *
 * Handles:
 *  - NestJS HttpExceptions (NotFoundException, UnauthorizedException, etc.)
 *  - Mongoose ValidationError   → 422
 *  - Mongoose CastError         → 400 (invalid ObjectId format)
 *  - MongoDB duplicate key (11000) → 409 Conflict
 *  - Everything else            → 500 Internal Server Error
 *
 * Registered globally in app.module.ts:
 *   { provide: APP_FILTER, useClass: AllExceptionsFilter }
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
    private readonly logger = new Logger(AllExceptionsFilter.name);

    catch(exception: unknown, host: ArgumentsHost): void {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();
        const request = ctx.getRequest<Request>();

        const { statusCode, message, errors } = this.resolveException(exception);

        // Log server errors with full stack — skip for expected client errors
        if (statusCode >= 500) {
            this.logger.error(
                `[${request.method}] ${request.url} → ${statusCode}`,
                exception instanceof Error ? exception.stack : String(exception),
            );
        } else {
            this.logger.warn(`[${request.method}] ${request.url} → ${statusCode} ${message}`);
        }

        response.status(statusCode).json({
            success: false,
            statusCode,
            message,
            errors: errors ?? null,       // validation field errors if any
            path: request.url,
            timestamp: new Date().toISOString(),
        });
    }

    // ─── Exception resolver ────────────────────────────────────────────────────

    private resolveException(exception: unknown): {
        statusCode: number;
        message: string;
        errors?: Record<string, string[]>;
    } {
        // ── NestJS HttpException (most common) ───────────────────────────────────
        if (exception instanceof HttpException) {
            const status = exception.getStatus();
            const res = exception.getResponse();

            // class-validator returns { message: string[], error: string }
            if (typeof res === 'object' && res !== null) {
                const resObj = res as Record<string, unknown>;

                // Validation errors from ValidationPipe — array of field messages
                if (Array.isArray(resObj['message'])) {
                    return {
                        statusCode: status,
                        message: 'Validation failed',
                        errors: this.formatValidationErrors(resObj['message'] as string[]),
                    };
                }

                return {
                    statusCode: status,
                    message: (resObj['message'] as string) ?? exception.message,
                };
            }

            return { statusCode: status, message: String(res) };
        }

        // ── Mongoose CastError — invalid ObjectId ────────────────────────────────
        if (exception instanceof MongooseError.CastError) {
            return {
                statusCode: HttpStatus.BAD_REQUEST,
                message: `Invalid value for field '${exception.path}': ${exception.value}`,
            };
        }

        // ── Mongoose ValidationError — schema-level validation ───────────────────
        if (exception instanceof MongooseError.ValidationError) {
            const errors: Record<string, string[]> = {};
            for (const field of Object.keys(exception.errors)) {
                errors[field] = [exception.errors[field].message];
            }
            return {
                statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
                message: 'Database validation failed',
                errors,
            };
        }

        // ── MongoDB duplicate key error (e.g. unique email) ──────────────────────
        if (exception instanceof MongoServerError && exception.code === 11000) {
            const field = Object.keys(exception.keyPattern ?? {})[0] ?? 'field';
            return {
                statusCode: HttpStatus.CONFLICT,
                message: `A record with this ${field} already exists`,
            };
        }

        // ── Unknown / unhandled — always 500 ─────────────────────────────────────
        return {
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            message: 'An unexpected error occurred',
        };
    }

    /**
     * Turns class-validator flat error strings into a field → messages map.
     *
     * Input:  ['email must be an email', 'password must be longer than 8 characters']
     * Output: { email: ['must be an email'], password: ['must be longer than 8 characters'] }
     */
    private formatValidationErrors(messages: string[]): Record<string, string[]> {
        const errors: Record<string, string[]> = {};

        for (const msg of messages) {
            // class-validator format: "fieldName message text"
            const spaceIndex = msg.indexOf(' ');
            const field = spaceIndex !== -1 ? msg.substring(0, spaceIndex) : 'unknown';
            const text = spaceIndex !== -1 ? msg.substring(spaceIndex + 1) : msg;

            if (!errors[field]) errors[field] = [];
            errors[field].push(text);
        }

        return errors;
    }
}