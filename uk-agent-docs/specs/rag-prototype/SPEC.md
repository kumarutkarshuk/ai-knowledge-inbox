# SPEC: AI Knowledge Inbox (RAG prototype)

Status: in progress, TICKET-1 and TICKET-2 done (2026-11-18)
Related: [GLOSSARY-1](../../glossary/GLOSSARY-1.md), [DECISIONS-1](../../decisions/DECISIONS-1.md)

## 1. Goal

A single-user web app where the user saves notes and URLs, then asks questions answered only from the saved content, with chunk-level citations. UI inspiration: Perplexity AI.

## 2. Functional requirements

- Save a note (text + optional title).
- Save a URL (text-based web page only).
- View saved items with their processing status and error message.
- Soft delete an item (only when status is READY or FAILED).
- Ask a single-turn question; get a streamed answer with chunk-level citations.
- Login with a single password.

## 3. Out of scope

- Chat history (not stored, not sent to LLM). Every question is independent.
- Multi-user, signup, roles.
- Following deep links inside a URL page.
- Non-text URLs (PDF, video, images).
- Trash view / restore button. Restore happens only by re-uploading.
- Editing items.

## 4. Tech stack

| Area | Choice |
|---|---|
| Repo | Monorepo with two independent projects, `frontend/` and `backend/`. Each has its own package.json, bun.lock, tsconfig and tooling. No root workspace, no shared package. Bun is the package manager only |
| Language | TypeScript everywhere |
| Frontend | React + Vite, TailwindCSS, shadcn/ui, react-router, react-markdown, @vercel/analytics |
| Backend | Node + Express (runtime is Node, not bun) |
| Scheduler | node-cron inside the backend process |
| DB | Supabase Postgres + pgvector, reached through the session pooler connection string (DATABASE_URL) with `pg` (node-postgres). No supabase-js, no service role key |
| RAG lib | Langchain (RecursiveCharacterTextSplitter, Jina embeddings, ChatGroq) |
| LLM | Groq `llama-3.3-70b-versatile` |
| Embeddings | Jina `jina-embeddings-v3`, 1024 dims (`retrieval.passage` for chunks, `retrieval.query` for queries) |
| URL extraction | Jina Reader API (`https://r.jina.ai/<url>`, JSON response) |
| Auth token | JWT HS256 (jsonwebtoken), 7 day expiry |
| Tests | vitest for pure logic |
| Hosting | Frontend: Vercel (with analytics). Backend: Render. Keep-alive: external pinger (cron-job.org) hits GET /health every 10 min |
| CI | GitHub Actions: install, typecheck, lint, test, build |

## 5. Repo layout

```
/
├── frontend/               # Vite React app (deployed to Vercel)
│   ├── package.json
│   ├── bun.lock
│   └── src/
│       ├── constants.ts    # only the constants the UI needs
│       └── types/api.ts    # copy of API contract types
├── backend/                # Express app + worker (deployed to Render)
│   ├── package.json
│   ├── bun.lock
│   ├── migrations/         # SQL migrations, applied at startup
│   └── src/
│       ├── constants.ts    # all constants from section 6
│       └── types/api.ts    # source of truth for API contract types
├── render.yaml             # rootDir: backend
├── README.md
└── .github/workflows/ci.yml # separate jobs for frontend and backend
```

- No root package.json. Commands run inside each folder.
- The two projects never import each other.
- API contract types (Item, Citation, ingest request, error shape, SSE events) live in `backend/src/types/api.ts`. They are copied by hand to `frontend/src/types/api.ts`, and any API change must update both files.

## 6. Constants

All of these live in `backend/src/constants.ts`. `frontend/src/constants.ts` copies only NOTE_MAX_CHARS, QUERY_MAX_CHARS, ITEMS_POLL_MS and NOT_FOUND_ANSWER.

| Name | Value |
|---|---|
| NOTE_MAX_CHARS | 50_000 |
| URL_CONTENT_MAX_CHARS | 200_000 (extra content is cut off, not an error) |
| NOTE_TITLE_FALLBACK_CHARS | 60 |
| QUERY_MAX_CHARS | 1_000 |
| CHUNK_SIZE / CHUNK_OVERLAP | 1000 / 200 chars |
| TOP_K | 5 |
| MIN_SIMILARITY | 0.5 (cosine similarity) |
| CRON_SCHEDULE | every 1 minute |
| JOBS_PER_RUN | 3 |
| MAX_RETRIES | 3 (so max 4 attempts in total) |
| STUCK_AFTER_MINUTES | 10 |
| TOKEN_TTL | 7 days |
| ITEMS_POLL_MS | 5000 (frontend, only while some item is SUBMITTED or PROCESSING) |
| NOT_FOUND_ANSWER | "Not found in your saved items." |

