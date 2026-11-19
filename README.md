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
   - The Vercel URL is not known yet, so set `FRONTEND_ORIGIN` to a placeholder URL first (for example `https://example.com`). The backend exits at startup if it is empty.
4. Vercel (frontend)
   - New project from this repo with root directory `frontend`.
   - Install `bun install`, build `bun run build`, output `dist` (already set in `frontend/vercel.json`, which also rewrites all routes to `index.html`).
   - Set `VITE_API_URL` to the Render URL. It is fixed at build time, so redeploy the frontend after changing it.
   - Enable Analytics.
5. Set `FRONTEND_ORIGIN` on Render to the Vercel URL (for example `https://my-app.vercel.app`, no path). Redeploy the backend after changing it.
6. cron-job.org (keeps the free Render service awake)
   - Sign up at https://cron-job.org and click Create cronjob.
   - URL: `<render-url>/health`, method GET.
   - Schedule: every 10 minutes.
   - Save, then check the job history shows 200 responses.

## System design

| Decision                                                                                                                                                  | Trade-off                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Backend (Express + in-process cron worker) on Render, frontend on Vercel, cron-job.org pings `/health` every 10 min                                       | A free Render instance still cold-starts after a gap; the app shows a "waking up" hint                         |
| One Postgres (Supabase + pgvector) is both the store and the job queue: items start SUBMITTED, the worker claims 3 a minute with `FOR UPDATE SKIP LOCKED` | No extra queue service, but saved items take up to a minute to become searchable                               |
| Items table + separate chunks table with `vector(1024)` and an HNSW cosine index                                                                          | Changing the embedding model means a new column size and re-embedding everything                               |
| Jina for embeddings and URL text; Groq `gpt-oss-120b` streams answers over SSE                                                                            | Depends on two external APIs and their free quotas                                                             |
| Strict grounding: top 5 chunks with similarity >= 0.5 become numbered citations; no match returns "Not found" without calling the LLM                     | Never answers from general knowledge                                                                           |
| Each question is answered alone; the chat lives only in the browser (last 100 turns)                                                                      | Follow-up questions that need earlier context do not work; chat is lost on another browser                     |
| Dedupe by normalised URL or note hash; soft delete; re-saving restores the item                                                                           | Deleted chunks stay in the DB                                                                                  |
| Up to 3 automatic retries, stuck jobs reset after 10 min, then FAILED                                                                                     | No manual retry button                                                                                         |
| Single password + 7-day JWT in localStorage                                                                                                               | One user only; a stolen token works until it expires                                                           |
| Plain SQL with `pg` over the session pooler; queries live in backend code; migrations run at startup                                                      | A bad migration blocks the boot; migrations are forward-only and must stay compatible with the previous deploy |
| Saved content is treated as untrusted: chunks are wrapped as data in the prompt and answer images are never rendered                                      | Answers cannot show images                                                                                     |
| Two independent projects (`frontend/`, `backend/`), no shared package                                                                                     | API types are copied by hand and must be kept in sync                                                          |

## Deployed checks

Run these after both apps are deployed:

1. `curl <render-url>/health` returns `{"status":"ok"}`.
2. Open the Vercel URL, log in, save a note and a URL in Library, and wait until both are Ready.
3. Ask a question about the note. Sources show first, then the answer streams in word by word (not all at once at the end) with `[n]` chips.
4. Browser dev tools -> Network: no CORS errors on `/login`, `/items` or `/query`.
5. Ask something unrelated: "Not found in your saved items." and no Groq call in the Render logs.
6. Cold start: if a request takes over 5s, the app shows "The server is waking up. This can take up to a minute."
7. Pinger: the Render logs show a `/health` hit every 10 minutes and no spin-down over 1 hour.
