# Privacy

ChatterMost defaults to a private posture:

- Telemetry off.
- Diagnostics off.
- Security alert checks off unless explicitly enabled.
- Public file links off.
- Invite-only signup.
- Other users' email hidden from non-admins by default; users can see their own.
- Message contents are not logged by default.
- Login discovery does not reveal whether an account exists.
- Hidden email addresses cannot be probed through exact lookup, search, or autocomplete.

Non-empty `DiagnosticId` and `TelemetryId` fields in client configuration are
compatibility identifiers derived from `SERVER_URL`; their presence does not
enable telemetry. Published mobile clients need stable identifiers for discovery.

## Authentication

The Web UI uses a `HttpOnly`, `SameSite=Lax` session cookie. Cookie-authenticated browser writes require same-origin `Origin` or `Referer` headers matching `SERVER_URL`.

Bearer-token clients such as Hermes and scripted API users authenticate explicitly through `Authorization: Bearer <token>` and are exempt from browser CSRF checks.

Explicit credentials fail closed: an invalid `Authorization` header is never allowed to fall back to an ambient browser session cookie. Deactivating an account revokes its sessions and personal access tokens, removes bot credentials, and disables webhooks owned by that account; reactivation does not resurrect those credentials.

## Audit Trail

Audit logs record authentication, token, invite, admin, moderation, file, reaction,
and agent actions. They are meant to capture operational events rather than full
message bodies. The in-store audit log retains at most 2,000 records, dropping
older entries as new ones arrive. Arrange private external collection/retention
when needed; installation backups retain the audit state at their recovery point.

## Files

File storage lives outside the web root. Access checks require channel membership.
Public-link metadata is disabled by default. Even when enabled, the current
unauthenticated public file route returns a denial; signed public-file delivery
is not implemented.

Uploads are checked against an allowlist and their file signatures. JSON requests are capped at 1 MiB, posts at 16,383 characters, and multipart requests at 30 MiB to limit state-amplification attacks.

## Admin Controls

Admins can change privacy-related settings from the System panel:

- Telemetry.
- Diagnostics.
- Security alert checks.
- Email/full-name visibility.
- File upload enablement.
- Public links.
- Custom emoji.
- Bot account creation.

## Container configuration, logs and recovery data

Runtime privacy is separate from [contribution/publication privacy](../PRIVACY.md).
Compose installs keep configuration in protected `secrets/runtime.env` and
`secrets/postgres_password`, not the source checkout's `.env`. Files/profile images
and database state persist in separate named volumes. Redis holds transient abuse
counters only; it is not the message store or a distributed WebSocket transport.

Backups include messages, files and matching credentials in plaintext protected
files; they are not encrypted by the manager. Supply encryption, restricted
access and off-host retention. Private diagnostics, access logs, transaction
records and browser evidence can identify infrastructure or users even when
message bodies are not logged. Do not upload them to public reports. Explicit
point-in-time restoration can discard newer writes; see [recovery](upgrading.md).
