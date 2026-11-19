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

## Design

The UI was redesigned with the [Hallmark](https://github.com/Nutlope/hallmark) skill (installed at project scope in `.claude/skills/hallmark`). Theme: Newsprint.

Decisions:

- Newspaper look: Zilla Slab heads, Spectral body, Libre Franklin for figures (dates, counts, match %). Fonts are self-hosted with `@fontsource`.
- Rules, not boxes: square corners, no shadows, hairlines between rows and a double rule under the nav.
- One brick accent, only for links, the current tab or nav item, citation numbers and the focus ring. Buttons are ink-filled.
- Ask: the answer reads in a 65ch column; its sources sit beside it as a ruled list (stacked above the answer under 1024px).
- Library: items are ruled rows (a ledger) instead of cards; status is plain text, not a caps badge.
- Light and dark modes share one token set (`frontend/src/tokens.css`); shadcn variables point at these tokens in `frontend/src/index.css`.

Trade-offs:

- Serif text is less dense than a sans UI, so lists show fewer items per screen.
- Three font families add about 100 KB of font files on first load.
- shadcn components were restyled in place (`components/ui/`), so pulling a newer shadcn version means re-applying the changes.
- The look is opinionated; a new theme means new tokens, not a class swap.

## Deployed checks

Run these after both apps are deployed:

1. `curl <render-url>/health` returns `{"status":"ok"}`.
2. Open the Vercel URL, log in, save a note and a URL in Library, and wait until both are Ready.
3. Ask a question about the note. Sources show first, then the answer streams in word by word (not all at once at the end) with `[n]` chips.
4. Browser dev tools -> Network: no CORS errors on `/login`, `/items` or `/query`.
5. Ask something unrelated: "Not found in your saved items." and no Groq call in the Render logs.
6. Cold start: if a request takes over 5s, the app shows "The server is waking up. This can take up to a minute."
7. Pinger: the Render logs show a `/health` hit every 10 minutes and no spin-down over 1 hour.
