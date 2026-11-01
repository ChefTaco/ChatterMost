# Privacy

ChatterMost defaults to a private posture:

- Telemetry off.
- Diagnostics off.
- Security alert checks off unless explicitly enabled.
- Public file links off.
- Invite-only signup.
- Email hidden from non-admins by default.
- Message contents are not logged by default.
- Login discovery does not reveal whether an account exists.
- Hidden email addresses cannot be probed through exact lookup, search, or autocomplete.

## Authentication

The Web UI uses a `HttpOnly`, `SameSite=Lax` session cookie. Cookie-authenticated browser writes require same-origin `Origin` or `Referer` headers matching `SERVER_URL`.

Bearer-token clients such as Hermes and scripted API users authenticate explicitly through `Authorization: Bearer <token>` and are exempt from browser CSRF checks.

Explicit credentials fail closed: an invalid `Authorization` header is never allowed to fall back to an ambient browser session cookie. Deactivating an account revokes its sessions and personal access tokens, removes bot credentials, and disables webhooks owned by that account; reactivation does not resurrect those credentials.

## Audit Trail

Audit logs record authentication, token, invite, admin, moderation, file, reaction, and agent actions. They are meant to capture operational events rather than full message bodies.

## Files

File storage lives outside the web root. Access checks require channel membership. Public links are disabled unless an admin explicitly enables `EnablePublicLink`; the current public file route returns a compatibility denial when public links are unavailable.

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
