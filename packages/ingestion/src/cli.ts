import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import dotenv from 'dotenv';

// Resolves to the repo-root .env regardless of the invocation's working directory.
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('ingest')
    .description('Load pinned docs → clean Hugo markdown → chunk → embed locally → upsert');

  program
    .requiredOption('--corpus <name>', 'corpus to ingest (kubernetes or docker)')
    .action((options: { corpus: string }) => {
      // Real ingestion lands here — Navnita's ownership per docs/workflow.md.
      console.log(`ingest --corpus ${options.corpus}: not yet implemented`);
    });

  return program;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildProgram().parse(process.argv);
}
