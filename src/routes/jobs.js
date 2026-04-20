const express = require("express");
const router = express.Router();
const { enqueue, getJob } = require("../queue/queue");
const { pool } = require("../../config/postgres");
const { redis } = require("../../config/redis");

router.post("/", async (req, res) => {
  const { type, payload, priority, maxAttempts } = req.body;

  if (!type || typeof type !== "string") {
    return res
      .status(400)
      .json({ error: '"type" is required and must be a string' });
  }

  try {
    const jobId = await enqueue(type, payload || {}, {
      priority: parseInt(priority) || 0,
      maxAttempts: parseInt(maxAttempts) || 3,
    });
    // 202 Accepted — work is queued, not yet done
    res.status(202).json({ jobId, status: "pending" });
  } catch (err) {
    console.error("[API] enqueue failed:", err.message);
    res.status(500).json({ error: "Failed to enqueue job" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Job not found" });
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch job" });
  }
});

router.delete("/:id", async (req, res) => {
  const { id: jobId } = req.params;
  try {
    const job = await getJob(jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });

    if (job.status !== "pending") {
      return res.status(409).json({
        error: `Cannot cancel a job with status "${job.status}"`,
      });
    }

    await redis.zrem("queue:pending", jobId);
    await redis.hset(`job:${jobId}`, {
      status: "cancelled",
      updatedAt: String(Date.now()),
    });
    await pool.query(
      `UPDATE jobs SET status='cancelled', updated_at=NOW() WHERE id=$1`,
      [jobId],
    );

    res.json({ jobId, status: "cancelled" });
  } catch (err) {
    res.status(500).json({ error: "Failed to cancel job" });
  }
});

router.get("/", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const status = req.query.status;
  const type = req.query.type;

  try {
    const conditions = [];
    const values = [];

    if (status) {
      conditions.push(`status = $${values.length + 1}`);
      values.push(status);
    }
    if (type) {
      conditions.push(`type   = $${values.length + 1}`);
      values.push(type);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    values.push(limit);

    const result = await pool.query(
      `SELECT id, type, status, priority, attempts, max_attempts, error, created_at, updated_at
       FROM jobs ${where}
       ORDER BY created_at DESC
       LIMIT $${values.length}`,
      values,
    );
    res.json({ jobs: result.rows, count: result.rows.length });
  } catch (err) {
    res.status(500).json({ error: "Failed to list jobs" });
  }
});

module.exports = router;
