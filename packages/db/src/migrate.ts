import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

export async function runMigrations(): Promise<void> {
  let prismaBin: string | undefined;

  const resolvePaths = [
    process.cwd(),
    path.resolve(process.cwd(), 'packages/db'),
    path.resolve(process.cwd(), '..'),
  ];

  try {
    const requireFn = createRequire(path.join(process.cwd(), 'dummy.js'));
    const prismaPkg = requireFn.resolve('prisma/package.json', { paths: resolvePaths });
    prismaBin = path.join(path.dirname(prismaPkg), 'build', 'index.js');
  } catch {
    const directCandidates = [
      path.resolve(process.cwd(), 'node_modules/prisma/build/index.js'),
      path.resolve(process.cwd(), 'packages/db/node_modules/prisma/build/index.js'),
    ];
    prismaBin = directCandidates.find((p) => fs.existsSync(p));
  }

  const schemaCandidates = [
    path.resolve(process.cwd(), 'packages/db/prisma/schema.prisma'),
    path.resolve(process.cwd(), '../packages/db/prisma/schema.prisma'),
    path.resolve(process.cwd(), 'prisma/schema.prisma'),
  ];
  const schemaPath = schemaCandidates.find((p) => fs.existsSync(p));

  if (!prismaBin || !schemaPath) {
    console.warn('[db:migrate] Prisma binary or schema.prisma not found; skipping automatic migration.');
    return;
  }

  console.log(`[db:migrate] Deploying database migrations with schema: ${schemaPath}...`);
  try {
    const out = execFileSync(process.execPath, [prismaBin, 'migrate', 'deploy', `--schema=${schemaPath}`], {
      encoding: 'utf8',
      env: process.env,
      stdio: 'pipe',
    });
    console.log(`[db:migrate] Migration result:\n${out.trim()}`);
  } catch (err: unknown) {
    console.error('[db:migrate] Migration deploy failed:', err);
    throw err;
  }
}
