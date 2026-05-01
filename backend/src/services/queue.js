/**
 * Background-job queue — Audit 4.3.
 *
 * Wraps BullMQ when REDIS_URL is configured, falls back to an in-process
 * "fire-and-forget" runner otherwise. The fallback is deliberately a
 * NO-DURABILITY shim: callers can use `enqueue('jobName', payload)`
 * the same way in dev (no Redis) and production (Redis), but in dev
 * the job runs immediately and isn't retried on crash.
 *
 * Why this shape:
 *   - Most current call sites (Stripe webhook, smart-device sync) don't
 *     yet use queues. This file gives them a one-line upgrade path: swap
 *     `await myAsyncWork()` for `await queue.enqueue('my-work', payload)`
 *     and the production path automatically becomes durable + retryable
 *     once REDIS_URL lands in Railway.
 *   - Workers register handlers via `register('jobName', async (job) => …)`.
 *     With BullMQ the handler is wired to a Worker; without, register()
 *     just stores the function and enqueue() invokes it directly.
 *
 * What's intentionally NOT here:
 *   - No retries / backoff in fallback mode (would just defer crashes).
 *   - No cross-process coordination — production needs Redis for that.
 *   - No persistence — pending jobs lost on restart in fallback mode.
 *
 * To go from "scaffolded" to "live":
 *   1. Add a Redis service in Railway (Upstash add-on or Railway's own
 *      Redis plugin) → set REDIS_URL.
 *   2. `npm install bullmq ioredis` in backend/.
 *   3. Restart. enqueue() will detect bullmq + REDIS_URL and switch.
 */

const handlers = new Map();
let _bullQueue = null;
let _bullWorker = null;

function _bullAvailable() {
  if (!process.env.REDIS_URL) return false;
  try { require.resolve('bullmq'); } catch (e) { return false; }
  return true;
}

function _initBull() {
  if (_bullQueue) return _bullQueue;
  if (!_bullAvailable()) return null;
  const { Queue, Worker } = require('bullmq');
  const IORedis = require('ioredis');
  const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
  _bullQueue = new Queue('atp', { connection });
  // Single worker handles every job type by name. handlers map lookup
  // happens at job-process time so callers can register late.
  _bullWorker = new Worker('atp', async (job) => {
    const fn = handlers.get(job.name);
    if (!fn) {
      console.warn('[queue] no handler registered for', job.name);
      return;
    }
    return fn(job);
  }, { connection });
  _bullWorker.on('failed', (job, err) => {
    console.error('[queue] job failed', job && job.name, err && err.message);
  });
  return _bullQueue;
}

/**
 * Register a handler for a named job. Safe to call before _initBull().
 */
function register(name, fn) {
  if (typeof fn !== 'function') throw new Error('queue.register: fn must be a function');
  handlers.set(name, fn);
}

/**
 * Enqueue a job. In production (REDIS_URL + bullmq installed) returns
 * a BullMQ Job. In dev / fallback mode runs the handler inline and
 * returns its result.
 */
async function enqueue(name, payload, opts) {
  const q = _initBull();
  if (q) {
    return q.add(name, payload || {}, {
      attempts:    (opts && opts.attempts)    || 3,
      backoff:     (opts && opts.backoff)     || { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail:     { age: 86400 * 7 },
      ...opts,
    });
  }
  // Fallback — invoke directly. Errors propagate to the caller; not
  // ideal for prod-style "fire and forget" but explicit in dev.
  const fn = handlers.get(name);
  if (!fn) {
    console.warn('[queue] enqueue called for unregistered handler:', name);
    return null;
  }
  return fn({ name, data: payload || {}, id: 'inline-' + Date.now() });
}

/**
 * Drain the bull queue + close redis connections. Used by tests.
 */
async function close() {
  if (_bullWorker) await _bullWorker.close();
  if (_bullQueue)  await _bullQueue.close();
  _bullWorker = null;
  _bullQueue  = null;
}

function status() {
  return {
    mode: _bullAvailable() ? 'bullmq' : 'inline',
    redis_url_set: Boolean(process.env.REDIS_URL),
    handlers: Array.from(handlers.keys()),
  };
}

module.exports = { register, enqueue, close, status };
