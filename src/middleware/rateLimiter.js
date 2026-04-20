const { redis } = require("../../config/redis");

const WINDOW = 60; // seconds
const MAX_REQ = 100; // per IP per window

async function rateLimiter(req, res, next) {
  const ip = req.headers["x-forwarded-for"] || req.ip;
  const key = `rl:${ip}`;

  try {
    const count = await redis.incr(key);
    // set expiry only on the first hit so the window doesn't keep sliding
    if (count === 1) await redis.expire(key, WINDOW);

    res.setHeader("X-RateLimit-Limit", MAX_REQ);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, MAX_REQ - count));

    if (count > MAX_REQ) {
      return res
        .status(429)
        .json({ error: "Too many requests", retryAfter: `${WINDOW}s` });
    }
    next();
  } catch (err) {
    // fail open — a Redis outage shouldn't take down the API
    console.error("[RateLimiter] Redis error:", err.message);
    next();
  }
}

module.exports = { rateLimiter };
