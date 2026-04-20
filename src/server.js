require("dotenv").config();

const express = require("express");
const { initDb } = require("../config/postgres");
const { rateLimiter } = require("./middleware/rateLimiter");
const jobsRouter = require("./routes/jobs");
const metricsRouter = require("./routes/metrics");
const { pollLoop } = require("./worker/worker");

const PORT = parseInt(process.env.PORT) || 3000;

const app = express();

// Parse JSON request bodies - required for POST /jobs
app.use(express.json());

// Redis-backed rate limiter applied to every route
app.use(rateLimiter);

// API index
app.get("/", (req, res) => {
  res.json({
    name: "Task Queue Engine",
    version: "1.0.0",
    endpoints: {
      "POST   /jobs": "Enqueue a new job",
      "GET    /jobs": "List jobs (query: ?status=&type=&limit=)",
      "GET    /jobs/:id": "Get job status by ID",
      "DELETE /jobs/:id": "Cancel a pending job",
      "GET    /health": "Health check (Redis + Postgres)",
      "GET    /metrics": "Prometheus metrics",
    },
    docs: "https://github.com/your-repo/task-queue-engine",
  });
});

// Route handlers
app.use("/jobs", jobsRouter);
app.use("/", metricsRouter); // serves GET /metrics and GET /health

async function start() {
  try {
    // Ensure Postgres table exists before accepting traffic
    await initDb();

    // Start the background worker poll loop in the same process
    pollLoop();

    app.listen(PORT, () => {
      console.log(`[Server] Listening on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("[Server] Failed to start:", err.message);
    process.exit(1);
  }
}

start();
