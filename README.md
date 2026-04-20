# Task Queue Engine

Distributed task queue built with Node.js, Redis, PostgreSQL, Prometheus, and Grafana.

## Features

- Priority-based job queue using Redis sorted sets (`ZPOPMIN` for atomic dequeue)
- Dead-letter queue for jobs exceeding max retry attempts
- Configurable worker concurrency via `p-limit`
- Graceful shutdown on `SIGTERM`/`SIGINT`
- Redis-backed per-IP rate limiting (100 req/60s)
- Prometheus metrics + auto-provisioned Grafana dashboard (8 panels)
- 13 Jest unit tests

## API

| Method | Path | Description |
|---|---|---|
| `POST` | `/jobs` | Enqueue a job |
| `GET` | `/jobs` | List jobs (filter by `?status=` `?type=` `?limit=`) |
| `GET` | `/jobs/:id` | Get a single job |
| `DELETE` | `/jobs/:id` | Cancel a pending job |
| `GET` | `/health` | Liveness check |
| `GET` | `/metrics` | Prometheus scrape endpoint |
| `GET` | `/` | API index |

Job types: `send_email`, `resize_image`, `generate_report` (see [src/jobs/handlers.js](src/jobs/handlers.js)).

## Run locally with Docker Compose

```bash
cp .env.example .env
docker compose up -d        # starts Redis, Postgres, Prometheus, Grafana
npm install
npm start
```

- API: http://localhost:3000
- Grafana: http://localhost:3001 (anonymous viewer enabled, dashboard auto-loaded)
- Prometheus: http://localhost:9090

Run tests: `npm test`

```

## Project structure

```
src/
  server.js           Express bootstrap, mounts routes, starts worker
  queue/queue.js      Redis-backed queue (enqueue, dequeue, complete, fail)
  worker/worker.js    Poll loop with p-limit concurrency, graceful shutdown
  jobs/handlers.js    Job-type handlers (send_email, resize_image, ...)
  routes/jobs.js      REST API for jobs
  routes/metrics.js   /metrics + /health
  metrics/metrics.js  prom-client metric definitions
  middleware/rateLimiter.js  Redis-backed per-IP rate limiter
config/
  redis.js, postgres.js  Database clients
tests/
  queue.test.js       13 Jest unit tests with full Redis/Postgres mocks
grafana/
  provisioning/       Auto-loaded datasource + dashboard for Docker Compose
```
