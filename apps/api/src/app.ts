import cors from 'cors';
import express from 'express';
import { errorHandler, notFoundHandler } from './errors.js';
import { healthRouter } from './routes/health.js';

export interface AppOptions {
  frontendOrigin: string;
}

export function createApp({ frontendOrigin }: AppOptions) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: [frontendOrigin], maxAge: 600 }));
  app.use(express.json({ limit: '1mb' }));
  app.use(healthRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
