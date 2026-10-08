import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, '.env');
const example = join(root, '.env.example');

if (!existsSync(target)) {
  copyFileSync(example, target);
  console.log('Created .env from .env.example');
}
