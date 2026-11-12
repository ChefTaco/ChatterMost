# Connect mobile and desktop apps

ChatterMost is a Mattermost-compatible backend for the official mobile and desktop
apps. Use the same server and accounts for people and Hermes Agent conversations.
The native mobile apps communicate through REST `/api/v4` and WebSocket
`/api/v4/websocket`. ChatterMost no longer serves its own web UI; the browser UI is
[HiveXUI](https://github.com/ChefTaco/HiveXUI). The old `/`, `/login`, `/signup` and
`/admin/system-console` paths show a short notice, or redirect to HiveXUI when the
operator sets `HIVEXUI_URL`.

## Connect a client

1. [Install ChatterMost](containers.md) behind a working HTTPS reverse proxy.
   Use a certificate trusted by the device and a hostname reachable from it.
   A private-network installation requires the device to have that network access.
2. Create an account through an administrator or an invite. Public signup is
   disabled. Redeem the invite in HiveXUI before signing into an app.
3. Download an [official mobile or desktop app](https://mattermost.com/apps/).
   Add a server using your ChatterMost origin, for example
   `https://chat.example.test`, and a display name of your choice. Include a port
   when your HTTPS proxy uses a non-default port. Leave off `/api/v4`, `/login`
   and `/websocket`.
4. Sign in with the account's username or email and password. Open a channel or
   DM, send a message, and check that a second connected client receives it.
   For an agent conversation, follow [Hermes gateway setup](hermes-compatibility.md).

The upstream [client connection instructions](https://docs.mattermost.com/end-user-guide/access/access-your-workspace)
describe the apps' add-server workflow. Account administration happens in HiveXUI
or through the admin API, as described in the [admin guide](admin-guide.md).

## Server requirements

- Set `SERVER_URL` to the exact public HTTPS origin. Published Compose setup uses
  `--server-url`; an existing install keeps its protected runtime configuration.
- `ALLOW_VERSION_ADVERTISEMENT=true` exposes the configured compatibility version
  `11.8.0` / profile `mattermost-v11.8`. Compose setup enables it. This is the API
  compatibility profile; the ChatterMost distribution version is separately `0.5.1`.
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
| Desktop | The official desktop shell loads a server-hosted web interface. ChatterMost no longer serves one (the retired paths show the HiveXUI notice or redirect), so use HiveXUI in a browser on desktop. |
| Mobile notifications | Foreground connected clients receive WebSocket events. Device/notification compatibility acknowledgements are present, but background APNs/FCM push transport is disabled. |
| Accounts | Invite/admin-created accounts and username/email/password login. SSO discovery reports OIDC, SAML and LDAP disabled. |
| Extensions | Calls and the upstream server plugin/marketplace runtime are unsupported. Hermes uses a platform plugin on the Hermes host. |
| Shared file links | Authenticated files work. The unauthenticated public file route remains denied, including when public-link metadata is enabled. |

The repository replays mobile request fixtures with an iOS `2.22.0` user agent and
tests additional native-client contracts: channel bootstrap, roles, reconnect
sequences, heartbeat, files and permissions. Playwright runs the real server and
verifies ping, login and WebSocket delivery the way the official apps use them. These tests are not physical-device/App Store
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
| No background push | Push transport is not implemented; keeping the app connected verifies foreground delivery only. |
| Hermes does not respond | Gateway user allowlist, bot token, conversation membership and mention requirements; see [Hermes troubleshooting](hermes-compatibility.md#troubleshooting). |

Keep screenshots, traces, logs, tokens and conversation details private. Use a
synthetic reproduction when opening a public issue.
