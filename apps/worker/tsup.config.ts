import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['cjs'],
  target: 'node20',
  platform: 'node',
  clean: true,
  sourcemap: true,
  noExternal: [/@wootrico\//],
  external: [
    '@prisma/client',
    '.prisma/client',
    'pino',
    'pino-pretty',
    'thread-stream',
    '@aws-sdk/client-s3',
    '@aws-sdk/s3-request-presigner',
  ],
});
