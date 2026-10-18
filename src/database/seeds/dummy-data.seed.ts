/**
 * Dummy data for local development: 10 users (active, with profile) and 3-4 publications each,
 * plus mutual follows between neighbours so the messaging feature can be tried right away.
 *
 *   npm run seed:dummy            create (skips users that already exist)
 *   npm run seed:dummy -- --reset delete the seeded users and their data first
 *
 * All seeded users share the password below and use emails @seed.scholarnet.test.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import * as bcrypt from 'bcrypt';
import mongoose, { Model } from 'mongoose';
import { Role } from '../../common/enums/roles.enum';
import { UserStatus } from '../../common/enums/user.status.enum';
import { PublicationType } from '../../common/enums/publication-type.enum';
import { User, UserSchema } from '../../features/users/schema/user.schema';
import { Profile, ProfileSchema } from '../../features/profile/schemas/profile.schema';
import { Follow, FollowSchema } from '../../features/follows/schemas/follow.schema';
import { Publication, PublicationSchema } from '../../features/publications/schemas/publication.schema';
import { PUBLICATION_DISCRIMINATORS } from '../../features/publications/schemas/publication-types.schema';

const PASSWORD = 'Password123!';
const EMAIL_DOMAIN = 'seed.scholarnet.test';

type Pub = [title: string, type: PublicationType, year: number, keywords: string[]];

interface SeedUser {
  firstName: string;
  lastName: string;
  username: string; // the User schema requires a leading underscore
  headline: string;
  institution: string;
  country: string;
  field: string;
  pubs: Pub[];
}

const T = PublicationType;

const USERS: SeedUser[] = [
  {
    firstName: 'Elena', lastName: 'Papadaki', username: '_elena_p',
    headline: 'Researcher in Machine Learning', institution: 'University of the Aegean', country: 'Greece',
    field: 'Machine Learning',
    pubs: [
      ['Few-Shot Learning for Low-Resource Greek NLP', T.JOURNAL_ARTICLE, 2023, ['nlp', 'few-shot', 'greek']],
      ['Calibrating Transformers Under Distribution Shift', T.CONFERENCE_PAPER, 2022, ['calibration', 'transformers']],
      ['A Survey of Parameter-Efficient Fine-Tuning', T.PREPRINT, 2024, ['peft', 'survey']],
      ['Representation Learning for Academic Text', T.THESIS, 2020, ['representation', 'academic text']],
    ],
  },
  {
    firstName: 'Marcus', lastName: 'Lindqvist', username: '_marcus_l',
    headline: 'Distributed Systems Engineer & Researcher', institution: 'KTH Royal Institute of Technology', country: 'Sweden',
    field: 'Distributed Systems',
    pubs: [
      ['Consensus Under Partial Synchrony at Scale', T.CONFERENCE_PAPER, 2021, ['consensus', 'raft']],
      ['Tail Latency in Geo-Replicated Databases', T.JOURNAL_ARTICLE, 2022, ['latency', 'replication']],
      ['Verifying Crash-Recovery Protocols', T.TECHNICAL_REPORT, 2023, ['verification', 'tla+']],
    ],
  },
  {
    firstName: 'Aiko', lastName: 'Tanaka', username: '_aiko_t',
    headline: 'Computational Neuroscientist', institution: 'University of Tokyo', country: 'Japan',
    field: 'Neuroscience',
    pubs: [
      ['Predictive Coding in Hierarchical Cortical Models', T.JOURNAL_ARTICLE, 2022, ['predictive coding', 'cortex']],
      ['Spiking Networks for Temporal Pattern Recognition', T.CONFERENCE_PAPER, 2023, ['spiking', 'temporal']],
      ['Open fMRI Dataset of Naturalistic Listening', T.DATASET, 2024, ['fmri', 'dataset']],
      ['Plasticity Rules and Memory Consolidation', T.PREPRINT, 2024, ['plasticity', 'memory']],
    ],
  },
  {
    firstName: 'Sofia', lastName: 'Marques', username: '_sofia_m',
    headline: 'Marine Biologist', institution: 'University of Lisbon', country: 'Portugal',
    field: 'Marine Biology',
    pubs: [
      ['Seagrass Meadow Recovery After Marine Heatwaves', T.JOURNAL_ARTICLE, 2021, ['seagrass', 'climate']],
      ['Citizen Science Surveys of Mediterranean Fish', T.BOOK_CHAPTER, 2022, ['citizen science', 'fish']],
      ['Coastal Monitoring Time Series 2010-2022', T.DATASET, 2023, ['monitoring', 'time series']],
    ],
  },
  {
    firstName: 'David', lastName: 'Okafor', username: '_david_o',
    headline: 'Cryptography and Security Researcher', institution: 'ETH Zurich', country: 'Switzerland',
    field: 'Security',
    pubs: [
      ['Post-Quantum Key Exchange on Constrained Devices', T.CONFERENCE_PAPER, 2023, ['post-quantum', 'iot']],
      ['Side-Channel Resistant Lattice Implementations', T.JOURNAL_ARTICLE, 2022, ['lattice', 'side channel']],
      ['Zero-Knowledge Proofs for Credential Privacy', T.PREPRINT, 2024, ['zk', 'privacy']],
      ['Secure Update Mechanisms for Embedded Firmware', T.PATENT, 2021, ['firmware', 'updates']],
    ],
  },
  {
    firstName: 'Maria', lastName: 'Rossi', username: '_maria_r',
    headline: 'Computational Linguist', institution: 'University of Bologna', country: 'Italy',
    field: 'Linguistics',
    pubs: [
      ['Diachronic Word Embeddings for Italian', T.JOURNAL_ARTICLE, 2021, ['embeddings', 'diachronic']],
      ['Annotation Guidelines for Dialect Corpora', T.TECHNICAL_REPORT, 2022, ['corpus', 'dialect']],
      ['Code-Switching Detection in Social Media', T.CONFERENCE_PAPER, 2023, ['code-switching', 'social media']],
    ],
  },
  {
    firstName: 'Nikos', lastName: 'Georgiou', username: '_nikos_g',
    headline: 'Robotics and Control', institution: 'National Technical University of Athens', country: 'Greece',
    field: 'Robotics',
    pubs: [
      ['Model Predictive Control for Aerial Manipulators', T.JOURNAL_ARTICLE, 2022, ['mpc', 'drones']],
      ['Learning Grasp Policies from Few Demonstrations', T.CONFERENCE_PAPER, 2023, ['grasping', 'imitation']],
      ['Sim-to-Real Transfer for Legged Robots', T.PREPRINT, 2024, ['sim2real', 'legged']],
      ['Control of Underactuated Mechanical Systems', T.BOOK, 2020, ['control', 'mechanics']],
    ],
  },
  {
    firstName: 'Priya', lastName: 'Sharma', username: '_priya_s',
    headline: 'Bioinformatics and Genomics', institution: 'IISc Bangalore', country: 'India',
    field: 'Bioinformatics',
    pubs: [
      ['Graph-Based Pan-Genome Assembly at Scale', T.JOURNAL_ARTICLE, 2023, ['pan-genome', 'assembly']],
      ['Variant Calling with Long-Read Sequencing', T.CONFERENCE_PAPER, 2022, ['variant calling', 'nanopore']],
      ['Single-Cell Atlas of Human Gut Tissue', T.DATASET, 2024, ['single-cell', 'atlas']],
    ],
  },
  {
    firstName: 'Lucas', lastName: 'Moreau', username: '_lucas_m',
    headline: 'Human-Computer Interaction', institution: 'Sorbonne University', country: 'France',
    field: 'HCI',
    pubs: [
      ['Accessible Data Visualisation for Screen Reader Users', T.JOURNAL_ARTICLE, 2022, ['accessibility', 'visualisation']],
      ['Designing Feedback for Remote Pair Programming', T.CONFERENCE_PAPER, 2021, ['pair programming', 'remote']],
      ['Participatory Design in Academic Software', T.BOOK_CHAPTER, 2023, ['participatory design']],
      ['Interfaces for Reading Scientific Papers', T.THESIS, 2019, ['reading', 'papers']],
    ],
  },
  {
    firstName: 'Hannah', lastName: 'Becker', username: '_hannah_b',
    headline: 'Climate Data Scientist', institution: 'Technical University of Munich', country: 'Germany',
    field: 'Climate Science',
    pubs: [
      ['Downscaling Climate Projections with Deep Learning', T.JOURNAL_ARTICLE, 2023, ['downscaling', 'deep learning']],
      ['Extreme Precipitation Trends in Central Europe', T.JOURNAL_ARTICLE, 2021, ['precipitation', 'extremes']],
      ['Gridded European Temperature Dataset 1950-2023', T.DATASET, 2024, ['temperature', 'gridded']],
    ],
  },
];

/** Required, type-specific fields (CLAUDE.md section 3). */
function typeFields(type: PublicationType, u: SeedUser, i: number): Record<string, unknown> {
  switch (type) {
    case T.JOURNAL_ARTICLE:
      return { journalName: `Journal of ${u.field}`, volume: String(10 + i), issue: String(1 + (i % 4)), pages: `${100 + i * 12}-${112 + i * 12}`, peerReviewed: true, publisher: 'Open Science Press' };
    case T.CONFERENCE_PAPER:
      return { conferenceName: `International Conference on ${u.field}`, location: u.country, presentationType: 'oral' };
    case T.BOOK:
      return { publisher: 'Academic Books Ltd', edition: '1st', numberOfPages: 280 };
    case T.BOOK_CHAPTER:
      return { bookTitle: `Handbook of ${u.field}`, publisher: 'Academic Books Ltd', pages: '45-72' };
    case T.THESIS:
      return { degree: 'phd', institution: u.institution, department: u.field };
    case T.TECHNICAL_REPORT:
      return { institution: u.institution, reportNumber: `TR-${2020 + i}-${i + 1}` };
    case T.PREPRINT:
      return { server: 'arxiv', version: 1, status: 'submitted' };
    case T.DATASET:
      return { repository: 'Zenodo', version: '1.0', format: 'CSV' };
    case T.PATENT:
      return { patentOffice: 'EPO', patentNumber: `EP${3000000 + i * 137}`, status: 'granted' };
    default:
      return {};
  }
}

