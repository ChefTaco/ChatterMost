# Connect mobile and desktop apps

ChatterMost is a Mattermost-compatible backend for the official mobile and desktop
apps. Use the same server and accounts for people and Hermes Agent conversations.
The native mobile apps communicate through REST `/api/v4` and WebSocket
`/api/v4/websocket`; the desktop app hosts ChatterMost's included web UI.

## Connect a client

1. [Install ChatterMost](containers.md) behind a working HTTPS reverse proxy.
   Use a certificate trusted by the device and a hostname reachable from it.
   A private-network installation requires the device to have that network access.
2. Create an account through an administrator or a web invite. Public signup is
   disabled. Use the browser to redeem the invite before signing into an app.
3. Download an [official mobile or desktop app](https://mattermost.com/apps/).
   Add a server using your ChatterMost origin, for example
   `https://chat.example.test`, and a display name of your choice. Include a port
   when your HTTPS proxy uses a non-default port. Leave off `/api/v4`, `/login`
   and `/websocket`.
4. Sign in with the account's username or email and password. Open a channel or
   DM, send a message, and check that a second connected client receives it.
   For an agent conversation, follow [Hermes gateway setup](hermes-compatibility.md).

The upstream [client connection instructions](https://docs.mattermost.com/end-user-guide/access/access-your-workspace)
describe the apps' add-server workflow. The backend's account administration and
web interface are ChatterMost's own, as described in the [admin guide](admin-guide.md).

## Server requirements

- Set `SERVER_URL` to the exact public HTTPS origin. Published Compose setup uses
  `--server-url`; an existing install keeps its protected runtime configuration.
- `ALLOW_VERSION_ADVERTISEMENT=true` exposes the configured compatibility version
  `11.8.0` / profile `mattermost-v11.8`. Compose setup enables it. This is the API
  compatibility profile; the ChatterMost distribution version is separately `0.11.0`.
- Proxy HTTP and WebSocket to the same backend. Pass `Upgrade`/`Connection` headers,
  preserve `Origin`/`Referer`, and use long WebSocket timeouts. See the
  [proxy requirements](containers.md#existing-https-reverse-proxy).
- Keep one application instance. Redis supports rate-limit counters, not shared
  runtime writes or cross-instance WebSocket delivery.

When managing an existing install, use its [upgrade/recovery workflow](upgrading.md).
Editing a mounted runtime file does not reload the process. Configure changes in a
planned operator operation; reconnecting a client does not require regenerating
server credentials.

## Current limits and coverage

| Area | Current behavior |
| --- | --- |
| Core chat | Username/email login, teams, channels, DMs/group DMs, posts, threads, reactions, files, profiles, presence and typing have Mattermost-compatible endpoints. |
| Files | Uploads accept PNG, JPEG, GIF, WebP and plain text, subject to file signatures and size limits. General audio, video, PDF and office-document uploads are not implemented. |
| Desktop | The official desktop shell loads the backend's ChatterMost web interface; it does not provide the upstream web interface or all native-shell integrations. |
| Mobile notifications | Foreground connected clients receive WebSocket events. Background push is sent through a push proxy when `PUSH_NOTIFICATION_SERVER` is set; see [mobile push](#mobile-push). |
| Accounts | Invite/admin-created accounts and username/email/password login. SSO discovery reports OIDC, SAML and LDAP disabled. |
| Extensions | Calls and the upstream server plugin/marketplace runtime are unsupported. Hermes uses a platform plugin on the Hermes host. |
| Shared file links | Authenticated files work. The unauthenticated public file route remains denied, including when public-link metadata is enabled. |

The repository replays mobile request fixtures with an iOS `2.22.0` user agent and
tests additional native-client contracts: channel bootstrap, roles, reconnect
sequences, heartbeat, files and permissions. Playwright verifies the included web
UI and real WebSocket behavior. These tests are not physical-device/App Store
certification, and the fixture user agent is not a promise that every app version
or upstream feature is covered. Record the actual app version and platform when
checking a deployment or reporting an issue. See [API compatibility](compatibility.md).

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Cannot add server | Device network access, HTTPS certificate chain, hostname/port and the URL without an API suffix. |
| Version or login discovery fails | Public `/api/v4/system/ping` and `/api/v4/config/client?format=old`, origin and version-advertisement settings. |
| Login fails | Account exists, is active and uses its current password. An administrator can issue an invite or reset it. |
| Messages arrive only after refresh | WebSocket proxy upgrades/timeouts and authentication; verify an actual `posted` event rather than only an HTTP ping. |
| No background push | `PUSH_NOTIFICATION_SERVER` is unset, the proxy does not hold credentials for this app build, the app has not registered a device (sign in again), the account has a WebSocket open elsewhere, or the push preference excludes the message. |
| Hermes does not respond | Gateway user allowlist, bot token, conversation membership and mention requirements; see [Hermes troubleshooting](hermes-compatibility.md#troubleshooting). |

Keep screenshots, traces, logs, tokens and conversation details private. Use a
synthetic reproduction when opening a public issue.

## Mobile push

Background notifications for the official mobile apps go through a push proxy:
ChatterMost sends each notification to `PUSH_NOTIFICATION_SERVER` +
`/api/v1/send_push` in the upstream push-proxy format, and the proxy delivers it
through Apple (APNs) or Google (FCM). Push is off while the variable is empty.

The proxy must hold the APNs/FCM credentials of the app build people use. The
store builds of the official apps are signed by their publisher, so only that
publisher's hosted push service can reach them; using it is an external service
with its own terms, and notification metadata leaves your server. A self-hosted
push proxy works with app builds you sign yourself. ChatterMost does not choose
or configure a proxy for you.

A post notifies a channel member when they have no WebSocket open on the server,
signed in on a phone that registered a device, and their push preference allows
it: **all** messages, **mention** (the default; direct and group messages, and
`@channel`, `@all` and `@here`, always count) or **none**. The channel's own
setting overrides the account setting. `PUSH_NOTIFICATION_CONTENTS` controls what
the notification shows: `generic` (default: sender and channel), `generic_no_channel`
(sender only) or `full` (also the first 500 characters of the message). When the
proxy reports a device as removed, ChatterMost clears that registration.
Deliveries are not retried and failures are logged without device tokens or
message text.

