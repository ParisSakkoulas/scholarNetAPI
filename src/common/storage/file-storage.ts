import { Readable } from 'stream';

/**
 * Where uploaded files physically live. Services only talk to this interface, so moving from
 * the local disk to S3/Azure/etc. means adding one class and changing one provider.
 * Files are always addressed by an opaque `key` (e.g. "publications/<id>/<uuid>.pdf").
 */
export abstract class FileStorage {
  abstract save(key: string, data: Buffer): Promise<void>;
  abstract read(key: string): Promise<Readable>;
  /** Missing files are not an error. */
  abstract delete(key: string): Promise<void>;
}
