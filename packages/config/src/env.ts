import { z } from 'zod';

/**
 * Central environment schema, shared by panel-api and worker.
 * Parsed once and cached. Throws on first import if invalid.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().url(),
  RABBITMQ_URL: z.string().default('amqp://guest:guest@localhost:5672'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
  LICENSE_SERVER_URL: z.string().url().default('https://license.example.com'),
  // Optional external checkout URL opened when a customer chooses to buy a
  // paid license. The instanceId is registered with the license server
  // first (purchase intent); this is just where the buyer completes payment.
  LICENSE_CHECKOUT_URL: z.string().url().optional(),
  APP_VERSION: z.string().default('0.1.0'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),

  // 32 raw bytes, base64-encoded. Validated/decoded in crypto.ts.
  APP_ENCRYPTION_KEY: z.string().min(1, 'APP_ENCRYPTION_KEY is required'),

  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Lazily-evaluated env accessor. */
export const env: Env = new Proxy({} as Env, {
  get(_t, prop: string) {
    return loadEnv()[prop as keyof Env];
  },
});
