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
online userinfo check on every validation, without a session cache. Any refusal,
including an unreachable identity provider, remains a Mattermost-shaped 401.

Keep the identity mappings, cookie secret and RuntimeState together in private
backups. Revoke all bound sessions before downgrading to a runtime that predates
this integration: older binaries do not enforce the new identity binding. The
suite migration and downgrade adapters must prove this boundary before release.

Set `OATHWEAVE_BROWSER_ORIGINS_JSON` to an explicit array of HTTPS console origins
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
(`service: "chattermost"`, no version). Preflight mode allows them alongside
`/api/v4/system/ping`, which remains the Mattermost-compatible probe used by
native clients and the container health check. Every response carries a freshly
generated UUID in `X-Request-Id`. Because ChatterMost is internet-facing, inbound
`x-request-id`, `x-hive-request-id`, `x-correlation-id` and `traceparent` headers
are ignored, so callers cannot choose request IDs. The same ID appears in
Mattermost error bodies (`request_id`) and request error logs.
