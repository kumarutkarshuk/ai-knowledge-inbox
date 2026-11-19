import dotenv from "dotenv";
import { createApp } from "./app.js";
import { createPool } from "./db.js";
import { EnvError, parseEnv, type Env } from "./env.js";
import { runMigrations } from "./migrate.js";
import { startWorker } from "./worker/index.js";

dotenv.config({ quiet: true });

let env: Env;
try {
  env = parseEnv(process.env);
} catch (err) {
  if (!(err instanceof EnvError)) throw err;
  console.error(err.message);
  process.exit(1);
}

const pool = createPool(env.DATABASE_URL);
try {
  const applied = await runMigrations(pool);
  console.log(`Migrations applied: ${applied.length ? applied.join(", ") : "none"}`);
} catch (err) {
  console.error("Migrations failed:", err);
  process.exit(1);
}

let worker: ReturnType<typeof startWorker> | undefined;

const server = createApp(env, pool).listen(env.PORT, () => {
  worker = startWorker(pool, env.JINA_API_KEY);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : env.PORT;
  console.log(`Backend listening on port ${port}`);
});

server.on("error", (err) => {
  console.error(`Server failed to start: ${err.message}`);
  process.exit(1);
});

let shuttingDown = false;

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received, shutting down`);
    const workerStopped = Promise.resolve(worker?.stop()).catch((err) =>
      console.error("Worker stop failed:", err),
    );
    server.close(() => {
      workerStopped.finally(() => pool.end().finally(() => process.exit(0)));
    });
  });
}
