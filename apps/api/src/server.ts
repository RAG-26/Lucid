import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// apps/api sits one directory below the repo root, so this path is the same for every
// package at that depth (see CLAUDE.md's env-loading convention).
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });

const { buildApp } = await import('./app.js');

const port = Number(process.env.API_PORT ?? 8080);
buildApp().listen(port, () => {
  console.log(`@lucid/api listening on port ${port}`);
});
