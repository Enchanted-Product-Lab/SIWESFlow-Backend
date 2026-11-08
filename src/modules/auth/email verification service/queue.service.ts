import { Redis } from "@upstash/redis";
import { sendEmail } from "./email.service.js";

export interface VerificationJob {
  userId: string;
  email: string;
  link: string;
  timestamp: number;
}

const QUEUE_KEY = "siwesflow:email_verification_queue";

let redisClient: Redis | null = null;

function getRedis(): Redis | null {
  if (redisClient) return redisClient;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  redisClient = new Redis({ url, token });
  return redisClient;
}

// In-memory queue fallback for offline test environments
const memoryQueue: VerificationJob[] = [];

export async function enqueueVerificationEmail(job: VerificationJob): Promise<void> {
  const redis = getRedis();
  if (redis) {
    await redis.rpush(QUEUE_KEY, JSON.stringify(job));
  } else {
    memoryQueue.push(job);
  }
}

export async function dequeueVerificationEmail(): Promise<VerificationJob | null> {
  const redis = getRedis();
  if (redis) {
    const raw = await redis.lpop<string>(QUEUE_KEY);
    if (!raw) return null;
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  }
  return memoryQueue.shift() ?? null;
}

export async function processVerificationEmailJob(job: VerificationJob): Promise<void> {
  await sendEmail({
    to: job.email,
    subject: "Verify your SIWESFlow email address",
    text:
      `Welcome to SIWESFlow.\n\n` +
      `Verify your email address with this link (valid for 24 hours):\n${job.link}\n\n` +
      `If you didn't create an account, you can ignore this email.`,
  });
}

// Worker to drain pending jobs
export async function drainVerificationQueue(): Promise<number> {
  let count = 0;
  let job = await dequeueVerificationEmail();
  while (job) {
    await processVerificationEmailJob(job);
    count++;
    job = await dequeueVerificationEmail();
  }
  return count;
}
