# ChatterMost

[Project site: UI previews and installation walkthroughs](https://hivemagnus.com/).

**A self-hosted, Mattermost-compatible chat backend for the official mobile and
desktop apps, with Hermes Agent integration.**

Connect the official apps to your ChatterMost server URL to use channels, direct
messages, threads, reactions and file sharing. Connect Hermes Agent to the same
backend to chat with your agents from those clients. A compact native web client
is included for standalone installs and native sign-in.

ChatterMost is independently developed and licensed under Apache-2.0. It implements
Mattermost-compatible REST and WebSocket interfaces; it is not a fork of the
upstream server. See [client setup and current limits](docs/clients.md) for the
supported experience and verification coverage.

## Browser console

In the Hive:Magnus suite, the chat module of [HiveXUI](https://github.com/ChefTaco/HiveXUI)
is the browser console, deployed by the [Hive installer](https://github.com/ChefTaco/hive).
ChatterMost keeps its own independent API and still runs on its own. Its native web
client remains for standalone installs and native sign-in.

Invite redemption works in HiveXUI at `/signup` and creates a native chat account.
Using chat in the console also needs an Oathweave account and an explicit link to
that chat account: see [the Oathweave integration guide](docs/oathweave.md).

## Use the official apps

1. Install an [official mobile or desktop app](https://mattermost.com/apps/).
2. Add your ChatterMost HTTPS server URL, such as `https://chat.example.test`.
   Use the origin, without `/api/v4` or `/websocket`.
3. Sign in with your ChatterMost username or email and password. An administrator
   can create your account or invite you to sign up through the native web client,
   or through HiveXUI at `/signup` in the suite, first.

The native mobile apps use the Mattermost-compatible API. The desktop app loads
ChatterMost's native web client. Mobile background push delivery, calls,
upstream server plugins/marketplace and SSO are not implemented. Foreground
messages use WebSocket delivery. [Client setup](docs/clients.md) explains TLS,
version advertisement, troubleshooting and what the tests establish.

## Install the backend

Use the [0.4.0 Compose distribution](https://github.com/ChefTaco/ChatterMost/releases/tag/v0.4.0).
It includes the application, Postgres, persistent attachments/profile images and
optional Redis for rate limiting. Public images support `linux/amd64` and
`linux/arm64`; no source checkout, Node installation, registry login or local
image build is required on the server.

Follow [container installation](docs/containers.md#install-a-release) to download
and verify the versioned bundle, run its `setup` and `start` commands, and connect
your HTTPS reverse proxy. Setup creates unique credentials once and refuses an
existing installation directory. [AGENTS.md](AGENTS.md#installation-runbook-for-agents)
provides a copyable installation runbook for coding and Hermes agents.

| Public image | Purpose |
| --- | --- |
| [`ghcr.io/cheftaco/chattermost`](https://github.com/users/ChefTaco/packages/container/package/chattermost) | Non-root application |
| [`ghcr.io/cheftaco/chattermost-migrator`](https://github.com/users/ChefTaco/packages/container/package/chattermost-migrator) | One-off schema validation and migrations |

The bundle pins image digests. Keep one application instance: Redis supplies abuse
counters; runtime writes and WebSocket delivery remain local to that instance.
For existing installations, the supported upgrades are **0.3.2 → 0.4.0** and
**0.3.3 → 0.4.0** through the [release manager](docs/upgrading.md), preserving
credentials and data. Native-to-Compose moves use the separate
[migration procedure](docs/container-migration.md).

## Connect Hermes Agent

Hermes supplies a bundled **platform plugin**, `mattermost-platform`, for this
Mattermost-compatible connection. Configure its messaging gateway; keep your
existing Hermes model/provider configuration.

1. Start ChatterMost and obtain its seeded bot's `HERMES_BOT_TOKEN` privately from
   the installation's protected `secrets/runtime.env`. For additional gateways,
   provision a dedicated bot/token per gateway using the admin API.
2. On the Hermes host, run:

   ```bash
   hermes gateway setup
   ```

   Select **Mattermost** (the upstream adapter's name). Supply your ChatterMost
   HTTPS origin as `MATTERMOST_URL`, the bot token as `MATTERMOST_TOKEN`, and the
   human users' 26-character IDs as `MATTERMOST_ALLOWED_USERS`. While signed in
   as a human, open `/api/v4/users/me` on your server to find that user's `id`.
3. Start a new gateway with `hermes gateway run`, or restart the existing gateway
   through its current supervisor. Open a DM to the bot from a client and check
   that its reply arrives. In a channel, mention the bot with `@hermes` (or its
   configured username).

The [Hermes setup guide](docs/hermes-compatibility.md) covers the bundled plugin,
protected configuration, user/channel allowlists, per-gateway bots, slash commands
and end-to-end checks. ChatterMost is installed as a server; it does not require a
separate ChatterMost plugin package inside Hermes.

## What the backend provides

- Invite-only accounts, cookie sessions, bearer tokens, bot tokens and personal access tokens.
- Teams, public/private channels, DMs/group DMs, threads, search, reactions, pins and files.
- Profile images, preferences, presence, typing and real-time WebSocket events.
- Browser administration for users, invites, privacy, bots, supervision and agent policy.
- Hermes bot conversations and declared slash-command routing with the original sender identity.

See [API compatibility](docs/compatibility.md) for the implemented interfaces and
[administration](docs/admin-guide.md) for the native web client. Protocol fixtures and
browser tests cover core client flows; they are not certification of every app
version or upstream feature.

## Operations and documentation

| Task | Guide |
| --- | --- |
| Connect official apps | [Client setup](docs/clients.md) |
| Install as an operator or agent | [Containers](docs/containers.md), [agent runbook](AGENTS.md#installation-runbook-for-agents) |
| Connect a Hermes gateway | [Hermes setup](docs/hermes-compatibility.md) |
| Upgrade, back up, restore or roll back | [Upgrade paths](docs/upgrading.md) |
| Move a native installation to Compose | [Native migration](docs/container-migration.md) |
| Maintain native SSH/systemd installations | [Native deployment](docs/deployment.md) |
| Publish GHCR images and releases | [Maintainer releases](docs/releases.md) |
| Administer users, bots, channels and imports | [Admin guide](docs/admin-guide.md) |
| Understand API support and privacy | [Compatibility](docs/compatibility.md), [runtime privacy](docs/privacy.md) |
| Develop and verify changes | [Source development](docs/development.md), [contributing](CONTRIBUTING.md) |

Check private `CHAT_SERVER_DEPLOY_MODE` before managing an existing installation.
Compose uses its installed manager. Keep credentials, backups, SSH pins and
operational evidence outside Git. Read [PRIVACY.md](PRIVACY.md) before contributing;
report vulnerabilities through [SECURITY.md](SECURITY.md).

## License and compatibility naming

Copyright 2026 ChatterMost contributors. Licensed under the
[Apache License, Version 2.0](LICENSE). Dependencies retain their own licenses.
Retain [NOTICE](NOTICE), dependency licenses and the image's
`THIRD_PARTY_NOTICES.json` when redistributing. This repository is public;
`package.json` is `private: true` to prevent accidental npm publication. Binary
releases are distributed through GHCR and GitHub release bundles.

ChatterMost is Mattermost-compatible. Mattermost is a trademark of Mattermost,
Inc. ChatterMost is independently developed and is not affiliated with, endorsed
by, or sponsored by Mattermost, Inc. Compatibility describes the implemented
interfaces, not complete feature parity or certification. Protocol names and
identifiers are retained where required for interoperability.

An optional Oathweave bridge lets HiveXUI exchange an explicitly linked,
resource-scoped identity for a short native browser session. Existing user IDs,
roles, memberships, Mattermost sessions and agent credentials remain product-owned.
See [the Oathweave integration guide](docs/oathweave.md). This opt-in suite bridge
is separate from generic upstream OAuth/discovery support advertised to native clients.
