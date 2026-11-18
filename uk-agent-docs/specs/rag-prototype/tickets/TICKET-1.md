# TICKET-1: Frontend + backend scaffolding + health API

Spec: [SPEC.md](../SPEC.md) sections 4, 5, 6, 8 (GET /health), 12

Status: done (2026-11-18)

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

## Implementation notes

- TypeScript is pinned to `~6.0` in both projects because typescript-eslint supports only `<6.1`.
- Backend entry is `src/index.ts` (built to `dist/index.js`); `createApp` in `src/app.ts` builds the Express app.
- Backend errors: throw `HttpError(status, code, message)` from `src/errors.ts`; the central handler maps it to the SPEC error shape. Unknown errors -> 500 `INTERNAL_ERROR`, bad JSON -> 400 `INVALID_JSON`, body over 1mb -> 413 `PAYLOAD_TOO_LARGE`, other 4xx body-parser errors -> same status with `BAD_REQUEST`, unknown route -> 404 `NOT_FOUND`.
- Backend env: all SPEC 12 vars are required except PORT (default 3000). `parseEnv` in `src/env.ts`.
- TOKEN_SECRET must be at least 32 chars (TOKEN_SECRET_MIN_CHARS). FRONTEND_ORIGIN is reduced to its origin (no path, no trailing slash) so CORS matches.
- Backend exits with code 1 on a listen error (e.g. port taken) and closes the server on SIGTERM/SIGINT.
- Both projects need Node >= 22.
- Frontend routes live in `src/routes.tsx`; `/login` has no nav; unknown routes redirect to `/`.
- Frontend `API_URL` comes from `src/config.ts` (throws if VITE_API_URL is missing). Vitest sets VITE_API_URL itself, so tests do not need a `.env`.
- ESLint `no-restricted-imports` blocks cross imports between the two projects.
- shadcn/ui: style `radix-nova`, alias `@/` -> `src/`.
