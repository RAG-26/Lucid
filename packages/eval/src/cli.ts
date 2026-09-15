import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import dotenv from 'dotenv';

// Resolves to the repo-root .env regardless of the invocation's working directory.
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });

export function buildProgram(): Command {
  const program = new Command();
  program.name('eval').description('Baseline vs. corrective RAG evaluation harness');

  // run and judge are separate resumable phases — judging never re-runs the pipeline.
  program
    .command('run')
    .requiredOption('--config <name>', 'baseline, corrective, or corrective+cache')
    .requiredOption('--split <name>', 'dev or test')
    .action((options: { config: string; split: string }) => {
      // Real pipeline runner lands here — Dhananjay's ownership per docs/workflow.md.
      console.log(
        `eval run --config ${options.config} --split ${options.split}: not yet implemented`,
      );
    });

  program
    .command('judge')
    .requiredOption('--run <id>', 'run id to judge')
    .action((options: { run: string }) => {
      // Real Gemini judging lands here.
      console.log(`eval judge --run ${options.run}: not yet implemented`);
    });

  return program;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildProgram().parse(process.argv);
}
