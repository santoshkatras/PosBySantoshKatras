const { execSync } = require('node:child_process');
const { resolve } = require('node:path');
const { config } = require('dotenv');

module.exports = function globalSetup() {
  const root = resolve(__dirname, '../../..');
  config({ path: resolve(root, '.env') });
  execSync('pnpm db:migrate', {
    cwd: resolve(__dirname, '..'),
    stdio: 'inherit',
    env: process.env,
  });
};
