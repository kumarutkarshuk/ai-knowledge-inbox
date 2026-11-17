# TICKET-1: Monorepo scaffolding + health API

Spec: [SPEC.md](../SPEC.md) sections 4, 5, 6, 8 (GET /health), 12

Status: done (2026-11-17)

Blocked by: none
Blocks: TICKET-2, TICKET-3, TICKET-4, TICKET-5, TICKET-6, TICKET-7

## Scope

- Root `package.json` with bun workspaces (`apps/*`, `packages/*`) and root scripts: `dev`, `build`, `typecheck`, `lint`, `test`.
- Shared TS config (`tsconfig.base.json`, strict mode). Set up ESLint and Prettier.
- `packages/shared`: all constants from SPEC section 6, plus API types (Item, Citation, the ingest request union, the error shape, SSE event types).
- `apps/api`:
  - Express + TypeScript, built with tsc to `dist/` and run with Node.
  - env loading with zod validation (fail fast).
  - CORS for FRONTEND_ORIGIN, JSON body limit of 1mb, a central error handler that returns the SPEC error shape.
  - `GET /health` -> `{ status: "ok" }`.
  - dev script with tsx watch.
- `apps/web`:
  - Vite + React + TypeScript, TailwindCSS, shadcn/ui init, react-router with empty `/login`, `/` and `/library` pages.
  - a top nav shell, the `@vercel/analytics` component, and VITE_API_URL config.
- `.env.example` in both apps. A `.gitignore` covering node_modules, dist and .env.
- vitest set up in api and shared.

## Acceptance criteria

- `bun install` works from the root.
- `bun run dev` starts both apps.
- `bun run typecheck`, `lint`, `test` and `build` all pass.
- `curl localhost:<PORT>/health` returns `{"status":"ok"}`.
- The api exits with a clear message when a required env var is missing.
- The web app renders the nav with Ask and Library routes.

## Implementation notes (for later tickets)

- TypeScript is pinned to ~6.0 because typescript-eslint does not support TS 7 yet.
- bun uses the isolated linker: each workspace has its own `node_modules`.
- `@aki/shared` exports a `source` condition pointing to `src`:
  - tsc typecheck uses it via `customConditions`.
  - api dev runs `tsx watch --conditions=source`.
  - vite and vitest use an alias to `packages/shared/src/index.ts`.
  - api build (`tsconfig.build.json`) uses `dist`, so shared must be built first. Root `build` does this; render.yaml must too.
- api loads `.env` from the current folder (`apps/api` when run by scripts). Existing env vars win.
- api error codes live in `ERROR_CODES` (shared). Throw `HttpError(status, code, message)`; the central `errorHandler` formats it.
- api handles SIGTERM/SIGINT by closing the server.
- Web: `API_URL` from `src/lib/config.ts` throws at import if VITE_API_URL is missing. Routes are in `src/routes.tsx`; `/` and `/library` sit inside `AppShell`; unknown paths redirect to `/`.
- ESLint has type-aware `no-floating-promises` and `no-misused-promises`.
