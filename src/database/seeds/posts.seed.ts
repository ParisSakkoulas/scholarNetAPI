/**
 * Feed data for local development: gives every active user 1-3 posts, and every post 1-3
 * comments from other users (plus a few likes).
 *
 *   npm run seed:posts
 *
 * Users that already have posts are skipped, so it is safe to re-run.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import mongoose from 'mongoose';
import { Role } from '../../common/enums/roles.enum';
import { UserStatus } from '../../common/enums/user.status.enum';
import { User, UserSchema } from '../../features/users/schema/user.schema';
import { Post, PostSchema } from '../../features/posts/schemas/post.schema';
import { PostComment, PostCommentSchema } from '../../features/posts/schemas/post-comment.schema';
import { PostLike, PostLikeSchema } from '../../features/posts/schemas/post-like.schema';

const POSTS = [
  'Just submitted a new preprint. Feedback from the community is very welcome!',
  'Excited to share that our paper was accepted at this year\'s conference.',
  'Looking for collaborators interested in open datasets and reproducible pipelines.',
  'Spent the week refactoring our analysis code. Reproducibility is worth the effort.',
  'Our lab is hiring a PhD student starting next semester. Reach out if interested.',
  'A small result today: the baseline we thought was weak turned out to be very strong.',
  'Great discussion at the seminar this morning about evaluation methodology.',
  'Reading group pick of the week: a survey that finally organizes the field nicely.',
  'Released the dataset from our last project under an open licence. Link in my publications.',
  'Reviewer 2 was right, again. Revising the experiments section.',
  'Thinking about how we measure impact beyond citation counts. Thoughts?',
  'Field work wrapped up. Now comes the long part: cleaning the data.',
];

const COMMENTS = [
  'Congratulations, well deserved!',
  'Very interesting, would love to read more about the method.',
  'Thanks for sharing. Do you have the code available?',
  'This matches what we saw in our own experiments.',
  'Great point, I had not considered that angle.',
  'Happy to collaborate on this, sending you a message.',
  'Looking forward to the full paper.',
  'Could you share the evaluation setup?',
  'Nicely put. Bookmarked for the reading group.',
  'Same here, the baselines are often underrated.',
];

const rand = (n: number) => Math.floor(Math.random() * n);
const between = (min: number, max: number) => min + rand(max - min + 1);
const pick = <T>(list: T[]) => list[rand(list.length)];
const sample = <T>(list: T[], n: number) =>
  [...list].sort(() => Math.random() - 0.5).slice(0, n);
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);

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

async function main() {
  loadEnv();
  const uri = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/scholarnet';
  await mongoose.connect(uri);
  console.log(`Connected to ${uri.replace(/\/\/.*@/, '//***@')}`);

  const userModel = mongoose.model<User>(User.name, UserSchema);
  const postModel = mongoose.model<Post>(Post.name, PostSchema);
  const commentModel = mongoose.model<PostComment>(PostComment.name, PostCommentSchema);
  const likeModel = mongoose.model<PostLike>(PostLike.name, PostLikeSchema);

  const users = await userModel
    .find({ role: Role.USER, status: UserStatus.ACTIVE })
    .select('_id username')
    .lean();
  if (users.length < 2) throw new Error('Need at least 2 active users (run seed:dummy first).');
  console.log(`Found ${users.length} active users`);

  let posts = 0;
  let comments = 0;

  for (const u of users) {
    if (await postModel.exists({ author: u._id })) {
      console.log(`- ${u.username} already has posts, skipped`);
      continue;
    }
    const others = users.filter((o) => String(o._id) !== String(u._id));

    for (const content of sample(POSTS, between(1, 3))) {
      const postedAt = hoursAgo(between(2, 24 * 14));
      const commenters = sample(others, between(1, 3));
      const likers = sample(others, between(0, others.length));

      const post = await postModel.create({
        author: u._id,
        content,
        likesCount: likers.length,
        commentsCount: commenters.length,
        createdAt: postedAt,
      });

      await commentModel.insertMany(
        commenters.map((c, i) => ({
          post: post._id,
          author: c._id,
          content: pick(COMMENTS),
          createdAt: new Date(postedAt.getTime() + (i + 1) * 40 * 60_000),
        })),
      );
      if (likers.length) {
        await likeModel.insertMany(likers.map((l) => ({ post: post._id, user: l._id })));
      }
      posts++;
      comments += commenters.length;
    }
    console.log(`+ ${u.username}`);
  }

  console.log(`\nDone: ${posts} posts and ${comments} comments created.`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
