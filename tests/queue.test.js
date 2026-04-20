jest.mock("../config/redis", () => ({
  redis: {
    hset: jest.fn(),
    zadd: jest.fn(),
    zpopmin: jest.fn(),
    sadd: jest.fn(),
    srem: jest.fn(),
    hgetall: jest.fn(),
    zcard: jest.fn(),
    scard: jest.fn(),
  },
}));

jest.mock("../config/postgres", () => ({
  pool: { query: jest.fn() },
  initDb: jest.fn(),
}));

jest.mock("uuid", () => ({ v4: jest.fn(() => "test-uuid-1234") }));

const { redis } = require("../config/redis");
const { pool } = require("../config/postgres");
const {
  enqueue,
  dequeue,
  markFailed,
  markComplete,
} = require("../src/queue/queue");

function makeJobHash(overrides = {}) {
  return {
    id: "test-uuid-1234",
    type: "send_email",
    payload: JSON.stringify({ to: "a@b.com", subject: "Hi" }),
    status: "active",
    priority: "0",
    attempts: "0",
    maxAttempts: "3",
    createdAt: "1000000",
    updatedAt: "1000000",
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());

describe("enqueue()", () => {
  test("returns the generated job ID", async () => {
    redis.hset.mockResolvedValue(1);
    redis.zadd.mockResolvedValue(1);
    pool.query.mockResolvedValue({ rows: [] });

    const id = await enqueue("send_email", { to: "a@b.com" }, { priority: 0 });

    expect(id).toBe("test-uuid-1234");
  });

  test("writes job hash to Redis with correct fields", async () => {
    redis.hset.mockResolvedValue(1);
    redis.zadd.mockResolvedValue(1);
    pool.query.mockResolvedValue({ rows: [] });

    await enqueue(
      "send_email",
      { to: "a@b.com" },
      { priority: 2, maxAttempts: 5 },
    );

    expect(redis.hset).toHaveBeenCalledWith(
      "job:test-uuid-1234",
      expect.objectContaining({
        id: "test-uuid-1234",
        type: "send_email",
        status: "pending",
        priority: "2",
        maxAttempts: "5",
        attempts: "0",
      }),
    );
  });

  test("adds job to queue:pending sorted set with priority-encoded score", async () => {
    redis.hset.mockResolvedValue(1);
    redis.zadd.mockResolvedValue(1);
    pool.query.mockResolvedValue({ rows: [] });

    await enqueue("send_email", {}, { priority: 3 });

    const [key, score] = redis.zadd.mock.calls[0];
    expect(key).toBe("queue:pending");
    expect(score).toBeGreaterThanOrEqual(3e13);
  });

  test("inserts a row into Postgres as the durable record", async () => {
    redis.hset.mockResolvedValue(1);
    redis.zadd.mockResolvedValue(1);
    pool.query.mockResolvedValue({ rows: [] });

    await enqueue("resize_image", { imageUrl: "https://example.com/img.jpg" });

    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][0]).toMatch(/INSERT INTO jobs/i);
  });
});

describe("dequeue()", () => {
  test("returns null when the queue is empty", async () => {
    redis.zpopmin.mockResolvedValue([]);

    const job = await dequeue();

    expect(job).toBeNull();
    expect(redis.sadd).not.toHaveBeenCalled();
  });

  test("returns the job object with parsed payload and numeric fields", async () => {
    redis.zpopmin.mockResolvedValue(["test-uuid-1234", "1000000000000"]);
    redis.sadd.mockResolvedValue(1);
    redis.hgetall.mockResolvedValue(makeJobHash());

    const job = await dequeue();

    expect(job.id).toBe("test-uuid-1234");
    expect(job.type).toBe("send_email");
    expect(job.payload).toEqual({ to: "a@b.com", subject: "Hi" });
    expect(job.attempts).toBe(0);
    expect(job.priority).toBe(0);
  });

  test("moves job ID into queue:active set after popping", async () => {
    redis.zpopmin.mockResolvedValue(["test-uuid-1234", "500"]);
    redis.sadd.mockResolvedValue(1);
    redis.hgetall.mockResolvedValue(makeJobHash());

    await dequeue();

    expect(redis.sadd).toHaveBeenCalledWith("queue:active", "test-uuid-1234");
  });
});

