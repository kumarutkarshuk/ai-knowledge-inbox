# TICKET-5: Ingestion worker

Spec: [SPEC.md](../SPEC.md) sections 6, 7 (functions), 9, 13

Blocked by: TICKET-1, TICKET-2, TICKET-4
Blocks: TICKET-6, TICKET-7

## Scope

- `backend/src/worker/`:
  - node-cron schedule every 1 minute, started from `index.ts` after the server is listening.
  - in-memory `isRunning` guard.
  - each run: `reset_stuck_jobs(10, 3)` -> `claim_jobs(3)` -> process the jobs one at a time.
- `extractUrl(url)`: Jina Reader (`https://r.jina.ai/<url>`, `Accept: application/json`, Bearer JINA_API_KEY, 30s timeout). Returns `{ title, content }`, cuts content off at 200k chars, and throws on empty content or non-2xx.
- `chunkText(text)`: Langchain RecursiveCharacterTextSplitter (1000 / 200).
- `embedPassages(texts)` and `embedQuery(text)`: Jina `jina-embeddings-v3`, 1024 dims, tasks `retrieval.passage` / `retrieval.query`, passages in batches of 100. Put this in `backend/src/rag/embeddings.ts` (TICKET-6 reuses embedQuery).
- Per job: delete old chunks -> (URL: extract and save title + raw_content) -> chunk -> embed -> insert chunks -> READY.
- On error: retry_count + 1, short error_message; SUBMITTED if retry_count <= 3, else FAILED. Other jobs in the same run keep going.
- Structured console logs for each job (id, type, result, duration).

## Acceptance criteria

- A submitted note becomes READY within about 1 min, with the right number of chunks.
- A submitted URL becomes READY with title and raw_content filled from Jina Reader.
- An unreachable URL ends as FAILED after 4 attempts, with error_message set.
- A job left in PROCESSING (simulate by killing the process) is re-queued after 10 min.
- Re-processing an item does not create duplicate chunks.
- Unit tests for chunkText and the retry/status decision function (with Jina mocked).
