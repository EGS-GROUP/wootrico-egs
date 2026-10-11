import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const resolvePaths = [
  process.cwd(),
  path.resolve(process.cwd(), 'packages/db'),
  path.resolve(process.cwd(), '..'),
];

let prismaBin;
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
  console.error('[deploy-migrations] Could not locate Prisma CLI or schema.prisma!');
  console.error('prismaBin:', prismaBin);
  console.error('schemaPath:', schemaPath);
  process.exit(1);
}

console.log(`[deploy-migrations] Applying migrations using schema: ${schemaPath}...`);
try {
  const out = execFileSync(process.execPath, [prismaBin, 'migrate', 'deploy', `--schema=${schemaPath}`], {
    encoding: 'utf8',
    env: process.env,
    stdio: 'inherit',
  });
  console.log('[deploy-migrations] Migrations applied successfully.');
} catch (err) {
  console.error('[deploy-migrations] Error applying migrations:', err.message);
  process.exit(1);
}
