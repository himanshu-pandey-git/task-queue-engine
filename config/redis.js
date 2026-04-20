const Redis = require('ioredis');
require('dotenv').config();

const url = process.env.REDIS_URL || process.env.REDIS_PRIVATE_URL;

const opts = url
  ? url
  : {
      host: process.env.REDISHOST || process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDISPORT || process.env.REDIS_PORT) || 6379,
      username: process.env.REDISUSER || undefined,
      password: process.env.REDISPASSWORD || undefined,
      retryStrategy: (times) => Math.min(times * 100, 3000),
      maxRetriesPerRequest: 3,
    };

const redis = new Redis(opts);

redis.on('connect', () => console.log('[Redis] Connected'));
redis.on('error', (err) => console.error('[Redis] Error:', err.message));

module.exports = { redis };