function loadEnv() {
  try {
    const text = readFileSync(resolve(__dirname, '../../../.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* fall back to defaults / real environment */
  }
}

async function main() {
  loadEnv();
  const uri = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/scholarnet';
  await mongoose.connect(uri);
  console.log(`Connected to ${uri.replace(/\/\/.*@/, '//***@')}`);

  const userModel = mongoose.model<User>(User.name, UserSchema);
  const profileModel = mongoose.model<Profile>(Profile.name, ProfileSchema);
  const followModel = mongoose.model<Follow>(Follow.name, FollowSchema);
  const pubModel = mongoose.model<Publication>(Publication.name, PublicationSchema) as Model<Publication>;
  for (const d of PUBLICATION_DISCRIMINATORS) pubModel.discriminator(d.name, d.schema, d.value);

  const emails = USERS.map((u) => `${u.username.slice(1)}@${EMAIL_DOMAIN}`);

  if (process.argv.includes('--reset')) {
    const old = await userModel.find({ email: { $in: emails } }).select('_id').lean();
    const ids = old.map((u) => u._id);
    await Promise.all([
      pubModel.deleteMany({ uploadedBy: { $in: ids } }),
      profileModel.deleteMany({ user: { $in: ids } }),
      followModel.deleteMany({ $or: [{ follower: { $in: ids } }, { following: { $in: ids } }] }),
      userModel.deleteMany({ _id: { $in: ids } }),
    ]);
    console.log(`Removed ${ids.length} seeded users and their data`);
  }

  const password = await bcrypt.hash(PASSWORD, 10);
  const created: mongoose.Types.ObjectId[] = [];
  let pubCount = 0;

  for (const [idx, u] of USERS.entries()) {
    const email = emails[idx];
    let user = await userModel.findOne({ email });
    if (user) {
      console.log(`- ${email} exists, skipped`);
      created.push(user._id as mongoose.Types.ObjectId);
      continue;
    }

    user = await userModel.create({
      firstName: u.firstName,
      lastName: u.lastName,
      username: u.username,
      email,
      password,
      role: Role.USER,
      status: UserStatus.ACTIVE,
    });
    const profile = await profileModel.create({
      user: user._id,
      headline: u.headline,
      bio: `${u.firstName} works on ${u.field.toLowerCase()} at ${u.institution}.`,
      country: u.country,
      verified: true,
      positions: [],
    });
    await userModel.updateOne({ _id: user._id }, { profile: profile._id });
    created.push(user._id as mongoose.Types.ObjectId);

    for (const [i, [title, type, year, keywords]] of u.pubs.entries()) {
      await pubModel.create({
        type,
        title,
        abstract: `${title}. This is placeholder text for a seeded ${type.replace('_', ' ')} in ${u.field}.`,
        authors: [{ user: user._id, name: `${u.firstName} ${u.lastName}`, affiliation: u.institution, order: 0, isCorresponding: true, confirmed: true }],
        year,
        language: 'en',
        keywords,
        fields: [u.field],
        // fake DOIs on the reserved test prefix 10.9999, unique per publication
        identifiers: { doi: `10.9999/seed.${u.username.slice(1)}.${i + 1}` },
        visibility: 'public',
        uploadedBy: user._id,
        ...typeFields(type, u, i),
      });
      pubCount++;
    }
    console.log(`+ ${email} (${u.pubs.length} publications)`);
  }

  // neighbours follow each other in both directions -> "connected" for messaging
  const pairs = created.flatMap((id, i) => {
    const next = created[(i + 1) % created.length];
    return [
      { follower: id, following: next },
      { follower: next, following: id },
    ];
  });
  await followModel.bulkWrite(
    pairs.map((p) => ({ updateOne: { filter: p, update: { $setOnInsert: p }, upsert: true } })),
  );

  console.log(`\nDone: ${pubCount} publications created. Log in with <username>@${EMAIL_DOMAIN} / ${PASSWORD}`);
  console.log(`e.g. ${emails[0]}`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
