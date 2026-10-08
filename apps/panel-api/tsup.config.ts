import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['cjs'],
  target: 'node20',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // Bundle our TS workspace packages; keep node_modules libs external
  // (pino uses worker threads / dynamic require and must not be bundled).
  noExternal: [/@wootrico\//],
  external: [
    '@prisma/client',
    '.prisma/client',
    'argon2',
    'pino',
    'pino-pretty',
    'thread-stream',
    '@aws-sdk/client-s3',
    '@aws-sdk/s3-request-presigner',
  ],
});
