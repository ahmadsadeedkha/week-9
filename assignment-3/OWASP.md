# OWASP Top 10 (2021) — Mapping to This API

This document maps each OWASP Top 10 category to the concrete mechanism in this
codebase that mitigates it, or explains why it is not applicable. Each entry
names a file, guard, or test — not an intention.

---

## A01:2021 — Broken Access Control

**Mitigated.**

- `JwtAuthGuard` (`src/auth/guards/jwt-auth.guard.ts`) gates every write route
  at the controller level (`TasksWriteController`, `ProjectsWriteController`),
  so a route added later is protected by default rather than by someone
  remembering to decorate it.
- `RolesGuard` (`src/auth/guards/roles.guard.ts`) enforces per-project roles
  (`owner` / `admin` / `member` / `viewer`) by querying `project_members` for
  the specific project the request touches — resolved via route param, body
  field, or a loaded parent resource (`task-param`), never assumed.
- Ownership/authorship fields (`ownerId`, `authorId`) were removed from every
  create DTO and replaced with `@CurrentUser()`, so identity is always read
  from the verified JWT, never from a client-supplied body field.
- Cross-project isolation (the "confused deputy" case — a role on Project A
  granting nothing on Project B) is proven by
  `test/rbac-cross-project.e2e-spec.ts`.
- Guard ordering (`JwtAuthGuard` before `RolesGuard`) is verified by
  `test/guard-order.e2e-spec.ts`, so an unauthenticated request gets 401
  rather than a confusing 403.

## A02:2021 — Cryptographic Failures

**Mitigated.**

- Passwords are hashed with `argon2` (`AuthService.register`), never stored
  or logged in plaintext. `password_hash` is marked `select: false` on the
  `User` entity so it is never returned by a default query.
- Refresh tokens are stored as an `argon2` hash (`refresh_tokens.token_hash`)
  — the raw token is only ever handed to the client once, at issuance.
- The JWT signing secret (`JWT_SECRET`) is sourced from `.env` via
  `ConfigService` everywhere it's used; a repository-wide search for a
  hardcoded secret string finds nothing.
- `helmet()` sets `Strict-Transport-Security`, enforcing HTTPS in
  environments that terminate TLS in front of this API.

## A03:2021 — Injection

**Mitigated.**

- All database access goes through TypeORM's query builder / repository API
  with parameterized queries — no raw string-concatenated SQL exists in the
  codebase.
- The global `ValidationPipe` (`whitelist: true, forbidNonWhitelisted: true`
  in `main.ts`) rejects any request body containing fields not declared on
  its DTO, closing the door on unexpected payload shapes reaching a query.
- Route parameters are validated with `PositiveIntPipe`
  (`src/common/pipes/positive-int.pipe.ts`) before any lookup runs, so a
  malformed `:id` never reaches a query at all.

## A04:2021 — Insecure Design

**Mitigated.**

- The two-token auth design (short-lived JWT access token + hashed, rotating
  refresh token in `refresh_tokens`) limits the blast radius of a stolen
  token: an access token expires in minutes; a stolen refresh token is
  revoked the moment the legitimate client next refreshes
  (`AuthService.refresh`, rotation enforced in one transaction).
- Reuse of an already-revoked refresh token is treated as a security event,
  not a routine 401 (see Challenge X1 if implemented — otherwise note here
  if deferred).
- Login and refresh failures return an identical response for "no such user"
  and "wrong password," by design, closing the user-enumeration path
  (`AuthService.login`).

## A05:2021 — Security Misconfiguration

**Mitigated.**

- `helmet()` is applied globally in `main.ts`, setting a restrictive default
  `Content-Security-Policy`, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: SAMEORIGIN`, and related headers.
- CORS is restricted to a single configured origin
  (`CORS_ORIGIN` from `.env`) with `credentials: true` — never a wildcard.
- The global exception filter (`HttpExceptionFilter`) ensures an unhandled
  exception never leaks a stack trace, database error text, or internal
  detail to the client; it always returns a generic
  `"Internal server error"` message for anything that isn't a deliberate
  `HttpException`.
- All required environment variables (`DB_*`, `JWT_*`, `CORS_ORIGIN`) are
  validated at boot via a Joi schema in `ConfigModule.forRoot()` — the app
  refuses to start with a missing secret rather than silently defaulting.

## A06:2021 — Vulnerable and Outdated Components

**Partially mitigated / N/A for automated tracking.**

- Dependencies are pinned in `package-lock.json`.
- No automated dependency audit currently runs in CI (see Challenge X1 —
  `npm audit` as a CI step is proposed but not yet implemented as of this
  writing).

## A07:2021 — Identification and Authentication Failures

**Mitigated.**

- `POST /auth/login`, `/register`, and `/refresh` are rate-limited via
  `@nestjs/throttler` — a per-IP ceiling globally, and a stricter per-account
  limit on login specifically (`AccountThrottlerGuard`,
  `src/auth/guards/account-throttler.guard.ts`), keyed to the email in the
  request body rather than the source IP alone.
- Passwords are hashed with `argon2`, never compared or stored in plaintext.
- Refresh tokens are rotated on every use (`AuthService.refresh`) and can be
  explicitly revoked on logout (`AuthService.logout`), both writing to
  `refresh_tokens.revoked_at` rather than deleting the row, preserving an
  audit trail.
- JWT access tokens carry a short expiry (`JWT_ACCESS_EXPIRES_IN` in `.env`)
  and only `sub`/`email` in the payload — no sensitive claims.

## A08:2021 — Software and Data Integrity Failures

**N/A, with reason.** This API does not deserialize untrusted data structures
beyond standard JSON body parsing (already covered by A03's validation
layer), does not use auto-update mechanisms, and has no CI/CD pipeline with
externally-sourced build steps in scope for this assignment.

## A09:2021 — Security Logging and Monitoring Failures

**Partially mitigated.**

- `HttpExceptionFilter` logs the full stack trace of any unhandled (non-
  `HttpException`) error server-side via `Logger.error`, even though the
  client only receives a generic message — so failures remain debuggable
  without being exposed.
- No centralized/structured security event log (failed login attempts,
  rate-limit trips, permission denials) exists yet beyond default Nest
  request logging. This is the gap named below as the API's most exposed
  area.

## A10:2021 — Server-Side Request Forgery (SSRF)

**N/A, with reason.** This API does not accept a user-supplied URL and make
an outbound request to it anywhere in its current feature set (no webhook
registration, no "fetch this image from a URL" style endpoint). If such a
feature is added later, it would need an allowlist of permitted destinations
and a block on requests to internal/private IP ranges.

---

## Most exposed area

**A09 — Security Logging and Monitoring.** Every access-control decision in
this API (a 401 from `JwtAuthGuard`, a 403 from `RolesGuard`, a 429 from the
throttler) is currently visible only as an HTTP response — none of it is
aggregated into a queryable security event log. In practice, this means a
sustained credential-stuffing attempt, a pattern of 403s probing for
cross-project access, or a burst of rate-limit trips would only be noticed
by someone actively watching request logs in real time, not through any
alerting or dashboard. Given how much of this assignment's effort went into
*enforcing* access control correctly, the corresponding blind spot is that
we would not reliably *notice* a sustained attempt to defeat it.