## 7. Data model

### knowledge_base

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | default gen_random_uuid() |
| type | text | 'NOTE' or 'URL' |
| source_url | text null | normalized URL; set only for URL |
| title | text null | note: user title or first 60 chars; URL: page title from Jina Reader |
| raw_content | text null | note: trimmed text at submit; URL: extracted text after processing |
| content_hash | text null | sha256 of trimmed note text; set only for NOTE |
| status | text | 'SUBMITTED', 'PROCESSING', 'FAILED', 'READY' |
| error_message | text null | last error, shown in UI |
| retry_count | int | default 0 |
| deleted_at | timestamptz null | soft delete marker |
| created_at | timestamptz | default now() |
| modified_at | timestamptz | default now(), updated by trigger on every update |

Constraints / indexes:
- unique index on source_url (all rows, including deleted ones)
- unique index on content_hash (all rows, including deleted ones)
- check: type = 'URL' -> source_url not null; type = 'NOTE' -> content_hash not null
- index on (status, created_at)

### chunks

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| item_id | uuid FK -> knowledge_base.id | on delete cascade |
| chunk_index | int | order within item |
| content | text | |
| embedding | vector(1024) | |
| created_at | timestamptz | |

- HNSW index on embedding with vector_cosine_ops.
- Chunks are kept when an item is soft deleted (so restore is instant).

### Job and search queries (backend, `backend/src/queries.ts`)

Plain SQL sent with `pg`. No job or search functions live in the database (see DECISIONS-1 D15); the only DB function is the `modified_at` trigger.

- `claimJobs(db, batch)`: one statement that atomically picks up to `batch` rows where status = 'SUBMITTED' and deleted_at is null, ordered by created_at, using `FOR UPDATE SKIP LOCKED`; sets status = 'PROCESSING'; returns the rows oldest first.
- `resetStuckJobs(db, stuckMinutes, maxRetries)`: rows with status 'PROCESSING' and modified_at older than `stuckMinutes` (DB clock) -> retry_count + 1; status 'SUBMITTED' if retry_count <= maxRetries, else 'FAILED' with error_message 'Processing timed out'.
- `matchChunks(pool, embedding, matchCount, minSimilarity)`: returns chunk id, item_id, content, similarity (1 - cosine distance) plus item type, title, source_url; only items with status 'READY' and deleted_at null; similarity >= minSimilarity; ordered by similarity desc; limit matchCount.
  - runs in a short transaction (`withTransaction` in `db.ts`) with `set local hnsw.iterative_scan = strict_order` (pgvector >= 0.8), so filtered-out chunks do not leave it with fewer than `matchCount` rows, and `set local statement_timeout` = DB_QUERY_TIMEOUT_MS (15s).
  - throws before querying if the embedding is not EMBEDDING_DIMS (1024) finite numbers.
- Counts (`batch`, `matchCount`, `stuckMinutes`, `maxRetries`) must be non-negative integers, else the function throws before querying.
- `db` is a pool or a checked-out client, so callers can run claimJobs inside their own transaction.

Migrations: SQL files in `backend/migrations/`, applied by node-pg-migrate at backend startup, before the server listens (see DECISIONS-1 D16). Applied files are recorded in `migrations.pgmigrations` (not in `public`, so the Supabase REST API does not expose it). If a migration fails, the backend exits with code 1.

Privileges: when the Supabase roles `anon` and `authenticated` exist, the migration revokes all table privileges from them.

Backend connects as the `postgres` role through DATABASE_URL (session pooler, port 5432). This role owns the tables, so RLS does not apply to it. RLS enabled on both tables with no policies, so the public Supabase REST API (anon/authenticated keys) cannot read or write them.

## 8. API

Base: backend on Render. All JSON. All routes except GET /health and POST /login need header `Authorization: Bearer <token>`. CORS allows only FRONTEND_ORIGIN.

Error shape: `{ "error": { "code": string, "message": string } }`

### GET /health
- 200 `{ "status": "ok" }`. No DB call (must be fast and cheap for the pinger).

