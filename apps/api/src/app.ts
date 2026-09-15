import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';

export interface HealthResponse {
  status: 'ok';
  timestamp: string;
}

// Real chat pipeline wiring (validate → createPipeline → respond) lands here once
// packages/core/src/pipeline exists — see CLAUDE.md's request-lifecycle section.
export function buildHealthResponse(): HealthResponse {
  return { status: 'ok', timestamp: new Date().toISOString() };
}

export function buildApp(): Express {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json(buildHealthResponse());
  });

  return app;
}
