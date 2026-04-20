const express = require("express");
const router = express.Router();
const { registry, metrics } = require("../metrics/metrics");
const { getQueueStats } = require("../queue/queue");
const { redis } = require("../../config/redis");
const { pool } = require("../../config/postgres");

router.get("/metrics", async (req, res) => {
  try {
    const stats = await getQueueStats();
    metrics.queueSize.set({ state: "pending" }, stats.pending);
    metrics.queueSize.set({ state: "active" }, stats.active);
    metrics.queueSize.set({ state: "dead" }, stats.dead);

    const output = await registry.metrics();
    res.set("Content-Type", registry.contentType);
    res.send(output);
  } catch (_) {
    res.status(500).send("# metrics unavailable\n");
  }
});

router.get("/health", async (req, res) => {
  const checks = { redis: false, postgres: false };

  try {
    checks.redis = (await redis.ping()) === "PONG";
  } catch (_) {}
  try {
    await pool.query("SELECT 1");
    checks.postgres = true;
  } catch (_) {}

  const healthy = checks.redis && checks.postgres;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    checks,
    uptime: Math.floor(process.uptime()),
    memory: process.memoryUsage().heapUsed,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
