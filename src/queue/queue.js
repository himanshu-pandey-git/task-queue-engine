const { redis } = require("../../config/redis");
const { v4: uuidv4 } = require("uuid");
const { pool } = require("../../config/postgres");

const KEYS = {
  pending: "queue:pending",
  active: "queue:active",
  dead: "queue:dead",
  job: (id) => `job:${id}`,
};

async function enqueue(type, payload = {}, options = {}) {
  const id = uuidv4();
  const priority = options.priority ?? 0;
  const maxAttempts = options.maxAttempts ?? 3;
  const now = Date.now();

  await redis.hset(KEYS.job(id), {
    id,
    type,
    payload: JSON.stringify(payload),
    status: "pending",
    priority: String(priority),
    attempts: "0",
    maxAttempts: String(maxAttempts),
    createdAt: String(now),
    updatedAt: String(now),
  });

  // score = priority * 1e13 + timestamp so lower priority wins, ties break by insertion order
  await redis.zadd(KEYS.pending, priority * 1e13 + now, id);

  await pool.query(
    `INSERT INTO jobs (id, type, payload, status, priority, max_attempts, created_at, updated_at)
     VALUES ($1, $2, $3, 'pending', $4, $5, NOW(), NOW())`,
    [id, type, JSON.stringify(payload), priority, maxAttempts],
  );

  return id;
}

async function dequeue() {
  // ZPOPMIN is atomic — two workers can never pop the same job
  const result = await redis.zpopmin(KEYS.pending, 1);
  if (!result || result.length === 0) return null;

  const jobId = result[0];
  await redis.sadd(KEYS.active, jobId);

  const jobData = await redis.hgetall(KEYS.job(jobId));
  if (!jobData || !jobData.id) return null;

  return {
    ...jobData,
    payload: JSON.parse(jobData.payload),
    attempts: parseInt(jobData.attempts),
    maxAttempts: parseInt(jobData.maxAttempts),
    priority: parseInt(jobData.priority),
  };
}

async function markComplete(jobId, result = {}) {
  await redis.hset(KEYS.job(jobId), {
    status: "completed",
    result: JSON.stringify(result),
    updatedAt: String(Date.now()),
  });
  await redis.srem(KEYS.active, jobId);
  await pool.query(
    `UPDATE jobs SET status='completed', result=$1, updated_at=NOW() WHERE id=$2`,
    [JSON.stringify(result), jobId],
  );
}

async function markFailed(jobId, error) {
  const jobData = await redis.hgetall(KEYS.job(jobId));
  if (!jobData) return;

  const attempts = parseInt(jobData.attempts) + 1;
  const maxAttempts = parseInt(jobData.maxAttempts);
  const now = Date.now();

  await redis.hset(KEYS.job(jobId), {
    attempts: String(attempts),
    error: error.message || String(error),
    updatedAt: String(now),
  });
  await redis.srem(KEYS.active, jobId);

  if (attempts < maxAttempts) {
    // re-enqueue with a penalty score so other jobs run first
    const score = (parseInt(jobData.priority) + 100) * 1e13 + now;
    await redis.hset(KEYS.job(jobId), { status: "pending" });
    await redis.zadd(KEYS.pending, score, jobId);
    await pool.query(
      `UPDATE jobs SET status='pending', attempts=$1, error=$2, updated_at=NOW() WHERE id=$3`,
      [attempts, error.message, jobId],
    );
  } else {
    await redis.hset(KEYS.job(jobId), { status: "failed" });
    await redis.zadd(KEYS.dead, now, jobId);
    await pool.query(
      `UPDATE jobs SET status='failed', attempts=$1, error=$2, updated_at=NOW() WHERE id=$3`,
      [attempts, error.message, jobId],
    );
  }
}

async function getJob(jobId) {
  const data = await redis.hgetall(KEYS.job(jobId));
  if (!data || !data.id) return null;
  return {
    ...data,
    payload: JSON.parse(data.payload || "{}"),
    attempts: parseInt(data.attempts || 0),
  };
}

async function getQueueStats() {
  const [pending, active, dead] = await Promise.all([
    redis.zcard(KEYS.pending),
    redis.scard(KEYS.active),
    redis.zcard(KEYS.dead),
  ]);
  return { pending, active, dead };
}

module.exports = {
  enqueue,
  dequeue,
  markComplete,
  markFailed,
  getJob,
  getQueueStats,
};
