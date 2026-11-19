# TICKET-7: Deployment + end-to-end check

Spec: [SPEC.md](../SPEC.md) sections 12, 13, 14

Status: code done (2026-11-19); deployed checks pending (the user runs them)

Blocked by: TICKET-1, TICKET-2, TICKET-3, TICKET-4, TICKET-5, TICKET-6
Blocks: none

## Scope

- Check that the render.yaml build/start works on Render and the Vercel build works for `frontend/` (the user does the dashboard steps from SPEC 14).
- Check that CORS works between the Vercel origin and the Render API.
- Check that SSE streams through Render without buffering (tokens arrive one by one, not all at the end).
- Frontend: a cold-start friendly loading state and a "server waking up" hint when a request takes over 5s.
- Run the full edge case list from SPEC 13 against the deployed app and record the results in this ticket.
- Update the README with the deployed setup steps and the cron-job.org pinger setup.

## Acceptance criteria

- The deployed app does login -> save note + URL -> both READY -> ask -> streamed answer with citations.
- The pinger keeps /health warm (no sleep seen over 1 hour).
- Every edge case in SPEC 13 is checked or marked with a reason.

## Done in code (2026-11-19)

- `apiFetch` wraps `fetch` in `trackSlow` (`lib/serverWaking.ts`). A request still waiting for response headers after `SLOW_REQUEST_MS` (5s) counts as slow.
- A root route (`components/Root.tsx`) shows the hint "The server may be waking up. This can take up to a minute." (role status, fixed below the nav) on every page, login included, while any request is slow. It hides when the last slow request ends (success or failure).
- A long SSE stream does not show the hint: only the wait for headers counts, and `/query` flushes headers at once.
- Page loading states stay as they are ("Logging in...", "Loading...", "Searching your saved items...").
- CORS preflight test for POST /query with `authorization,content-type` headers.
- `openSse` header test without a DB (`sse.test.ts`), so CI always checks `X-Accel-Buffering: no`.
- README: deployed setup checks and cron-job.org pinger steps.

## SPEC 13 edge case results

Local: covered by automated tests. Deployed: to be filled by the user after the deployed run.

| Edge case | Local | Deployed |
|---|---|---|
| Same URL, different fragment or trailing slash -> 409 | `routes/items.e2e.test.ts` | pending |
| Same note with extra outer whitespace -> 409 | `routes/items.e2e.test.ts` | pending |
| Re-upload of a deleted READY item -> restored, no re-processing | `ingest.test.ts`, `routes/items.e2e.test.ts` | pending |
| Re-upload of a deleted FAILED item -> re-queued, retry_count 0 | `ingest.test.ts`, `queries.e2e.test.ts` | pending |
| Delete during SUBMITTED/PROCESSING -> 409 ITEM_BUSY | `routes/items.e2e.test.ts` | pending |
| Jina Reader empty / timeout / non-2xx -> retried, then FAILED | `worker/extract.test.ts`, `worker/jobs.e2e.test.ts` | pending |
| Server restart while processing -> stuck reset after 10 min | `queries.e2e.test.ts`, `worker/jobs.e2e.test.ts` | pending (hard to force on Render; local test only) |
| Two overlapping cron runs -> run guard + SKIP LOCKED | `worker/jobs.e2e.test.ts` | pending (local test only) |
| Very large page -> cut at 200k chars, READY | `worker/jobs.e2e.test.ts` | pending |
| No chunk >= 0.5 -> NOT_FOUND_ANSWER, no LLM call | `routes/query.e2e.test.ts` | pending (check Render logs) |
| Deleted items never in GET /items or query results | `queries.e2e.test.ts`, `routes/query.e2e.test.ts` | pending |
| Tab closed during streaming -> LLM call aborted | `routes/query.e2e.test.ts` | pending (check Render logs) |
| Expired token -> 401 -> /login | `lib/apiClient.test.ts`, `routes.test.tsx` | pending |
| Render cold start -> loading state + waking hint | `serverWaking.test.tsx`, `lib/serverWaking.test.ts` | pending (open the app after 15+ min idle with the pinger paused) |
