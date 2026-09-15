import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import dotenv from 'dotenv';

// packages/eval sits one directory below the repo root (packages/eval/src/cli.ts is three
// levels below root), matching apps/api's env-loading convention in CLAUDE.md.
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });

export function buildProgram(): Command {
  const program = new Command();
  program.name('eval').description('Baseline vs. corrective RAG evaluation harness');

  // Two resumable phases per CLAUDE.md: `run` answers questions and saves traces,
  // `judge` sends saved answers to Gemini. Re-judging never re-runs the pipeline.
  program
    .command('run')
    .requiredOption('--config <name>', 'baseline, corrective, or corrective+cache')
    .requiredOption('--split <name>', 'dev or test')
    .action((options: { config: string; split: string }) => {
      // Real pipeline runner (packages/core's createPipeline, checkpointed per question)
      // lands here — this is Dhananjay's ownership per docs/workflow.md.
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
