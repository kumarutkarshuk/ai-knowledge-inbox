# GLOSSARY-1

Product: AI Knowledge Inbox. A single-user app to save notes and URLs and ask questions answered only from them, with citations.

| Term | Meaning | Behaviour / example |
|---|---|---|
| Owner | The only user of the app | Logs in with APP_PASSWORD from the backend env. No signup. |
| Item | One saved thing: a Note or a URL item | One row in `knowledge_base`. |
| Note | Text typed by the owner, with an optional title | Max 50,000 chars. With no title, the title is the first 60 chars. |
| URL item | A saved web page link | Only text pages. Deep links inside the page are ignored. The content is fetched later by the worker. |
| Normalized URL | URL form used for dedupe | `HTTPS://Example.com/a/#x` -> `https://example.com/a` (lowercase scheme/host, no fragment, no trailing slash, query kept). |
| Content hash | sha256 of the trimmed note text | Used to find duplicate notes. `" hi "` and `"hi"` count as the same note. |
| Duplicate | A new item matching an existing one by normalized URL or content hash | Active match -> 409 "Already saved". Deleted match -> Restore. |
| Job | Processing work for one item | Every new item (Note or URL) starts as a job with status SUBMITTED. |
| Status | Item lifecycle | SUBMITTED -> PROCESSING -> READY, or FAILED after 3 retries. |
| SUBMITTED | Waiting in the queue | Picked up by the next worker run (within ~1 min). |
| PROCESSING | Claimed by the worker | Reset to SUBMITTED if stuck for over 10 min (counts as a retry). |
| READY | Chunks and embeddings stored | Searchable by Ask. |
| FAILED | Gave up after 3 retries (4 attempts) | error_message is shown in the Library. |
| Retry | Automatic re-queue after an error | retry_count + 1; at 4 failures the item becomes FAILED. No manual retry button. |
| Worker | node-cron task inside the backend process | Runs every 1 min, takes max 3 jobs, never overlaps itself. |
| Jina Reader | Service that turns a URL into clean text | `https://r.jina.ai/<url>`. Gives the title and content. Content is cut off at 200k chars. |
| Chunk | A piece of item text, 1000 chars with 200 overlap | Stored with a 1024-dim embedding in `chunks`. |
| Embedding | A vector from Jina `jina-embeddings-v3` | Passages and queries use different task types. |
| Similarity | Cosine similarity between a query and a chunk | Only chunks >= 0.5 are used; top 5. |
| Ask | A single-turn question on the `/` page | No history: every question is independent and nothing is stored. |
| Citation | A numbered reference to one chunk used in an answer | `[2]` in the answer -> card 2 with item title, URL, 300-char snippet and similarity. |
| Not found answer | Fixed reply when nothing matches | "Not found in your saved items." No LLM call when no chunk >= 0.5. |
| Soft delete | Hiding an item by setting deleted_at | Allowed only for READY/FAILED. Chunks are kept. Hidden from the list and from Ask. |
| Restore | Re-uploading a soft-deleted item | READY -> back instantly. FAILED -> back as SUBMITTED with retry_count 0. Old title kept. |
| Library | The `/library` page | Add a note/URL, see items and status, delete. Polls every 5s while jobs are pending. |
| Token | Login token (JWT) | Valid for 7 days, kept in localStorage. A 401 sends the user to /login. |
| Pinger | External cron-job.org job | Calls GET /health every 10 min so the Render free instance does not sleep. |
