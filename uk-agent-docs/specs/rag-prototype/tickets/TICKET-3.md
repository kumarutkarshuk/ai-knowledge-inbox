# TICKET-3: Auth (login + guard)

Spec: [SPEC.md](../SPEC.md) sections 8 (POST /login), 10, 11 (/login)

Blocked by: TICKET-1
Blocks: TICKET-4, TICKET-6, TICKET-7

## Scope

Backend:
- `POST /login`:
  - timing-safe compare with APP_PASSWORD.
  - returns a JWT HS256 (`sub: "owner"`, 7 day expiry) and `expiresAt`.
  - express-rate-limit: 5/min per IP; returns 429.
  - set `trust proxy` (Render runs behind a proxy).
- `requireAuth` middleware for Bearer tokens; 401 `UNAUTHORIZED` on a missing, invalid or expired token.
- Apply it to every route except `/health` and `/login`.

Frontend:
- `/login` page (shadcn form) with errors for 401 and 429.
- Token stored in localStorage.
- `apiClient` wrapper:
  - adds the Authorization header.
  - parses the error shape.
  - on 401 it clears the token and redirects to `/login`.
- Route guard for `/` and `/library`.
- Logout in the nav clears the token.

Tests: token sign/verify, middleware with valid, expired and wrong-secret tokens.

## Acceptance criteria

- A wrong password returns 401. The right one returns a token that works on protected routes.
- An expired or tampered token returns 401, and the frontend lands on /login.
- The 6th login attempt within a minute returns 429.
- /health still works without a token.