### POST /login
- Body: `{ "password": string }`
- Timing-safe compare with APP_PASSWORD.
- 200 `{ "token": string, "expiresAt": string }`; 401 on wrong password.
- Rate limit: 5 requests per minute per IP.

### POST /ingest
- Body: `{ "type": "NOTE", "content": string, "title"?: string }` or `{ "type": "URL", "url": string }`
- Validation (400):
  - NOTE: trimmed content not empty, <= 50,000 chars; title (trimmed) <= 200 chars.
  - URL: must parse, protocol http or https.
- URL normalization: lowercase scheme and host, remove fragment (#...), remove trailing slash from path (except root "/"), keep query string.
  - Example: `HTTPS://Example.com/Blog/Post/#intro` -> `https://example.com/Blog/Post`
- Dedupe + restore logic (match by source_url for URL, content_hash for NOTE):
  - no match -> insert row with status SUBMITTED -> 201 with item.
  - match, deleted_at null -> 409 code `ALREADY_EXISTS`.
  - match, deleted_at not null -> set deleted_at null:
    - if status FAILED -> status SUBMITTED, retry_count 0, error_message null.
    - if status READY -> unchanged (no re-fetch, no re-embedding).
    - -> 200 with item.
  - restore keeps the old title (a new title in the request is ignored).
- Response returns quickly; processing happens in the worker.

### GET /items
- Returns non-deleted items, newest first.
- 200 `{ "items": Item[] }`
- Item: `{ id, type, title, sourceUrl, preview, status, errorMessage, createdAt }`
  - title fallback: URL not yet processed -> sourceUrl.
  - preview: NOTE -> first 200 chars of raw_content; URL -> null.

### DELETE /items/:id
- 404 if not found or already deleted.
- 409 code `ITEM_BUSY` if status is SUBMITTED or PROCESSING.
- Else set deleted_at = now() -> 204.

### POST /query (SSE)
- Body: `{ "query": string }`, trimmed, 1..1000 chars (400 otherwise, sent as normal JSON before the stream starts).
- Response: `Content-Type: text/event-stream`. Frontend reads it with fetch + ReadableStream (EventSource cannot POST).
- Steps:
  1. Embed query (Jina, task `retrieval.query`).
  2. `matchChunks(pool, embedding, 5, 0.5)`.
  3. If no rows: send `citations` with `[]`, then one `token` with NOT_FOUND_ANSWER, then `done`. Do not call the LLM.
  4. Else send `citations` first, then stream LLM tokens as `token` events, then `done`.
- Events:
  - `event: citations` data `Citation[]`
  - `event: token` data `{ "text": string }`
  - `event: done` data `{}`
  - `event: error` data `{ "message": string }` (then the stream closes)
- Citation: `{ n, itemId, type, title, sourceUrl, snippet, similarity }`
  - n is 1-based, matches the [n] markers in the answer.
  - snippet: chunk content, max 300 chars.
  - Each chunk is its own citation, even if two chunks come from the same item.
- Client disconnect -> stop the LLM stream (AbortController).
- Prompt rules for the LLM:
  - answer only from the given numbered context chunks.
  - cite with [n] markers after the claims they support.
  - if the context does not answer the question, reply exactly NOT_FOUND_ANSWER.
  - answer in markdown, keep it short.

## 9. Ingestion worker

Runs inside the backend process with node-cron, every 1 minute. Has an in-memory `isRunning` flag so runs never overlap.

Each run:
1. `resetStuckJobs(pool, 10, 3)`.
2. `claimJobs(pool, 3)`.
3. Process the claimed jobs one at a time:
   - URL:
     1. GET `https://r.jina.ai/<source_url>` with `Accept: application/json` and the Jina key; timeout 30s.
     2. Take `data.title` and `data.content`.
     3. Empty or whitespace-only content -> error "No text content found".
     4. Cut content off at 200,000 chars.
     5. Save raw_content and title.
   - NOTE: use raw_content as it is.
   - Delete any old chunks of this item (makes retries safe).
   - Split with RecursiveCharacterTextSplitter (1000 / 200).
   - Embed chunks with Jina (task `retrieval.passage`), in batches of up to 100.
   - Insert chunks.
   - Set status READY, error_message null.
4. On error for a job: retry_count + 1; error_message = short error text; status SUBMITTED if retry_count <= 3, else FAILED.
5. One failing job must not stop the other jobs in the same run.

## 10. Auth

- Backend env: APP_PASSWORD, TOKEN_SECRET.
- Token: JWT HS256 with payload `{ sub: "owner" }` and expiry of 7 days.
- Middleware checks the Bearer token. Missing, invalid or expired -> 401 `UNAUTHORIZED`.
- Frontend:
  - stores the token in localStorage.
  - every request adds the Authorization header.
  - on any 401 it clears the token and redirects to /login.
  - routes other than /login are guarded.

## 11. Frontend

Pages:
- `/login`: password field + submit; shows an error on 401 or 429.
- `/` (Ask), Perplexity-like:
  - a big centered question box; it moves to the bottom after the first question.
  - the answer streams in, rendered as markdown.
  - [n] markers become clickable chips that scroll to and highlight the citation card.
  - citation cards (shown above the answer, before tokens arrive) show title, URL link (for URL items), snippet and similarity.
  - shows the not-found answer as a muted message.
  - only one question is in flight; asking again replaces the old answer.
  - shows the stream error message.
- `/library`:
  - add form with tabs Note / URL. Note has an optional title and content with a live char count (max 50,000). URL has one input.
  - shows 409 "Already saved" and 400 validation messages.
  - items list: type icon, title, URL link or note preview, status badge, error message (FAILED), created time.
  - delete button only for READY and FAILED items, with a confirm dialog.
  - polls GET /items every 5s while any item is SUBMITTED or PROCESSING; stops otherwise.
- Nav: top bar with Ask, Library and Logout.
- Vercel Analytics component added at the root.
- Env: VITE_API_URL.

## 12. Environment variables

| App | Var |
|---|---|
| backend | PORT, FRONTEND_ORIGIN, DATABASE_URL, GROQ_API_KEY, JINA_API_KEY, APP_PASSWORD, TOKEN_SECRET |
| frontend | VITE_API_URL |

Both projects ship their own `.env.example`. The backend validates env vars at startup (zod) and exits with a clear message if one is missing.

## 13. Edge cases (must handle)

- Same URL with a different fragment or trailing slash -> same item (409).
- Same note text with extra outer whitespace -> same item (409).
- Re-upload of a deleted READY item -> restored instantly, no re-processing.
- Re-upload of a deleted FAILED item -> restored and re-queued with retry_count 0.
- Delete during SUBMITTED or PROCESSING -> 409 ITEM_BUSY.
- Jina Reader returns empty content, times out, or non-2xx -> retried, then FAILED with error_message.
- Server restart while processing -> the stuck reset brings the job back after 10 min.
- Two overlapping cron runs -> prevented by the isRunning flag and SKIP LOCKED.
- Very large page -> cut off at 200k chars, still READY.
- No chunk >= 0.5 similarity -> NOT_FOUND_ANSWER, no LLM call.
- Deleted items never show up in GET /items or in query results.
- Client closes the tab during streaming -> LLM call aborted.
- Expired token -> 401 -> frontend goes to /login.
- Render cold start (if the pinger misses) -> the frontend shows a loading state; requests may take ~1 min.

## 14. Manual setup by the user

- Create a Supabase project, enable pgvector, and copy the session pooler connection string (Connect -> Session pooler, port 5432) as DATABASE_URL.
- Get Groq and Jina API keys.
- Create a Render web service from render.yaml (root dir `backend`) and set the env vars.
- Create a Vercel project (root dir `frontend`), set VITE_API_URL, enable Analytics.
- Create a cron-job.org job: GET `<render-url>/health` every 10 min.

## 15. Tickets

| Ticket | Title | Blocked by | Blocks |
|---|---|---|---|
| [TICKET-1](tickets/TICKET-1.md) | Frontend + backend scaffolding + health API | - | 2, 3, 4, 5, 6, 7 |
| [TICKET-2](tickets/TICKET-2.md) | DB schema, infra config, CI | 1 | 4, 5, 6, 7 |
| [TICKET-3](tickets/TICKET-3.md) | Auth (login + guard) | 1 | 4, 6, 7 |
| [TICKET-4](tickets/TICKET-4.md) | Library: ingest, list, soft delete | 1, 2, 3 | 5, 7 |
| [TICKET-5](tickets/TICKET-5.md) | Ingestion worker | 1, 2, 4 | 6, 7 |
| [TICKET-6](tickets/TICKET-6.md) | Ask: query with SSE + citations | 1, 2, 3, 5 | 7 |
| [TICKET-7](tickets/TICKET-7.md) | Deployment + end-to-end check | 1-6 | - |
