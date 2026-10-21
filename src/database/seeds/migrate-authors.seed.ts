/**
 * One-off migration for publication authors: gives every author entry an `_id` and a `status`
 * (confirmed / pending / declined) so the /publications/:id/authors endpoints work on old data.
 *
 *   npm run seed:authors
 *
 * - `confirmed: true`, or an author without a linked user -> status `confirmed`
 * - a linked user who never confirmed                      -> status `pending`
 * Entries that already have both fields are left alone, so it is safe to re-run.
 * Cached profile stats are refreshed by the app the next time a publication changes.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import mongoose, { Types } from 'mongoose';

function loadEnv() {
  try {
    const text = readFileSync(resolve(__dirname, '../../../.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* fall back to the real environment */
  }
}

interface RawAuthor {
  _id?: Types.ObjectId;
  user?: Types.ObjectId | null;
  status?: string;
  confirmed?: boolean;
  [key: string]: unknown;
}

async function main() {
  loadEnv();
  const uri = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/scholarnet';
  await mongoose.connect(uri);

  const publications = mongoose.connection.collection('publications');
  const cursor = publications.find({
    authors: { $elemMatch: { $or: [{ _id: { $exists: false } }, { status: { $exists: false } }] } },
  });

  let updated = 0;
  for await (const pub of cursor) {
    const authors = ((pub.authors ?? []) as RawAuthor[]).map((a) => {
      const status = a.status ?? (a.confirmed || !a.user ? 'confirmed' : 'pending');
      return { ...a, _id: a._id ?? new Types.ObjectId(), status, confirmed: status === 'confirmed' };
    });
    await publications.updateOne({ _id: pub._id }, { $set: { authors } });
    updated++;
  }

  console.log(`Migrated authors on ${updated} publication(s).`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
