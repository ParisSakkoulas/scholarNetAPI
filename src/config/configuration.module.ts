export default () => ({
  app: {
    port: parseInt(process.env.PORT ?? '3000', 10),
    env: process.env.NODE_ENV ?? 'development',
    apiPrefix: process.env.API_PREFIX ?? 'api/v1',
    clientUrl: process.env.CLIENT_URL ?? 'http://localhost:4200',
  },

  database: {
    uri: process.env.MONGODB_URI ?? 'mongodb://localhost:27017/scholarnet',
  },

  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },

  mail: {
    host: process.env.MAIL_HOST,
    port: parseInt(process.env.MAIL_PORT ?? '587', 10),
    user: process.env.MAIL_USER,
    password: process.env.MAIL_PASSWORD,
    from: process.env.MAIL_FROM ?? 'noreply@scholarnet.io',
  },

  storage: {
    driver: process.env.STORAGE_DRIVER ?? 'local',
    localPath: process.env.STORAGE_LOCAL_PATH ?? './uploads',
    s3Bucket: process.env.S3_BUCKET,
    s3Region: process.env.S3_REGION ?? 'eu-central-1',
    s3AccessKey: process.env.S3_ACCESS_KEY,
    s3SecretKey: process.env.S3_SECRET_KEY,
  },

  ai: {
    provider: process.env.AI_PROVIDER ?? 'openai',
    openaiKey: process.env.OPENAI_API_KEY,
    anthropicKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.AI_MODEL ?? 'gpt-4o',
  },

  security: {
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS ?? '12', 10),
    maxLoginAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS ?? '5', 10),
    lockoutDurationMs: parseInt(process.env.LOCKOUT_DURATION_MS ?? '900000', 10),
    activationTokenTtlMs: parseInt(process.env.ACTIVATION_TOKEN_TTL_MS ?? '86400000', 10),
    tempLinkTtlMs: parseInt(process.env.TEMP_LINK_TTL_MS ?? '3600000', 10),
  },

  googleAuth: {
    cliendId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL,

  }
});
