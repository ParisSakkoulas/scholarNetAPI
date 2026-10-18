import { Module } from '@nestjs/common';
import { FileStorage } from './file-storage';
import { LocalFileStorage } from './local-file-storage';

/**
 * To use another backend (S3...), write a class extending FileStorage and change `useClass`
 * here (or choose it from an env var with a factory).
 */
@Module({
  providers: [{ provide: FileStorage, useClass: LocalFileStorage }],
  exports: [FileStorage],
})
export class StorageModule {}
