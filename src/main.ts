import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import * as cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.enableCors({
    origin: 'http://localhost:4200',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  // for production
  // app.enableCors({
  //   origin: process.env.FRONTEND_URL,
  //   methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  //   credentials: true,
  // });


  // editor autosaves send the whole document as JSON; the default 100kb is too small for a thesis
  app.useBodyParser('json', { limit: '2mb' });

  app.use(cookieParser());
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();