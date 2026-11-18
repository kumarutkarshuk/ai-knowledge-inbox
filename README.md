# AI Knowledge Inbox

Save notes and URLs, then ask questions answered only from what you saved, with citations.

- `frontend/`: React + Vite app (Vercel)
- `backend/`: Express API + ingestion worker (Render)
- `backend/migrations/`: Postgres schema (pgvector), applied automatically when the backend starts

The two projects are independent. Run every command inside its own folder. Bun is the package manager; the backend runs on Node (>= 22).

## Local setup

1. Install [bun](https://bun.sh) and Node 22+.
2. Backend:
   ```sh
   cd backend
   bun install
   cp .env.example .env   # fill in the values
   bun run dev            # applies migrations, then http://localhost:3000/health
   ```
3. Frontend:
   ```sh
   cd frontend
   bun install
   cp .env.example .env   # VITE_API_URL=http://localhost:3000
   bun run dev            # http://localhost:5173
   ```
4. Checks (in each folder): `bun run typecheck`, `bun run lint`, `bun run test`, `bun run build`.

### Database tests

The backend DB tests run only when `TEST_DATABASE_URL` is set. They create a fresh database, apply every file in `backend/migrations/` (same runner as the server), run the tests and drop the database.

```sh
docker run -d --name aki-pg -e POSTGRES_PASSWORD=postgres -p 54329:5432 pgvector/pgvector:pg17
cd backend
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:54329/postgres bun run test
```

CI runs them against the same image.

For a local (non-Supabase) database, add `?sslmode=disable` to `DATABASE_URL`.

## Manual setup

1. Supabase
   - Create a project.
   - Database -> Extensions: enable `vector`.
   - Connect -> Session pooler (port 5432): copy the connection string as `DATABASE_URL` (no `sslmode` param; the backend turns SSL on itself).
   - Migrations run on their own: the backend applies any new file in `backend/migrations/` at startup, before it starts listening, and records it in `migrations.pgmigrations`.
2. API keys: get a Groq key (`GROQ_API_KEY`) and a Jina key (`JINA_API_KEY`).
3. Render (backend)
   - New -> Blueprint -> pick this repo; it reads `render.yaml` (root dir `backend`, health check `/health`).
   - Set `FRONTEND_ORIGIN`, `DATABASE_URL`, `GROQ_API_KEY`, `JINA_API_KEY`, `APP_PASSWORD`. `TOKEN_SECRET` is generated; `PORT` is set by Render.
4. Vercel (frontend)
   - New project from this repo with root directory `frontend`.
   - Install `bun install`, build `bun run build`, output `dist` (already set in `frontend/vercel.json`, which also rewrites all routes to `index.html`).
   - Set `VITE_API_URL` to the Render URL.
   - Enable Analytics.
5. cron-job.org: create a job that sends GET `<render-url>/health` every 10 minutes.
