import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { StorageModule } from 'src/common/storage/storage.module';
import { Publication, PublicationSchema } from './schemas/publication.schema';
import { PUBLICATION_DISCRIMINATORS } from './schemas/publication-types.schema';
import {
  PublicationReference,
  PublicationReferenceSchema,
} from './schemas/publication-reference.schema';
import { SourceCache, SourceCacheSchema } from './schemas/source-cache.schema';
import { FileAccessRequest,FileAccessRequestSchema } from './schemas/file-access-request.schema';
import { Follow, FollowSchema } from '../follows/schemas/follow.schema';
import { User, UserSchema } from '../users/schema/user.schema';
import { Profile, ProfileSchema } from '../profile/schemas/profile.schema';
import { NotificationsModule } from '../notifications/notifications.module';
import { PublicationsService } from './publications.service';
import { PublicationsController } from './publications.controller';
import { ReferencesService } from './references.service';
import { ReferencesController } from './references.controller';
import { PublicationFilesService } from './publication-files.service';
import { PublicationFilesController } from './publication-files.controller';
import { FileRequestsController } from './file-requests.controller';
import { PublicationAuthorsService } from './publication-authors.service';
import { PublicationAuthorsController } from './publication-authors.controller';
import { PublicationImportService } from './publication-import.service';
import { PublicationImportController } from './publication-import.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: Publication.name,
        schema: PublicationSchema,
        discriminators: PUBLICATION_DISCRIMINATORS,
      },
      { name: PublicationReference.name, schema: PublicationReferenceSchema },
      { name: FileAccessRequest.name, schema: FileAccessRequestSchema },
      { name: SourceCache.name, schema: SourceCacheSchema },
      { name: Follow.name, schema: FollowSchema },
      { name: User.name, schema: UserSchema },
      { name: Profile.name, schema: ProfileSchema },
    ]),
    // uploads are buffered in memory (so the content can be verified) and capped by MAX_FILE_SIZE_MB
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        storage: memoryStorage(),
        limits: { fileSize: Number(config.get('MAX_FILE_SIZE_MB') ?? 50) * 1024 * 1024, files: 1 },
      }),
    }),
    StorageModule,
    NotificationsModule,
  ],
  controllers: [
    PublicationsController,
    ReferencesController,
    PublicationFilesController,
    FileRequestsController,
    PublicationAuthorsController,
    PublicationImportController,
  ],
  providers: [
    PublicationsService,
    ReferencesService,
    PublicationFilesService,
    PublicationAuthorsService,
    PublicationImportService,
  ],
  exports: [
    PublicationsService,
    ReferencesService,
    PublicationFilesService,
    PublicationAuthorsService,
  ],
})
export class PublicationsModule {}
