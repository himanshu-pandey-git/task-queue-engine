const { dequeue, markComplete, markFailed } = require("../queue/queue");
const { handlers } = require("../jobs/handlers");
const { metrics } = require("../metrics/metrics");
const pLimit = require("p-limit");
require("dotenv").config();

const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY) || 5;
const POLL_INTERVAL = 500;

const limit = pLimit(CONCURRENCY);
let running = true;
let activeCount = 0;

async function processJob(job) {
  activeCount++;
  const start = Date.now();
  console.log(
    `[Worker] Starting job ${job.id} (type: ${job.type}, attempt: ${job.attempts + 1})`,
  );

  try {
    const handler = handlers[job.type];
    if (!handler)
      throw new Error(`No handler registered for job type: "${job.type}"`);

    const result = await handler(job.payload);
    const duration = (Date.now() - start) / 1000;
    await markComplete(job.id, result);

    console.log(`[Worker] Completed job ${job.id} in ${duration.toFixed(2)}s`);
    metrics.jobsTotal.inc({ type: job.type, status: "completed" });
    metrics.jobDuration.observe({ type: job.type }, duration);
  } catch (err) {
    await markFailed(job.id, err);
    console.error(`[Worker] Failed job ${job.id}: ${err.message}`);
    metrics.jobsTotal.inc({ type: job.type, status: "failed" });
  } finally {
    activeCount--;
  }
}

async function pollLoop() {
  console.log(`[Worker] Started. Concurrency: ${CONCURRENCY}`);

  while (running) {
    if (activeCount >= CONCURRENCY) {
      await sleep(100);
      continue;
    }

    const job = await dequeue();
    if (!job) {
      await sleep(POLL_INTERVAL);
      continue;
    }

    limit(() => processJob(job));
  }

  while (activeCount > 0) {
    console.log(`[Worker] Draining — ${activeCount} job(s) still running...`);
    await sleep(500);
  }
  console.log("[Worker] Shutdown complete.");
}

function shutdown(signal) {
  console.log(
    `[Worker] ${signal} received, stopping after current jobs finish.`,
  );
  running = false;
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { pollLoop };
