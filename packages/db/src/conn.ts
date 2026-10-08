import { decrypt } from '@wootrico/config';
import { setRabbitUrl, effectiveRabbitUrl } from '@wootrico/queue';
import { setRedisUrl, effectiveRedisUrl } from '@wootrico/cache';
import { prisma } from './index.js';

/** The connection strings actually in effect for THIS process (captured at boot,
 *  after applying any DB overrides). Used to detect "edited but not yet applied". */
export interface ConnSnapshot {
  rabbitmqUrl: string;
  redisUrl: string;
  databaseUrl: string;
}

let snapshot: ConnSnapshot | undefined;

/**
 * Read the optional connection overrides from AppSettings and apply them to the
 * queue/cache clients BEFORE any connection is opened. Postgres can't be
 * overridden here (it's needed to read the settings) — it always uses the env.
 * Safe to call before migrations exist (falls back to env on any error).
 */
export async function applyConnectionOverrides(): Promise<ConnSnapshot> {
  let rabbit: string | undefined;
  let redisU: string | undefined;
  try {
    const s = await prisma.appSettings.findUnique({ where: { id: 'singleton' } });
    if (s?.rabbitmqUrl) {
      try {
        rabbit = decrypt(s.rabbitmqUrl);
      } catch {
        /* corrupt/old key — ignore, use env */
      }
    }
    if (s?.redisUrl) {
      try {
        redisU = decrypt(s.redisUrl);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* settings table not migrated yet — use env defaults */
  }
  setRabbitUrl(rabbit);
  setRedisUrl(redisU);
  snapshot = {
    rabbitmqUrl: effectiveRabbitUrl(),
    redisUrl: effectiveRedisUrl(),
    databaseUrl: process.env.DATABASE_URL ?? '',
  };
  return snapshot;
}

/** The boot snapshot (undefined until applyConnectionOverrides has run). */
export function getConnSnapshot(): ConnSnapshot | undefined {
  return snapshot;
}
