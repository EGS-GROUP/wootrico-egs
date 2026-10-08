import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['cjs'],
  target: 'node20',
  platform: 'node',
  clean: true,
  sourcemap: true,
  external: ['@prisma/client', '.prisma/client', 'pino', 'pino-pretty', 'thread-stream'],
});
