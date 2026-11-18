# TICKET-4: Library: ingest, list, soft delete

Spec: [SPEC.md](../SPEC.md) sections 7, 8 (POST /ingest, GET /items, DELETE /items/:id), 11 (/library), 13

Status: done (2026-11-18)

Blocked by: TICKET-1, TICKET-2, TICKET-3
Blocks: TICKET-5, TICKET-7

## Scope

Backend:
- `normalizeUrl(url)` and `hashNote(content)` pure functions with unit tests.
- `POST /ingest`:
  - zod validation.
  - dedupe + restore logic exactly as SPEC 8. Restoring a FAILED item resets status to SUBMITTED, retry_count to 0 and error_message to null.
  - handle a race on the unique index (Postgres error 23505) as 409 ALREADY_EXISTS.
  - NOTE title = trimmed user title, else the first 60 chars of the trimmed content.
- `GET /items`: non-deleted items, newest first, mapped to the `Item` type in `backend/src/types/api.ts` (title fallback, 200-char note preview).
- `DELETE /items/:id`:
  - 404 if missing or already deleted.
  - 409 ITEM_BUSY if SUBMITTED or PROCESSING.
  - else soft delete -> 204.

Frontend (`/library`):
- Add form with Note / URL tabs; the note shows a live char count (max 50,000).
- Show messages for 409 ("Already saved") and 400.
- Items list with type icon, title, link or preview, status badge, error message and created time.
- Delete button only for READY and FAILED items, with a confirm dialog.
- Poll every 5s only while some item is SUBMITTED or PROCESSING.
- Empty state.

## Acceptance criteria

- `https://Example.com/a/#x` and `https://example.com/a` count as the same item (the second one gets 409).
- A note sent again with extra whitespace gets 409.
- Delete of a READY item then re-upload -> 200; the item comes back as READY.
- Delete of a FAILED item then re-upload -> 200; the item comes back as SUBMITTED with retry_count 0.
- Deleting a SUBMITTED item gets 409.
- A 50,001-char note gets 400. A `ftp://` URL gets 400.
- Unit tests cover normalizeUrl, hashNote and the restore decision logic.
- With a tampered token in localStorage (`session` key), opening /library gets 401 from GET /items and lands on /login.
