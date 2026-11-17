import { existsSync } from 'node:fs';
import { createApp } from './app.js';
import { EnvError, parseEnv, type Env } from './env.js';

function loadEnv(): Env {
  if (existsSync('.env')) process.loadEnvFile('.env');
  try {
    return parseEnv(process.env);
  } catch (err) {
    if (!(err instanceof EnvError)) throw err;
    console.error(err.message);
    process.exit(1);
  }
}

const env = loadEnv();

const server = createApp({ frontendOrigin: env.FRONTEND_ORIGIN }).listen(env.PORT, () => {
  console.log(`api listening on port ${env.PORT}`);
});

server.on('error', (err) => {
  console.error(`api failed to start: ${err.message}`);
  process.exit(1);
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    console.log(`${signal} received, closing server`);
    server.close(() => process.exit(0));
  });
}
