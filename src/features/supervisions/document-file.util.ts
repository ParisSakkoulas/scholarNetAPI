import { extname } from 'path';

const PDF_MAGIC = Buffer.from('%PDF-');
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export const DOCUMENT_EXTENSIONS = ['.pdf', '.doc', '.docx'];

/**
 * Decides the type from the extension and checks the content really is that type; the
 * client-sent mimetype is ignored. A DOCX is a ZIP that contains "word/document.xml"
 * (entry names are stored uncompressed in the ZIP headers), which rules out arbitrary zips.
 * Returns null when the file is not an accepted PDF/DOCX.
 */
export function detectDocumentType(originalName: string, buffer: Buffer) {
  const ext = extname(originalName).toLowerCase();

  if (ext === '.pdf' && buffer.subarray(0, 5).equals(PDF_MAGIC)) {
    return { ext, mimeType: 'application/pdf' };
  }
  // legacy Word: an OLE container (cannot be told apart from other old Office files by content alone)
  if (ext === '.doc' && buffer.subarray(0, 8).equals(OLE_MAGIC)) {
    return { ext, mimeType: 'application/msword' };
  }
  if (
    ext === '.docx' &&
    buffer.subarray(0, 4).equals(ZIP_MAGIC) &&
    buffer.includes('word/document.xml')
  ) {
    return {
      ext,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
  }
  return null;
}

/** Multer decodes the multipart filename as latin1, which garbles non-ASCII names (Greek...). */
export function decodeUploadName(name: string): string {
  return Buffer.from(name, 'latin1').toString('utf8');
}
