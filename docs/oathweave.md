# Oathweave sign-in for HiveXUI

The optional suite integration exchanges an audience-restricted Oathweave resource
token for a native ChatterMost browser session. Existing Mattermost-compatible
password, bot and personal-token clients keep their existing protocols.

Configure `OATHWEAVE_ISSUER`, `OATHWEAVE_JWKS_URL` and
`OATHWEAVE_USERINFO_URL` with verified HTTPS endpoints. Private CAs can be supplied
through Node's normal `NODE_EXTRA_CA_CERTS` trust configuration. Never disable TLS
verification. In Oathweave, the browser client needs audience `chattermost` and an
explicit `chattermost:session` permission.

`OATHWEAVE_CHAT_IDENTITIES_JSON` is a private installation-owned array of
`{issuer, subject, localUserId}` entries. Each identity must have one explicit
mapping to an existing active, non-bot user. Account roles, memberships, posts and
ownership remain attached to that local user ID. No username or email matching
is performed, and identity roles do not confer chat administration.

HiveXUI calls `POST /api/v4/auth/oathweave/session` with the resource bearer and
an Origin matching `SERVER_URL`. The response sets the native secure HttpOnly
cookie and returns the user plus `expires_at`; it does not return a native token.
The session expires within fifteen minutes and never outlives the resource token.
The resource credential is encrypted with an installation-specific, purpose-bound
key derived from `COOKIE_SECRET`; only ciphertext enters RuntimeState.

HTTP authentication and bound WebSocket traffic revalidate the credential against
Oathweave. Disabled users, revoked local sessions, removed mappings, expired
tokens and unavailable identity verification fail closed. Browser file downloads
use the same native cookie. WebSocket URLs never carry credentials. Native
authentication challenges cannot bypass bound-session checks.

Token verification uses the suite's shared verifier from
`@hivemagnus/hive-common`, configured with ChatterMost's established rules: user
tokens only, RS256, exact `chattermost` audience, no clock tolerance, a required
`roles` array, an exact `chattermost:session` permission (no wildcards) and an
online userinfo check on every validation, without a session cache. The JWKS and
userinfo reads are retried up to three times within about half a second after a
network failure or a 408, 429 or 5xx response. Any refusal, including an
identity provider that stays unreachable, remains a Mattermost-shaped 401.

Keep the identity mappings, cookie secret and RuntimeState together in private
backups. Revoke all bound sessions before downgrading to a runtime that predates
this integration: older binaries do not enforce the new identity binding. The
suite migration and downgrade adapters must prove this boundary before release.

Set `OATHWEAVE_BROWSER_ORIGINS_JSON` to an explicit array of HTTPS UI origins
when HiveXUI has a different origin from the existing `SERVER_URL`. The same
allowlist protects session exchange, cookie mutations and WebSocket upgrades.
Native Mattermost URLs and clients retain their existing `SERVER_URL`; unlisted
origins remain denied. No wildcard or origin-with-path entry is accepted.

For a fresh empty account store, an installer may set `ADMIN_INITIAL_ID` to an
explicit 26-character lowercase alphanumeric product ID before first startup.
Use that exact local ID in the reviewed issuer/subject link. Repeated startup
requires the same ID for the configured administrator and preserves its password.
A changed ID or an existing store without the matching administrator fails closed;
this option never renames, combines or adopts existing accounts. Existing
installations leave it unset and retain their reviewed account mappings.

Native backend TLS is optional. Set both `TLS_CERT_PATH` and `TLS_KEY_PATH` to
regular files when the API is reached across hosts or through a separate container
edge. Keep the key owner-only. The TLS listener also serves the existing native
WebSocket upgrade path. `BIND_HOST` controls its local bind address;
`TLS_PROBE_SERVER_NAME` names the certificate for verified container probes and
defaults to `localhost`. Set `TLS_PROBE_CA_PATH` to the issuing authority bundle when the server certificate is CA-signed; its default is the server certificate for self-signed TLS. Trust the certificate chain using
`NODE_EXTRA_CA_CERTS` or the calling product's explicit CA configuration. The
container probes use the configured port, verified HTTPS and WSS, and native
login credentials. Existing standalone HTTP behind an HTTPS edge remains the
default when both TLS references are unset.

