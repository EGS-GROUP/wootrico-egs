import { pino, type Logger } from 'pino';

let base: Logger | undefined;

export function getLogger(): Logger {
  if (base) return base;
  const level = process.env.LOG_LEVEL ?? 'info';
  const isDev = (process.env.NODE_ENV ?? 'development') === 'development';
  base = pino({
    level,
    ...(isDev
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
        }
      : {}),
    redact: {
      paths: [
        'req.headers.authorization',
        'token',
        'api_token',
        'apiToken',
        'license_key',
        'licenseKey',
        'password',
        '*.token',
        '*.api_token',
        '*.password',
      ],
      censor: '[redacted]',
    },
  });
  return base;
}

export const logger = getLogger();
export type { Logger };
