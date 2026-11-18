# TICKET-2: DB schema, infra config, CI

Spec: [SPEC.md](../SPEC.md) sections 4, 7, 12, 14

Blocked by: TICKET-1
Blocks: TICKET-4, TICKET-5, TICKET-6, TICKET-7

## Scope

- `supabase/migrations/0001_init.sql`:
  - `create extension if not exists vector` and `pgcrypto`.
  - `knowledge_base` table with all columns, checks, unique indexes (source_url, content_hash) and the (status, created_at) index from SPEC 7.
  - `modified_at` trigger.
  - `chunks` table with FK on delete cascade, plus an HNSW cosine index.
  - RLS enabled on both tables with no policies.
  - functions `claim_jobs`, `reset_stuck_jobs`, `match_chunks` exactly as SPEC 7 describes.
- `backend/src/db.ts`: a Supabase client using the service role key, plus typed row types.
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

- The migration runs cleanly on a fresh Supabase project (or a local `supabase db reset`).
- `claim_jobs` called from two sessions at the same time never returns the same row twice.
- `match_chunks` leaves out deleted items and items that are not READY.
- The CI workflow passes on the repo.
- render.yaml and the Vercel settings are documented and correct.
