# TICKET-2: DB schema, infra config, CI

Spec: [SPEC.md](../SPEC.md) sections 4, 7, 12, 14

Status: done (2026-11-18)

Blocked by: TICKET-1
Blocks: TICKET-4, TICKET-5, TICKET-6, TICKET-7

## Scope

- `backend/migrations/0001_init.sql` (applied at backend startup, DECISIONS-1 D16):
  - `create extension if not exists vector` and `pgcrypto`.
  - `knowledge_base` table with all columns, checks, unique indexes (source_url, content_hash) and the (status, created_at) index from SPEC 7.
  - `modified_at` trigger.
  - `chunks` table with FK on delete cascade, plus an HNSW cosine index.
  - RLS enabled on both tables with no policies.
  - no job or search SQL functions; those queries live in the backend (DECISIONS-1 D15).
- `backend/src/db.ts`: a `pg` Pool built from DATABASE_URL (session pooler, SSL on), plus typed row types.
- `backend/src/queries.ts`: `claimJobs`, `resetStuckJobs`, `matchChunks` as plain SQL, exactly as SPEC 7 describes.
- `render.yaml`:
  - Node web service with `rootDir: backend`.
  - build installs bun, then runs `bun install --frozen-lockfile && bun run build`.
  - start command `node dist/index.js`.
  - health check path `/health`.
  - env var keys listed (values set in the dashboard).
- `frontend/vercel.json`: SPA rewrite to index.html. Document the Vercel settings (root `frontend`, install `bun install`, build `bun run build`, output `dist`).
- `.github/workflows/ci.yml`:
  - two separate jobs, `frontend` and `backend`, each with `working-directory` set to its folder.
  - each job sets up bun and Node, then runs install, typecheck, lint, test and build.
  - path filters so a job runs only when its folder (or the workflow file) changes.
- `README.md` at the root: local setup steps and the manual setup list from SPEC 14.

## Acceptance criteria

- The migration runs cleanly on a fresh Supabase project (applied by the backend at startup).
- `claimJobs` called from two sessions at the same time never returns the same row twice.
- `matchChunks` leaves out deleted items and items that are not READY.
- The CI workflow passes on the repo.
- render.yaml and the Vercel settings are documented and correct.

## Implementation notes

- Migration: `backend/migrations/0001_init.sql`.
  - `chunks` has `unique (item_id, chunk_index)`; it also serves as the item_id index for deletes and the FK cascade.
  - no job or search functions (only the `set_modified_at` trigger function); the `do` block revokes table privileges from `anon`/`authenticated` only when those roles exist (so it also runs on plain Postgres).
- `backend/src/queries.ts`:
  - `claimJobs(db, batch)` is one CTE statement with `for update skip locked`, returning rows ordered by created_at; `db` is a Pool or PoolClient.
  - all counts are checked as non-negative integers; matchChunks also checks for EMBEDDING_DIMS finite numbers.
  - `resetStuckJobs(db, stuckMinutes, maxRetries)` sets error_message 'Processing timed out' only when the row goes to FAILED; returns the updated rows.
  - `matchChunks(pool, embedding: number[], matchCount, minSimilarity)` sends the embedding as `JSON.stringify` + `::vector`; runs inside `withTransaction` with `set local hnsw.iterative_scan = strict_order; set local statement_timeout` (DB_QUERY_TIMEOUT_MS).
  - `hnsw.max_scan_tuples` stays at the pgvector default (20k), so a low-match query on a big corpus can scan up to 20k tuples.
  - `::vector` and `<=>` resolve through the role's search_path; on Supabase the `postgres` role includes `extensions`.
- `withTransaction(pool, work)` in `db.ts`: begin -> work(client) -> commit; on error it rolls back, and destroys the client only if the rollback fails. While checked out, the client has an `error` listener, so a dropped socket does not crash the process.
- `backend/src/db.ts`: `createPool(databaseUrl)`.
  - SSL is `{ rejectUnauthorized: false }` (Supabase cert is not checked). DATABASE_URL must not carry `sslmode`, since pg lets the URL override the `ssl` option.
  - `connectionTimeoutMillis` = DB_CONNECT_TIMEOUT_MS (10s, in constants.ts).
  - a pool `error` listener logs idle client errors so a dropped pooler connection does not crash the process.
  - Row types: `KnowledgeBaseRow`, `ChunkRow`, `MatchChunkRow` (snake_case, as pg returns them).
  - `index.ts` creates the pool, runs migrations, then listens; TICKET-4/5 pass the same pool to routes and the worker.
- DB tests: `backend/src/schema.e2e.test.ts` and `backend/src/queries.e2e.test.ts`, with shared setup in `src/test/testDb.ts` (createTestDb cleans up even if a migration fails; helpers insertNote, insertChunk, softDelete, embedding). They run only when `TEST_DATABASE_URL` is set. They create a temp database, apply the migrations with runMigrations (function), and drop it at the end. Test DB URLs carry `sslmode=disable`. CI runs them with a `pgvector/pgvector:pg17` service.
- `render.yaml`: free plan, region singapore (Supabase pooler is ap-southeast-1), `buildFilter` on `backend/**`, bun 1.4.4 via `npm install -g`, TOKEN_SECRET generated by Render, NODE_VERSION 24.
- `frontend/vercel.json`: framework vite, install/build/output commands, SPA rewrite.
- CI: a `changes` job (dorny/paths-filter) decides which of `frontend` / `backend` runs. Migrations live under `backend/**`, so they trigger the backend job. bun 1.4.4 and Node 24. Workflow permissions: `contents: read`.
- Migrations at startup: `backend/src/migrate.ts` runMigrations(pool) wraps node-pg-migrate `runner` (dir `backend/migrations`, resolved from the module so it works from `src` and `dist`; schema `migrations`, table `pgmigrations`, only `.sql` files via `ignorePattern`). `index.ts` runs it before `listen`; failure -> `Migrations failed:` plus the full error (stack) and exit 1. SIGTERM closes the server, then the pool.
  - `advisoryLockMode: "wait"` with `lock_timeout` = MIGRATION_LOCK_TIMEOUT_MS (30s): a second instance waits for the first instead of exiting; DDL never waits forever on locks.
  - the migration connection is always destroyed afterwards (`release(true)`), so its session settings, an aborted transaction or the advisory lock never return to the pool.
  - node-pg-migrate warn/error logs go to the console; info/debug are hidden.
  - SQL files have no up/down markers, so the whole file is the up migration and there is no down.
  - `createPool(databaseUrl)` no longer takes an `ssl` flag; local databases use `?sslmode=disable` in the URL (pg lets the URL override the `ssl` option).
  - `index.e2e.test.ts`: health and port-taken tests need TEST_DATABASE_URL; the missing-env and migrations-failed tests always run.
- Known gap left for TICKET-5: there is no claim token. If `resetStuckJobs` re-queues a job that is still running, two workers can process the same item.
