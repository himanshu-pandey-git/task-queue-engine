const client = require('prom-client');
 
// prom-client can auto-collect Node.js internals: event loop lag, memory,
// GC pauses, active handles. These are invaluable for diagnosing slowdowns.
const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics({ prefix: 'taskqueue_' });
 
// Counter: total jobs processed, broken down by type and outcome
const jobsTotal = new client.Counter({
  name: 'taskqueue_jobs_total',
  help: 'Total number of jobs processed',
  labelNames: ['type', 'status'], // status = 'completed' | 'failed'
});
 
// Histogram: records a distribution of job processing times.
// `buckets` define the boundaries in seconds. Prometheus will tell you
// "X% of jobs finished within 0.5 seconds", "Y% within 2 seconds", etc.
const jobDuration = new client.Histogram({
  name: 'taskqueue_job_duration_seconds',
  help: 'Time taken to process a job',
  labelNames: ['type'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
});
 
// Gauges: current state of the queues (updated by the stats endpoint on each scrape)
const queueSize = new client.Gauge({
  name: 'taskqueue_queue_size',
  help: 'Current number of jobs in each queue state',
  labelNames: ['state'], // state = 'pending' | 'active' | 'dead'
});
 
// Register everything in prom-client's default registry so /metrics returns them all
const registry = client.register;
 
module.exports = { metrics: { jobsTotal, jobDuration, queueSize }, registry };