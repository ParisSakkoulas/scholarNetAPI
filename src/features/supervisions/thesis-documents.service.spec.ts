import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { stripHtml } from '../../common/decorators/sanitize-html.decorator';
import { detectDocumentType } from './document-file.util';
import { SupervisionAccess } from './guards/supervision-access.guard';
import { ThesisDocumentsService } from './thesis-documents.service';

const student = String(new Types.ObjectId());
const supervisor = String(new Types.ObjectId());
const docId = new Types.ObjectId();

const pdf = (name = 'draft.pdf') =>
  ({ originalname: name, size: 100, buffer: Buffer.from('%PDF-1.7 test') }) as Express.Multer.File;

function setup(status = 'draft') {
  const doc = { _id: docId, mode: 'upload', status, currentVersion: 0, title: 'Chapter 2' };
  const versions: { number: number; documentId: Types.ObjectId }[] = [];
  const saved: string[] = [];
  const deleted: string[] = [];

  const documentModel = {
    findOne: async () => ({ ...doc, toObject: () => doc }),
    // same contract as Mongo's atomic $inc: every call gets the next number
    findByIdAndUpdate: async (_id: unknown, update: { $set?: { status?: string } }) => {
      doc.currentVersion += 1;
      if (update.$set?.status) doc.status = update.$set.status;
      return { ...doc };
    },
  };
  const versionModel = {
    create: async (v: { number: number; documentId: Types.ObjectId }) => {
      versions.push(v);
      return { toObject: () => ({ ...v, storageKey: 'secret' }) };
    },
  };
  const storage = {
    save: async (key: string) => void saved.push(key),
    delete: async (key: string) => void deleted.push(key),
  };
  const service = new ThesisDocumentsService(
    documentModel as never,
    versionModel as never,
    {} as never,
    {} as never,
    {} as never,
    { create: jest.fn() } as never,
    storage as never,
    { get: () => undefined } as never,
  );
  return { service, versions, saved, deleted, doc };
}

const access = (role: 'student' | 'supervisor'): SupervisionAccess =>
  ({
    role,
    userId: role === 'student' ? student : supervisor,
    supervision: { _id: new Types.ObjectId(), studentId: student, supervisorIds: [supervisor] },
  }) as never;

describe('ThesisDocumentsService versions', () => {
  it('numbers uploads 1, 2, 3 and never drops an earlier version', async () => {
    const { service, versions, saved } = setup();
    for (let i = 0; i < 3; i++) await service.uploadVersion(access('student'), String(docId), pdf(), {});
    expect(versions.map((v) => v.number)).toEqual([1, 2, 3]);
    expect(new Set(saved).size).toBe(3); // each version has its own file
  });

  it('does not expose the storage key', async () => {
    const { service } = setup();
    const view = await service.uploadVersion(access('student'), String(docId), pdf(), {});
    expect(view).not.toHaveProperty('storageKey');
  });

  it('resets a reviewed document to draft when a new version arrives', async () => {
    const { service, doc } = setup('reviewed');
    await service.uploadVersion(access('student'), String(docId), pdf(), {});
    expect(doc.status).toBe('draft');
  });

  it('lets a supervisor add a reviewed copy without touching the status', async () => {
    const { service, doc, versions } = setup('ready_for_review');
    await service.uploadVersion(access('supervisor'), String(docId), pdf('reviewed.pdf'), {});
    expect(doc.status).toBe('ready_for_review');
    expect(versions[0]).toMatchObject({ byRole: 'supervisor' });
  });

  it('refuses fake files', async () => {
    const { service, saved } = setup();
    const fake = { ...pdf(), buffer: Buffer.from('MZ not a pdf') } as Express.Multer.File;
    await expect(
      service.uploadVersion(access('student'), String(docId), fake, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(saved).toHaveLength(0);
  });
});

describe('detectDocumentType', () => {
  it('checks the content, not just the extension', () => {
    expect(detectDocumentType('a.pdf', Buffer.from('%PDF-1.4'))?.mimeType).toBe('application/pdf');
    expect(detectDocumentType('a.pdf', Buffer.from('hello world'))).toBeNull();
    expect(detectDocumentType('a.exe', Buffer.from('%PDF-1.4'))).toBeNull();

    const docx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('word/document.xml')]);
    expect(detectDocumentType('a.docx', docx)).not.toBeNull();
    // a plain zip renamed to .docx
    expect(detectDocumentType('a.docx', Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))).toBeNull();
  });
});

describe('stripHtml', () => {
  it('removes tags, including nested tricks', () => {
    expect(stripHtml('Nice <b>work</b>')).toBe('Nice work');
    // whatever is left must not be able to form a tag
    expect(stripHtml('<scr<b>ipt>alert(1)</script>')).not.toContain('<');
    expect(stripHtml('  plain  ')).toBe('plain');
  });
});
