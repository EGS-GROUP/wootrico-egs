import { Writable } from 'node:stream';

/** Captured server log line (parsed from pino JSON). */
export interface LogEntry {
  at: string;
  level: number;
  levelLabel: string;
  msg: string;
  reqId?: string;
  meta?: Record<string, unknown>;
}

const MAX = 500;
const ring: LogEntry[] = [];
const LEVELS: Record<number, string> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

function ingest(text: string): void {
  for (const part of text.split('\n')) {
    const line = part.trim();
    if (!line) continue;
    try {
      const o = JSON.parse(line) as Record<string, unknown>;
      const level = typeof o.level === 'number' ? o.level : 30;
      const { time, level: _l, msg, reqId, pid, hostname, ...meta } = o;
      ring.push({
        at: typeof time === 'number' ? new Date(time).toISOString() : new Date(0).toISOString(),
        level,
        levelLabel: LEVELS[level] ?? String(level),
        msg: typeof msg === 'string' ? msg : '',
        reqId: typeof reqId === 'string' ? reqId : undefined,
        meta: Object.keys(meta).length ? meta : undefined,
      });
      if (ring.length > MAX) ring.shift();
    } catch {
      /* non-JSON line — ignore */
    }
  }
}

/** Writable destination for pino multistream — keeps the last MAX log lines in memory. */
export const logStream = new Writable({
  write(chunk, _enc, cb) {
    ingest(chunk.toString('utf8'));
    cb();
  },
});

/** Most-recent-first server log entries, optionally filtered to >= minLevel. */
export function recentLogs(limit = 200, minLevel?: number): LogEntry[] {
  const filtered = minLevel ? ring.filter((e) => e.level >= minLevel) : ring;
  return filtered.slice(-limit).reverse();
}
