import Redis from 'ioredis';
import { randomBytes } from 'node:crypto';
import { env, logger } from '@wootrico/config';

let redis: Redis | undefined;
let lastRedisErrAt = 0; // throttle the connection-error log (ioredis emits on every retry)

// Optional runtime override of the Redis URL (set at boot from DB settings,
// taking precedence over the env var). Empty/undefined falls back to env.
let urlOverride: string | undefined;
export function setRedisUrl(url?: string): void {
  urlOverride = url && url.trim() ? url.trim() : undefined;
}
export function effectiveRedisUrl(): string {
  return urlOverride ?? env.REDIS_URL;
}

export function getRedis(): Redis {
  if (redis) return redis;
  redis = new Redis(effectiveRedisUrl(), { maxRetriesPerRequest: null, lazyConnect: false });
  // Handle 'error' so ioredis doesn't spam "Unhandled error event" on every retry
  // (e.g. when the configured host is unreachable). Throttled to once / 30s.
  redis.on('error', (err: Error) => {
    const now = Date.now();
    if (now - lastRedisErrAt > 30_000) {
      lastRedisErrAt = now;
      logger.warn({ err: err.message, url: effectiveRedisUrl() }, 'redis connection error');
    }
  });
  return redis;
}

export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit().catch(() => undefined);
    redis = undefined;
  }
}

export interface PingResult {
  ok: boolean;
  detail?: string;
}

/** Ping the active Redis (the one the app is actually using). Bounded by a
 *  timeout so an unreachable host never HANGS the caller (the main client uses
 *  infinite retries, so its ping would otherwise queue forever). */
export async function pingRedis(timeoutMs = 5000): Promise<PingResult> {
  try {
    const pong = await Promise.race([
      getRedis().ping(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), timeoutMs),
      ),
    ]);
    return { ok: pong === 'PONG', detail: pong };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}

/** Connect to an arbitrary Redis URL, PING, and disconnect. Used to validate a
 *  new connection string BEFORE persisting it (test-before-apply). */
export async function testRedisUrl(url: string): Promise<PingResult> {
  let client: Redis | undefined;
  try {
    client = new Redis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 8000,
      lazyConnect: true,
      retryStrategy: () => null,
    });
    await client.connect();
    const pong = await client.ping();
    return { ok: pong === 'PONG', detail: pong };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  } finally {
    if (client) client.disconnect();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────── distributed lock ───────────────────────────

const UNLOCK = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

/**
 * Run `fn` while holding a Redis lock on `key`. Used to serialize processing per
 * conversation so messages stay ordered (replaces the old fixed delay).
 */
export async function withLock<T>(
  key: string,
  fn: () => Promise<T>,
  opts: { ttlMs?: number; waitMs?: number; retryMs?: number } = {},
): Promise<T> {
  const r = getRedis();
  const token = randomBytes(16).toString('hex');
  const ttl = opts.ttlMs ?? 30_000;
  const wait = opts.waitMs ?? 15_000;
  const retry = opts.retryMs ?? 100;
  const deadline = Date.now() + wait;

  // acquire
  while (true) {
    const ok = await r.set(key, token, 'PX', ttl, 'NX');
    if (ok) break;
    if (Date.now() > deadline) throw new Error(`lock timeout: ${key}`);
    await sleep(retry);
  }
  try {
    return await fn();
  } finally {
    await r.eval(UNLOCK, 1, key, token).catch(() => undefined);
  }
}

// ─────────────────────────── json cache ───────────────────────────

export async function cacheGet<T>(key: string): Promise<T | null> {
  const v = await getRedis().get(key);
  return v ? (JSON.parse(v) as T) : null;
}

export async function cacheSet(key: string, value: unknown, ttlSec: number): Promise<void> {
  await getRedis().set(key, JSON.stringify(value), 'EX', ttlSec);
}

export async function cacheDel(key: string): Promise<void> {
  await getRedis().del(key);
}

/** get-or-compute with TTL. */
export async function cached<T>(key: string, ttlSec: number, compute: () => Promise<T>): Promise<T> {
  const hit = await cacheGet<T>(key);
  if (hit !== null) return hit;
  const value = await compute();
  if (value !== null && value !== undefined) await cacheSet(key, value, ttlSec);
  return value;
}

// ─────────────────────────── throttle (pacing) ───────────────────────────

// Atomically schedule the next allowed timestamp and return ms to wait.
const THROTTLE = `
local now = tonumber(ARGV[1])
local interval = tonumber(ARGV[2])
local last = tonumber(redis.call('get', KEYS[1]) or '0')
local nextAt = math.max(now, last + interval)
redis.call('set', KEYS[1], nextAt, 'PX', interval * 5)
return nextAt - now`;

/** Pace operations on `key` to at most one per `intervalMs` (sleeps as needed). */
export async function throttle(key: string, intervalMs: number): Promise<void> {
  const waitMs = (await getRedis().eval(THROTTLE, 1, key, Date.now().toString(), intervalMs.toString())) as number;
  if (waitMs > 0) await sleep(waitMs);
}