## Suite health and request IDs

`GET /health/live` and `GET /health/ready` serve the suite health format
(`service: "chattermost"`, no version). Liveness answers whenever the process
can. Readiness runs a `store` check and answers 503 `not_ready` when a failed
write has put persistence on hold or, with Postgres, the database does not
answer; the image's container health check calls it. Preflight mode allows both
alongside `/api/v4/system/ping`, which remains the Mattermost-compatible probe
for native clients and always answers while the process runs. Every response carries a freshly
generated UUID in `X-Request-Id`. Because ChatterMost is internet-facing, inbound
`x-request-id`, `x-hive-request-id`, `x-correlation-id` and `traceparent` headers
are ignored, so callers cannot choose request IDs. The same ID appears in
Mattermost error bodies (`request_id`) and request error logs.

## Hive administrator provisioning

The running server can create a new native administrator for an explicitly reviewed
Oathweave identity. This is installation maintenance, separate from browser roles
and installing the identity link. It never infers account ownership from an email,
username or IAM administrator role.

Set a separately generated 64-character lowercase hexadecimal
`HIVE_ADMIN_PROVISIONING_SECRET` in the protected server environment. Never reuse a
cookie, token, bot or native administrator credential. The routes are absent when
it is unset. Native TLS must be configured. The installer calls verified HTTPS on
localhost from inside the existing container, with the secret only in the
`x-hive-admin-provisioning-secret` header. Only the actual loopback socket peer is
accepted; forwarded addresses establish no authority. Origin, Referer, forwarding, cookie and
Authorization headers are refused. Keep this endpoint outside browser routing;
never disable TLS verification or put the secret in arguments or transcripts.

- `POST /internal/hive/admin-accounts/OPERATION_UUID` accepts exactly
  `{version:1, issuer, subject, user_id, username, email}`. `issuer` must exactly
  match the configured HTTPS Oathweave issuer; `subject` is the existing human ID
  resolved and approved by the owning installer. `user_id` is a new preallocated
  26-character lowercase alphanumeric native ID. Usernames retain their exact lowercase value, including leading `_` or `-`; email
  addresses are normalized to lowercase. The role is fixed to
  `system_admin system_user`, active and non-bot. The installer revalidates the
  exact IAM identity immediately before calling the product.
- `GET /internal/hive/admin-accounts/OPERATION_UUID` reads the retained result.
  Both return `{schema:1,operation_id,user_id,issuer,subject,username,email,role,
  status:"committed",request_sha256,created_at}` with no credentials. Current
  account drift or deactivation is refused rather than repaired.

The account, default supervised-team public memberships, audit outbox event and
permanent receipt commit in one existing serialized store mutation. POST returns success only after that durable audit outbox event is published. GET is observational: it can return the committed account receipt even when a prior POST failed only during audit publication; that proves account ownership and durable audit intent, not external audit delivery. Repeating the exact POST publishes any retained audit event without creating another account or duplicate audit event. The native
password is generated randomly, hashed and discarded; it is never returned or
retained in recoverable form. No existing users, sessions or messages are replaced.

Persist the operation UUID, account ID and exact request before the POST. An
unchanged repeat returns the same account; different inputs, an existing account
ID/username/email, a previously linked identity or another operation owning the
identity are refused. On a lost reply, read or repeat only that exact operation.
Never choose another ID, reset a password or reactivate an account. Receipts
survive backup/restore and audit compaction; older stores load an empty receipt
collection without a SQL migration.

After creation, Hive separately installs the explicitly approved
`{issuer,subject,localUserId}` entry in `OATHWEAVE_CHAT_IDENTITIES_JSON`, preserving
all other links, and recreates the server with its protected environment. It never
substitutes another person's account or signs in on their behalf. Use this running
server boundary: opening a second writable RuntimeState store can lose concurrent
messages. See also [deployment configuration](deployment.md#optional-hive-administrator-provisioning).
