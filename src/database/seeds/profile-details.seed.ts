/**
 * Fills in profile details for local development: 2-3 positions, 1-3 education entries and
 * 3-5 skills and interests for every active user whose profile has none yet.
 *
 *   npm run seed:profiles
 *
 * Profiles that already have positions, education, skills or interests are left untouched,
 * so it is safe to re-run.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import mongoose from 'mongoose';
import { Role } from '../../common/enums/roles.enum';
import { UserStatus } from '../../common/enums/user.status.enum';
import { User, UserSchema } from '../../features/users/schema/user.schema';
import { Profile, ProfileSchema } from '../../features/profile/schemas/profile.schema';

const INSTITUTIONS = [
  'University of the Aegean', 'KTH Royal Institute of Technology', 'University of Tokyo',
  'University of Lisbon', 'ETH Zurich', 'University of Bologna', 'National Technical University of Athens',
  'IISc Bangalore', 'Sorbonne University', 'Technical University of Munich',
];
const DEPARTMENTS = ['Computer Science', 'Electrical Engineering', 'Mathematics', 'Biology', 'Physics', 'Linguistics'];
const POSITION_TITLES = [
  'Research Assistant', 'Postdoctoral Researcher', 'Research Fellow', 'Assistant Professor',
  'Visiting Researcher', 'Teaching Assistant', 'Senior Researcher', 'Research Engineer',
];
const DEGREES: [degree: string, years: number][] = [
  ['BSc', 4], ['MSc', 2], ['PhD', 4],
];
const FIELDS_OF_STUDY = [
  'Computer Science', 'Data Science', 'Applied Mathematics', 'Bioinformatics',
  'Cognitive Science', 'Electrical Engineering', 'Statistics',
];
const SKILLS = [
  'Python', 'R', 'Statistical Modelling', 'Machine Learning', 'Data Visualisation', 'LaTeX',
  'Academic Writing', 'Experiment Design', 'Scientific Computing', 'Grant Writing', 'Teaching',
  'Distributed Systems', 'Bioinformatics', 'Natural Language Processing',
];
const INTERESTS = [
  'Open Science', 'Reproducible Research', 'Machine Learning', 'Climate Change', 'Neuroscience',
  'Science Communication', 'Open Source', 'Human-Computer Interaction', 'Genomics',
  'Computational Linguistics', 'Robotics', 'Cryptography',
];

const rand = (n: number) => Math.floor(Math.random() * n);
const between = (min: number, max: number) => min + rand(max - min + 1);
const pick = <T>(list: T[]) => list[rand(list.length)];
const sample = <T>(list: T[], n: number) => [...list].sort(() => Math.random() - 0.5).slice(0, n);

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

/** Education, oldest first, ending a few years before the first position starts. */
function makeEducation(firstPositionYear: number) {
  const count = between(1, 3);
  const steps = DEGREES.slice(DEGREES.length - count); // 1 -> PhD, 2 -> MSc+PhD, 3 -> all
  const total = steps.reduce((sum, [, years]) => sum + years, 0);
  let year = firstPositionYear - total;
  return steps.map(([degree, years]) => {
    const field = pick(FIELDS_OF_STUDY);
    const entry = {
      degree: `${degree} in ${field}`,
      institution: pick(INSTITUTIONS),
      fieldOfStudy: field,
      startYear: year,
      endYear: year + years,
    };
    year += years;
    return entry;
  });
}

/** Positions, oldest first; the last one is current. */
function makePositions(firstYear: number) {
  const count = between(2, 3);
  const titles = sample(POSITION_TITLES, count);
  let year = firstYear;
  return titles.map((title, i) => {
    const last = i === count - 1;
    const length = between(1, 3);
    const entry = {
      title,
      institution: pick(INSTITUTIONS),
      department: pick(DEPARTMENTS),
      startDate: new Date(Date.UTC(year, between(0, 11), 1)),
      ...(!last && { endDate: new Date(Date.UTC(year + length, between(0, 11), 1)) }),
      current: last,
    };
    year += length;
    return entry;
  });
}

async function main() {
  loadEnv();
  const uri = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/scholarnet';
  await mongoose.connect(uri);
  console.log(`Connected to ${uri.replace(/\/\/.*@/, '//***@')}`);

  const userModel = mongoose.model<User>(User.name, UserSchema);
  const profileModel = mongoose.model<Profile>(Profile.name, ProfileSchema);

  const users = await userModel
    .find({ role: Role.USER, status: UserStatus.ACTIVE })
    .select('_id username')
    .lean();
  console.log(`Found ${users.length} active users`);

  let updated = 0;
  for (const u of users) {
    const profile = await profileModel.findOne({ user: u._id }).lean();
    const filled =
      profile &&
      (profile.positions?.length || profile.education?.length || profile.skills?.length || profile.interests?.length);
    if (filled) {
      console.log(`- ${u.username} already has profile details, skipped`);
      continue;
    }

    const firstPositionYear = between(2012, 2018);
    await profileModel.updateOne(
      { user: u._id },
      {
        $set: {
          education: makeEducation(firstPositionYear),
          positions: makePositions(firstPositionYear),
          skills: sample(SKILLS, between(3, 5)).map((name) => ({ name, endorsementCount: rand(12) })),
          interests: sample(INTERESTS, between(3, 5)).map((name) => ({ name })),
        },
      },
      { upsert: true },
    );
    updated++;
    console.log(`+ ${u.username}`);
  }

  console.log(`\nDone: ${updated} profiles updated.`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
