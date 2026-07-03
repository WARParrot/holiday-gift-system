import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

/**
 * Load environment variables from a `.env` file into `process.env` **before**
 * any other module reads config. Import this module first (a bare
 * `import './env.js'`) at every process entry point (index.ts, migrate.ts).
 *
 * Why an explicit loader rather than `dotenv/config` or Node's `--env-file`:
 *  - it resolves `.env` relative to the SERVER ROOT (one level up from this
 *    compiled file's dir), so it works no matter what cwd the process is
 *    launched from — important on Windows where people start from Explorer,
 *    a shortcut, or a service wrapper with an arbitrary working directory;
 *  - it behaves identically under `tsx` (dev) and `node dist` (prod);
 *  - `DOTENV_CONFIG_PATH` can override the location if needed.
 *
 * Precedence: real environment variables already set by the OS/shell/service
 * WIN over the file (dotenv never overrides an existing `process.env` key), so
 * a `.env` is a convenient default, not a way to clobber production config.
 */

// This file lives at <root>/src/env.ts (dev) or <root>/dist/env.js (prod);
// either way its parent dir's parent is the server root.
const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');

const envPath = process.env.DOTENV_CONFIG_PATH || path.join(serverRoot, '.env');

if (fs.existsSync(envPath)) {
  const result = dotenv.config({ path: envPath });
  if (result.error) {
    // eslint-disable-next-line no-console
    console.warn(`[env] failed to parse ${envPath}: ${result.error.message}`);
  } else {
    // eslint-disable-next-line no-console
    console.log(`[env] loaded environment from ${envPath}`);
  }
}
