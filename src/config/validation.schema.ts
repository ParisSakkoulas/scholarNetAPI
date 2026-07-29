import * as Joi from 'joi';

export const validationSchema = Joi.object({
    // App
    NODE_ENV: Joi.string()
        .valid('development', 'production', 'test', 'staging')
        .default('development'),
    PORT: Joi.number().default(3000),
    API_PREFIX: Joi.string().default('api/v1'),
    CLIENT_URL: Joi.string().default('http://localhost:4200'),

    // Database
    MONGODB_URI: Joi.string().required(),

    // JWT
    JWT_SECRET: Joi.string().min(32).required(),
    JWT_EXPIRES_IN: Joi.string().default('15m'),
    JWT_REFRESH_SECRET: Joi.string().min(32).required(),
    JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),

    // Mail
    MAIL_HOST: Joi.string().required(),
    MAIL_PORT: Joi.number().default(587),
    MAIL_USER: Joi.string().required(),
    MAIL_PASSWORD: Joi.string().required(),
    MAIL_FROM: Joi.string().default('noreply@scholarnet.io'),

    // Storage
    STORAGE_DRIVER: Joi.string().valid('local', 's3', 'gcs').default('local'),
    STORAGE_LOCAL_PATH: Joi.string().default('./uploads'),
    S3_BUCKET: Joi.string().when('STORAGE_DRIVER', {
        is: 's3',
        then: Joi.required(),
        otherwise: Joi.optional(),
    }),
    S3_REGION: Joi.string().default('eu-central-1'),
    S3_ACCESS_KEY: Joi.string().when('STORAGE_DRIVER', {
        is: 's3',
        then: Joi.required(),
        otherwise: Joi.optional(),
    }),
    S3_SECRET_KEY: Joi.string().when('STORAGE_DRIVER', {
        is: 's3',
        then: Joi.required(),
        otherwise: Joi.optional(),
    }),

    // AI
    AI_PROVIDER: Joi.string().valid('openai', 'anthropic').default('openai'),
    OPENAI_API_KEY: Joi.string().when('AI_PROVIDER', {
        is: 'openai',
        then: Joi.required(),
        otherwise: Joi.optional(),
    }),
    ANTHROPIC_API_KEY: Joi.string().when('AI_PROVIDER', {
        is: 'anthropic',
        then: Joi.required(),
        otherwise: Joi.optional(),
    }),
    AI_MODEL: Joi.string().default('gpt-4o'),

    // Security
    BCRYPT_ROUNDS: Joi.number().min(10).max(16).default(12),
    MAX_LOGIN_ATTEMPTS: Joi.number().default(5),
    LOCKOUT_DURATION_MS: Joi.number().default(900000),
    ACTIVATION_TOKEN_TTL_MS: Joi.number().default(86400000),
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    TEMP_LINK_TTL_MS: Joi.number().default(3600000),


});