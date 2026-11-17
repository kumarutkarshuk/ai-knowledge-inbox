# TICKET-7: Deployment + end-to-end check

Spec: [SPEC.md](../SPEC.md) sections 12, 13, 14

Blocked by: TICKET-1, TICKET-2, TICKET-3, TICKET-4, TICKET-5, TICKET-6
Blocks: none

## Scope

- Check that the render.yaml build/start works on Render and the Vercel build works for apps/web (the user does the dashboard steps from SPEC 14).
- Check that CORS works between the Vercel origin and the Render API.
- Check that SSE streams through Render without buffering (tokens arrive one by one, not all at the end).
- Frontend: a cold-start friendly loading state and a "server waking up" hint when a request takes over 5s.
- Run the full edge case list from SPEC 13 against the deployed app and record the results in this ticket.
- Update the README with the deployed setup steps and the cron-job.org pinger setup.

## Acceptance criteria

- The deployed app does login -> save note + URL -> both READY -> ask -> streamed answer with citations.
- The pinger keeps /health warm (no sleep seen over 1 hour).
- Every edge case in SPEC 13 is checked or marked with a reason.
