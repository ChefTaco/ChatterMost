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

Keep the identity mappings, cookie secret and RuntimeState together in private
backups. Revoke all bound sessions before downgrading to a runtime that predates
this integration: older binaries do not enforce the new identity binding. The
suite migration and downgrade adapters must prove this boundary before release.

Set `OATHWEAVE_BROWSER_ORIGINS_JSON` to an explicit array of HTTPS console origins
when HiveXUI has a different origin from the existing `SERVER_URL`. The same
allowlist protects session exchange, cookie mutations and WebSocket upgrades.
Native Mattermost URLs and clients retain their existing `SERVER_URL`; unlisted
origins remain denied. No wildcard or origin-with-path entry is accepted.