describe("markFailed()", () => {
  test("re-enqueues to queue:pending when retries remain (attempt 1 of 3)", async () => {
    redis.hgetall.mockResolvedValue(
      makeJobHash({ attempts: "0", maxAttempts: "3" }),
    );
    redis.hset.mockResolvedValue(1);
    redis.srem.mockResolvedValue(1);
    redis.zadd.mockResolvedValue(1);
    pool.query.mockResolvedValue({ rows: [] });

    await markFailed("test-uuid-1234", new Error("network timeout"));

    const zaddCalls = redis.zadd.mock.calls;
    const keys = zaddCalls.map((c) => c[0]);
    expect(keys).toContain("queue:pending");
    expect(keys).not.toContain("queue:dead");
  });

  test("moves job to queue:dead when all retries are exhausted (attempt 3 of 3)", async () => {
    redis.hgetall.mockResolvedValue(
      makeJobHash({ attempts: "2", maxAttempts: "3" }),
    );
    redis.hset.mockResolvedValue(1);
    redis.srem.mockResolvedValue(1);
    redis.zadd.mockResolvedValue(1);
    pool.query.mockResolvedValue({ rows: [] });

    await markFailed("test-uuid-1234", new Error("still failing"));

    const zaddCalls = redis.zadd.mock.calls;
    const keys = zaddCalls.map((c) => c[0]);
    expect(keys).toContain("queue:dead");
    expect(keys).not.toContain("queue:pending");
  });

  test("always removes job from queue:active regardless of retry outcome", async () => {
    redis.hgetall.mockResolvedValue(
      makeJobHash({ attempts: "1", maxAttempts: "3" }),
    );
    redis.hset.mockResolvedValue(1);
    redis.srem.mockResolvedValue(1);
    redis.zadd.mockResolvedValue(1);
    pool.query.mockResolvedValue({ rows: [] });

    await markFailed("test-uuid-1234", new Error("oops"));

    expect(redis.srem).toHaveBeenCalledWith("queue:active", "test-uuid-1234");
  });

  test("updates Postgres with the error message", async () => {
    redis.hgetall.mockResolvedValue(
      makeJobHash({ attempts: "2", maxAttempts: "3" }),
    );
    redis.hset.mockResolvedValue(1);
    redis.srem.mockResolvedValue(1);
    redis.zadd.mockResolvedValue(1);
    pool.query.mockResolvedValue({ rows: [] });

    await markFailed("test-uuid-1234", new Error("disk full"));

    const pgArgs = pool.query.mock.calls[0][1];
    expect(pgArgs).toContain("disk full");
  });
});

describe("markComplete()", () => {
  test("sets status to completed in Redis and removes from queue:active", async () => {
    redis.hset.mockResolvedValue(1);
    redis.srem.mockResolvedValue(1);
    pool.query.mockResolvedValue({ rows: [] });

    await markComplete("test-uuid-1234", { sent: true });

    expect(redis.hset).toHaveBeenCalledWith(
      "job:test-uuid-1234",
      expect.objectContaining({ status: "completed" }),
    );
    expect(redis.srem).toHaveBeenCalledWith("queue:active", "test-uuid-1234");
  });

  test("persists result to Postgres", async () => {
    redis.hset.mockResolvedValue(1);
    redis.srem.mockResolvedValue(1);
    pool.query.mockResolvedValue({ rows: [] });

    await markComplete("test-uuid-1234", { sent: true, to: "a@b.com" });

    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][0]).toMatch(
      /UPDATE jobs SET status='completed'/i,
    );
  });
});
