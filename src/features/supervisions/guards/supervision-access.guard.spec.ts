import { ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { SupervisionAccessGuard } from './supervision-access.guard';

const student = new Types.ObjectId();
const supervisor = new Types.ObjectId();
const coSupervisor = new Types.ObjectId();
const stranger = new Types.ObjectId();
const id = new Types.ObjectId();

function setup(status: string, found = true) {
  const model = {
    findById: () => ({
      exec: async () =>
        found ? { _id: id, studentId: student, supervisorIds: [supervisor, coSupervisor], status } : null,
    }),
  };
  const docId = new Types.ObjectId();
  const lean = (value: unknown) => ({ select: () => ({ lean: async () => value }) });
  const documentModel = { findById: () => lean({ supervisionId: id }) };
  const commentModel = { findById: () => lean({ documentId: docId }) };
  const guard = new SupervisionAccessGuard(model as never, documentModel as never, commentModel as never);
  const run = (
    userId: Types.ObjectId,
    method = 'GET',
    paramId: string = String(id),
    params: Record<string, string> = { id: paramId },
  ) => {
    const req: Record<string, any> = { params, user: { userId: String(userId) }, method };
    const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
    return guard.canActivate(ctx).then(() => req['supervisionAccess']);
  };
  return run;
}

describe('SupervisionAccessGuard', () => {
  it('lets the student and every supervisor in, with the right role', async () => {
    const run = setup('active');
    expect((await run(student)).role).toBe('student');
    expect((await run(supervisor)).role).toBe('supervisor');
    expect((await run(coSupervisor, 'POST')).role).toBe('supervisor');
  });

  it('answers 404 for strangers, so existence is not revealed', async () => {
    await expect(setup('active')(stranger)).rejects.toBeInstanceOf(NotFoundException);
    await expect(setup('active', false)(student)).rejects.toBeInstanceOf(NotFoundException);
    await expect(setup('active')(student, 'GET', 'not-an-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('keeps a pending supervision hidden from the supervisor until they accept', async () => {
    const run = setup('pending');
    await expect(run(supervisor)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(run(student)).resolves.toBeDefined();
  });

  it('makes ended and declined supervisions read-only for everyone', async () => {
    for (const status of ['ended', 'declined']) {
      const run = setup(status);
      await expect(run(student)).resolves.toBeDefined();
      await expect(run(student, 'PATCH')).rejects.toBeInstanceOf(ForbiddenException);
      await expect(run(supervisor, 'POST')).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('applies the same check to document and comment routes', async () => {
    const run = setup('active');
    await expect(run(student, 'GET', '', { docId: String(new Types.ObjectId()) })).resolves.toBeDefined();
    await expect(
      run(supervisor, 'PATCH', '', { commentId: String(new Types.ObjectId()) }),
    ).resolves.toBeDefined();
    await expect(run(stranger, 'GET', '', { docId: String(new Types.ObjectId()) })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(run(student, 'GET', '', { docId: 'nope' })).rejects.toBeInstanceOf(NotFoundException);
  });
});
