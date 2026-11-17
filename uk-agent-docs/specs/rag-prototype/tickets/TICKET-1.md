# TICKET-1: Monorepo scaffolding + health API

Spec: [SPEC.md](../SPEC.md) sections 4, 5, 6, 8 (GET /health), 12

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
