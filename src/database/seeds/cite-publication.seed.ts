/**
 * Makes a publication of yours show citations: creates 5 publications owned by the seeded users
 * that cite it, and adds a few outside works to its own reference list.
 *
 *   npm run seed:cite -- <publicationId>
 *
 * Needs the users from `npm run seed:dummy`. Safe to re-run (DOIs / reference keys are fixed).
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import mongoose, { Model } from 'mongoose';
import { PublicationType } from '../../common/enums/publication-type.enum';
import { User, UserSchema } from '../../features/users/schema/user.schema';
import { Publication, PublicationSchema } from '../../features/publications/schemas/publication.schema';
import { PUBLICATION_DISCRIMINATORS } from '../../features/publications/schemas/publication-types.schema';
import {
  PublicationReference,
  PublicationReferenceSchema,
  ReferenceSource,
  ReferenceStatus,
} from '../../features/publications/schemas/publication-reference.schema';
import { makeReferenceKey } from '../../features/publications/reference.util';

const T = PublicationType;

/** [seeded username, title, type, keywords] */
const CITING: [string, string, PublicationType, string[]][] = [
  ['_elena_p', 'Automatic Profile Enrichment for Academic Social Networks', T.JOURNAL_ARTICLE, ['profiles', 'enrichment']],
  ['_marcus_l', 'Scalable Citation Graph Storage for Research Platforms', T.PREPRINT, ['citation graph', 'storage']],
  ['_aiko_t', 'Measuring Researcher Impact Beyond the h-index', T.JOURNAL_ARTICLE, ['bibliometrics', 'impact']],
  ['_maria_r', 'Entity Resolution for Author Disambiguation', T.PREPRINT, ['author disambiguation', 'nlp']],
  ['_hannah_b', 'Open Research Profiles and Data Discoverability', T.PREPRINT, ['open science', 'discoverability']],
];

/** Real, well-known works to put in the publication's own reference list (kept unresolved). */
const OUTSIDE_REFERENCES = [
  { title: 'The FAIR Guiding Principles for scientific data management and stewardship', authors: ['Mark D. Wilkinson'], year: 2016, doi: '10.1038/sdata.2016.18', venue: 'Scientific Data' },
  { title: 'Attention Is All You Need', authors: ['Ashish Vaswani'], year: 2017, doi: '10.48550/arxiv.1706.03762', venue: 'NeurIPS' },
  { title: 'Deep Residual Learning for Image Recognition', authors: ['Kaiming He'], year: 2016, doi: '10.1109/cvpr.2016.90', venue: 'CVPR' },
  { title: 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding', authors: ['Jacob Devlin'], year: 2019, doi: '10.18653/v1/n19-1423', venue: 'NAACL' },
];

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

function typeFields(type: PublicationType, i: number): Record<string, unknown> {
  return type === T.JOURNAL_ARTICLE
    ? { journalName: 'Journal of Research Infrastructure', volume: '12', issue: String(1 + i), pages: `${40 + i * 10}-${52 + i * 10}`, peerReviewed: true, publisher: 'Open Science Press' }
    : { server: 'arxiv', version: 1, status: 'submitted' };
}

async function main() {
  const targetArg = process.argv.slice(2).find((a) => !a.startsWith('-'));
  if (!targetArg || !mongoose.Types.ObjectId.isValid(targetArg)) {
    throw new Error('Usage: npm run seed:cite -- <publicationId>');
  }
  loadEnv();
  await mongoose.connect(process.env.MONGODB_URI ?? 'mongodb://localhost:27017/scholarnet');

  const userModel = mongoose.model<User>(User.name, UserSchema);
  const pubModel = mongoose.model<Publication>(Publication.name, PublicationSchema) as Model<Publication>;
  for (const d of PUBLICATION_DISCRIMINATORS) pubModel.discriminator(d.name, d.schema, d.value);
  const refModel = mongoose.model<PublicationReference>(PublicationReference.name, PublicationReferenceSchema);

  const target = await pubModel.findById(targetArg).lean();
  if (!target) throw new Error(`Publication ${targetArg} not found.`);
  const targetAuthor = target.authors?.[0]?.name ?? '';
  console.log(`Target: "${target.title}" (${target.year})`);

  const targetSnapshot = { title: target.title, authors: targetAuthor ? [targetAuthor] : undefined, year: target.year };
  const targetKey = makeReferenceKey(targetSnapshot);

  // ---- 5 citing publications, each from a different seeded user ----
  for (const [i, [username, title, type, keywords]] of CITING.entries()) {
    const user = await userModel.findOne({ username }).lean();
    if (!user) throw new Error(`Seeded user ${username} not found — run "npm run seed:dummy" first.`);

    const doi = `10.9999/cite.${targetArg}.${i + 1}`;
    let pub = await pubModel.findOne({ 'identifiers.doi': doi });
    if (!pub) {
      pub = await pubModel.create({
        type,
        title,
        abstract: `${title}. Placeholder text for a seeded publication that cites "${target.title}".`,
        authors: [{ user: user._id, name: `${user.firstName} ${user.lastName}`, order: 0, isCorresponding: true, confirmed: true }],
        year: Math.max(target.year, 2026),
        language: 'en',
        keywords,
        fields: ['Research Infrastructure'],
        identifiers: { doi },
        visibility: 'public',
        uploadedBy: user._id,
        ...typeFields(type, i),
      });
      console.log(`+ ${username}: "${title}"`);
    } else {
      console.log(`- ${username}: already exists`);
    }

    await refModel.updateOne(
      { citing: pub._id, key: targetKey },
      {
        $setOnInsert: {
          citing: pub._id,
          cited: target._id,
          key: targetKey,
          position: 0,
          snapshot: targetSnapshot,
          source: ReferenceSource.MANUAL,
          locked: true,
          status: ReferenceStatus.RESOLVED,
        },
      },
      { upsert: true },
    );
  }

  // ---- the target's own reference list ----
  for (const [i, r] of OUTSIDE_REFERENCES.entries()) {
    const key = makeReferenceKey(r);
    await refModel.updateOne(
      { citing: target._id, key },
      {
        $setOnInsert: {
          citing: target._id,
          cited: null,
          key,
          position: i,
          snapshot: r,
          source: ReferenceSource.MANUAL,
          locked: true,
          status: ReferenceStatus.UNRESOLVED,
        },
      },
      { upsert: true },
    );
  }

  // same rule as ReferencesService.refreshCitationCounts: citations = incoming edges
  const citations = await refModel.countDocuments({ cited: target._id });
  await pubModel.updateOne({ _id: target._id }, { $set: { 'metrics.citations': citations } });
  console.log(`\nDone: "${target.title}" now has ${citations} citations and ${OUTSIDE_REFERENCES.length} references.`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err.message ?? err);
  await mongoose.disconnect();
  process.exit(1);
});
