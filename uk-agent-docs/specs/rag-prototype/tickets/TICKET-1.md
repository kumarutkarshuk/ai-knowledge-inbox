# TICKET-1: Frontend + backend scaffolding + health API

Spec: [SPEC.md](../SPEC.md) sections 4, 5, 6, 8 (GET /health), 12

Blocked by: none
Blocks: TICKET-2, TICKET-3, TICKET-4, TICKET-5, TICKET-6, TICKET-7

## Scope

- One repo with two independent projects, `frontend/` and `backend/`:
  - no root package.json, no workspaces, no shared package.
  - each has its own package.json, bun.lock, tsconfig (strict), ESLint, Prettier, `.env.example`.
  - each has the scripts `dev`, `build`, `typecheck`, `lint`, `test`.
- Root `.gitignore` covering node_modules, dist and .env in both folders.
- `backend/`:
  - Express + TypeScript, built with tsc to `dist/` and run with Node.
  - dev script with tsx watch.
  - env loading with zod validation (fail fast).
  - CORS for FRONTEND_ORIGIN, JSON body limit of 1mb, a central error handler that returns the SPEC error shape.
  - `GET /health` -> `{ status: "ok" }`.
  - `src/constants.ts` with all constants from SPEC 6.
  - `src/types/api.ts` with Item, Citation, the ingest request union, the error shape and SSE event types.
  - vitest set up.
- `frontend/`:
  - Vite + React + TypeScript, TailwindCSS, shadcn/ui init.
  - react-router with empty `/login`, `/` and `/library` pages, and a top nav shell.
  - the `@vercel/analytics` component and VITE_API_URL config.
  - `src/constants.ts` (only the UI constants from SPEC 6).
  - `src/types/api.ts` (copy of the backend file).
  - vitest set up.

## Acceptance criteria

- `bun install` works inside `frontend/` and inside `backend/`.
- `bun run dev` in each folder starts that app.
- `typecheck`, `lint`, `test` and `build` pass in both folders.
- `curl localhost:<PORT>/health` returns `{"status":"ok"}`.
- The backend exits with a clear message when a required env var is missing.
- The frontend renders the nav with Ask and Library routes.
- Neither project imports files from the other.
