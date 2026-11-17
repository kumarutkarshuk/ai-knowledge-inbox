# TICKET-6: Ask: query with SSE + citations

Spec: [SPEC.md](../SPEC.md) sections 8 (POST /query), 11 (/), 13

Blocked by: TICKET-1, TICKET-2, TICKET-3, TICKET-5
Blocks: TICKET-7

## Scope

Backend:
- `POST /query`:
  - validate the query (trimmed, 1..1000 chars) -> 400 JSON before the stream starts.
  - set SSE headers (`text/event-stream`, `no-cache`, `X-Accel-Buffering: no`) and flush them.
  - `embedQuery` -> `match_chunks(emb, 5, 0.5)`.
  - no rows: `citations []` -> `token` NOT_FOUND_ANSWER -> `done`, with no LLM call.
  - else: `citations` (n, itemId, type, title, sourceUrl, 300-char snippet, similarity) -> stream ChatGroq (`llama-3.3-70b-versatile`, temperature 0.2) tokens as `token` events -> `done`.
  - prompt template with numbered context chunks and the SPEC 8 rules.
  - AbortController tied to `req.on('close')`.
  - errors after the stream starts -> `error` event, then end.
- SSE event writer helper using the shared event types.

Frontend (`/`):
- Perplexity-like layout: a centered question box that moves to the bottom after the first question.
- fetch + ReadableStream SSE parser (POST), using the apiClient auth header and the 401 handling.
- Citation cards render as soon as the `citations` event arrives.
- The answer streams in as markdown (react-markdown); `[n]` becomes a clickable chip that scrolls to and highlights card n.
- The not-found answer is shown muted. Show a loading state, the error state, and a cancel when a new question is asked.

Tests: SSE parser (split chunks, multiple events in one chunk), citation mapping.

## Acceptance criteria

- A question about a saved note returns a streamed answer with correct [n] markers and matching cards.
- A question with no related content returns "Not found in your saved items." and makes no Groq call (check the logs).
- A deleted item's content is never cited.
- Closing the tab mid-stream aborts the Groq request.
- A query longer than 1000 chars gets 400.
