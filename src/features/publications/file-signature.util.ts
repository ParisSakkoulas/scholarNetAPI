import { extname } from 'path';
import { PublicationFileRole } from './schemas/publication.schema';

interface AllowedType {
  mimeType: string;
  /** First bytes every genuine file of this type starts with. */
  magic: number[];
  defaultRole: PublicationFileRole;
}

/** The only formats accepted: PDF, PowerPoint 97-2003 (.ppt) and PowerPoint (.pptx). */
const ALLOWED: Record<string, AllowedType> = {
  '.pdf': {
    mimeType: 'application/pdf',
    magic: [0x25, 0x50, 0x44, 0x46, 0x2d], // %PDF-
    defaultRole: PublicationFileRole.FULLTEXT,
  },
  '.ppt': {
    mimeType: 'application/vnd.ms-powerpoint',
    magic: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], // OLE2 container
    defaultRole: PublicationFileRole.SLIDES,
  },
  '.pptx': {
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    magic: [0x50, 0x4b, 0x03, 0x04], // ZIP
    defaultRole: PublicationFileRole.SLIDES,
  },
};

export const ALLOWED_EXTENSIONS = Object.keys(ALLOWED);

/**
 * Decides the file type from the extension and checks that the content really is that type.
 * The client-sent mimetype is ignored because it is trivially faked.
 * Returns null when the file is not an accepted PDF/PPT/PPTX.
 */
export function detectFileType(originalName: string, buffer: Buffer) {
  const ext = extname(originalName).toLowerCase();
  const type = ALLOWED[ext];
  if (!type || buffer.length < type.magic.length) return null;
  if (!type.magic.every((byte, i) => buffer[i] === byte)) return null;
  return { ext, mimeType: type.mimeType, defaultRole: type.defaultRole };
}
