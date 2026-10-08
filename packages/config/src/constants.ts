/** Shared constants across apps and packages. */

/**
 * Version of THIS build, surfaced by GET /api/system/info.
 *
 * Every instance pulls the same `:latest` image, so without this there is no way
 * to tell which code a given customer is running short of comparing image dates.
 * Bump it in the same commit that gets tagged, and keep it equal to the Docker
 * tag that is published (`ericoautomacao/wootrico-v2:<APP_VERSION>`).
 */
export const APP_VERSION = '0.2.2';

export const PROVIDER_TYPES = ['evolution', 'uazapi', 'zapi'] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

export const MESSAGE_TYPES = ['text', 'image', 'audio', 'video', 'document'] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export const CONVERSATION_STATUSES = ['open', 'resolved', 'pending'] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const LICENSE_STATUSES = ['unactivated', 'active', 'warning', 'blocked'] as const;
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];

// 'trial' = free time-limited key (auto-issued at signup, expires after the
// trial window); 'paid' = bought/granted key with an expiry (default 1 year,
// renewable). Neither plan is ever lifetime — every key always has an expiry.
export const LICENSE_PLANS = ['trial', 'paid'] as const;
export type LicensePlan = (typeof LICENSE_PLANS)[number];

/** RabbitMQ topology names. */
export const AMQP = {
  exchange: 'wootrico', // direct
  retryExchange: 'wootrico.retry', // fanout -> retry queue
  dlxExchange: 'wootrico.dlx', // fanout -> dead queue
  queues: {
    inbound: 'wootrico.inbound',
    callback: 'wootrico.callback',
    retry: 'wootrico.retry.q',
    dead: 'wootrico.dead',
  },
  routingKeys: {
    inbound: 'inbound',
    callback: 'callback',
  },
  retryTtlMs: 10_000,
  maxRetries: 5,
} as const;

/**
 * License timing (instance side). Validation is online. An unreachable server is
 * tolerated for a grace window (so real outages — or a wrong server URL — don't
 * instantly kill a valid key), but NOT forever: after `offlineGraceMs` without a
 * single successful check the instance blocks. This stops the abuse of
 * validating once and then cutting the connection to run free. The block is
 * RECOVERABLE — the next successful "active" answer restores it. An explicit
 * "inactive" from the server blocks immediately.
 */
export const LICENSE = {
  // How often the instance re-checks "is my key still active?" with the server.
  validateIntervalMs: 6 * 60 * 60 * 1000, // 6h
  // Random spread (±ratio) on the next check so instances don't all phone home
  // at the same instant — avoids thundering-herd load on the vendor server.
  validateJitterRatio: 0.1, // ±10%
  // On consecutive failures the wait doubles (6h → 12h → 24h), capped here, so a
  // prolonged outage or misconfig doesn't hammer the server.
  validateBackoffMaxMs: 24 * 60 * 60 * 1000, // 24h
  // Stale-but-tolerated: past this without a SUCCESSFUL validation the panel
  // shows a soft "couldn't reach the license server" warning (still processing).
  staleWarningMs: 24 * 60 * 60 * 1000, // 24h
  // Hard offline deadline: past this without ANY successful validation the
  // instance blocks (recoverable once the server answers again).
  offlineGraceMs: 48 * 60 * 60 * 1000, // 48h
  // Worker cadence for *checking whether* a validation is due (cheap, no network
  // unless nextHeartbeatAt has passed).
  heartbeatTickMs: 30 * 60 * 1000, // 30 min
} as const;

/** TTLs for cleanup sweeps. */
export const TTL = {
  messageMappingDays: 30,
  dedupTicketMinutes: 10,
  webhookEventDays: 14,
} as const;
