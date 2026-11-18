# DECISIONS-1

Major, hard-to-reverse decisions. Newest last.

## D1: Backend on Render, frontend on Vercel (2026-11-17)
- Decision: the Express api plus its in-process cron runs on Render. The React app runs on Vercel with analytics. An external pinger (cron-job.org) hits GET /health every 10 min.
- Why: an in-process cron needs a long-running process. Vercel serverless cannot keep it alive, and Vercel Hobby cron runs only daily.
- Rejected: everything on Vercel with Vercel Cron; Supabase pg_cron + Edge Function; paid Render.

## D2: DB-polling queue for all items (2026-11-17)
- Decision: notes and URLs are both inserted as SUBMITTED and processed by the node-cron worker (every 1 min, 3 jobs per run, `FOR UPDATE SKIP LOCKED`).
- Why: one simple pipeline and no extra queue infra. The user enqueues and returns at once.
- Rejected: processing notes synchronously in /ingest.

## D3: Data model: knowledge_base + separate chunks table (2026-11-17)
- Decision: `knowledge_base` has type, source_url, title, raw_content, content_hash, status, error_message, retry_count and deleted_at. `chunks` has a vector(1024) column and an HNSW cosine index.
- Why: one row per item, many chunks per item; searching runs on chunks only.

## D4: Embeddings: Jina jina-embeddings-v3, 1024 dims (2026-11-17)
- Decision: fixed model and dimension.
- Why: part of the chosen stack. Changing it later means a new column size and re-embedding all chunks.

## D5: LLM: Groq llama-3.3-70b-versatile (2026-11-17)
- Decision: answers are streamed via Langchain ChatGroq.

## D6: URL extraction with Jina Reader (2026-11-17)
- Decision: `r.jina.ai` gives the clean text and title. Content is cut off at 200k chars.
- Rejected: fetch + Readability/Cheerio; Langchain web loaders.

## D7: Auth: single password + JWT (2026-11-17)
- Decision: APP_PASSWORD in the backend env. /login returns a JWT HS256 valid for 7 days, stored in localStorage.
- Rejected: no auth (exposes the API keys' quota); Supabase Auth (overkill for one user).

## D8: Single-turn Q&A, no history (2026-11-17)
- Decision: no chat history is stored or sent to the LLM.

## D9: Chunk-level citations, strict grounding (2026-11-17)
- Decision: each top-5 chunk (similarity >= 0.5) becomes a numbered citation. With no match, the fixed "Not found in your saved items." is returned and the LLM is not called.
- Rejected: item-level citations; falling back to general knowledge.

## D10: Dedupe + soft delete with restore (2026-11-17)
- Decision:
  - duplicates are detected by normalized URL or by the sha256 of the trimmed note.
  - an active duplicate gets 409.
  - delete is soft (deleted_at), allowed only for READY/FAILED, and chunks are kept.
  - re-upload restores the item: READY as it is; FAILED back to SUBMITTED with retry_count 0.
  - no trash UI.
- Rejected: hard delete; allowing duplicates; a trash view.

## D11: Retry policy (2026-11-17)
- Decision: auto-retry up to 3 times (4 attempts), then FAILED with error_message. PROCESSING for over 10 min is reset (counts as a retry). No manual retry button.

## D12: Monorepo + tooling (2026-11-17, updated 2026-11-18)
- Decision:
  - one repo with two independent projects, `frontend/` and `backend/`.
  - each has its own package.json, bun.lock and tooling.
  - no root workspace and no shared package.
  - API types are copied by hand into each project.
  - TypeScript everywhere. Bun is only the package manager; the backend runtime is Node.
- Why: the user wants the frontend and backend kept separate.
- Trade-off: the API types must be kept in sync by hand.
- Rejected: bun workspaces with a shared package (the 2026-11-17 version); npm workspaces; the Bun runtime on Render.

## D13: Size limits (2026-11-17)
- Decision: notes are max 50,000 chars (400 if longer). URL content is cut off at 200,000 chars. Queries are max 1,000 chars.

## D14: DB access with pg + session pooler, no service role key (2026-11-18)
- Decision:
  - the backend connects to Supabase Postgres with `pg` (node-postgres) using the session pooler connection string in DATABASE_URL (port 5432).
  - SQL functions are called with plain SQL, not supabase.rpc.
  - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are removed.
- Why: one env var, plain SQL. The session pooler works over IPv4 (Render) and supports prepared statements and `FOR UPDATE SKIP LOCKED`. The `postgres` role owns the tables, so RLS with no policies still blocks only the public REST API.
- Trade-off: no supabase-js helpers. Using Supabase Storage or Auth later would need the key again.
- Rejected: supabase-js with the service role key; the direct connection (IPv6 only); the transaction pooler (port 6543, no prepared statements).
