import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Resolves to the repo-root .env regardless of the invocation's working directory.
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });

const { buildApp } = await import('./app.js');

const port = Number(process.env.API_PORT ?? 8080);
buildApp().listen(port, () => {
  console.log(`@lucid/api listening on port ${port}`);
});
