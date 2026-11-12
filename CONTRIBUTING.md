# Contributing

Read [PRIVACY.md](PRIVACY.md), [AGENTS.md](AGENTS.md), and the [compatibility guide](docs/compatibility.md). Use synthetic local data for bug reports and tests. Keep deployment configuration and operational evidence private.

Use a supported Node release from `package.json`, run `npm ci`, copy `.env.example` to a new `.env` without replacing existing operator configuration,
set unique local secrets, and run `chmod 600 .env`. See
[source development](docs/development.md) for local JSON/Postgres setup and verification. For installing the server rather than changing it, use the
[agent installation runbook](AGENTS.md#installation-runbook-for-agents).

Before submitting changes, stage only intended files and run:

```bash
npm audit --audit-level=moderate
npm run privacy:check
npm run privacy:test
npm run container:test
npm run typecheck
npm run lint
npm run test:unit
npm run build
npx playwright install chromium
npx playwright test
```

Add route coverage for API changes and real-server Playwright coverage for changed client flows. ChatterMost has no built-in web UI; UI changes belong in HiveXUI. Keep the service boundary, snake_case protocol fields, public IDs, authentication, and persistence guarantees intact.

Describe ChatterMost as **Mattermost-compatible**. Use the compatibility qualifier in descriptive text. Exact protocol identifiers, header names, fixture user agents, and upstream configuration keys are retained for interoperability. Do not add upstream logos or imply affiliation, endorsement, certification, or full feature parity. Retain the trademark attribution in the README.

Contributions are provided under the Apache License, Version 2.0. Submit only material you have the right to contribute; preserve third-party notices and do not add vendored tools or assets without reviewing their licenses. Dependency licenses remain separate from this project's license.

## Documentation and release changes

Use the [documentation index](README.md#operations-and-documentation),
[container operations](docs/containers.md), [upgrade paths](docs/upgrading.md) and
[maintainer release guide](docs/releases.md). Check commands against the current
manager/workflows and, where applicable, the exact published version. Container
bundles carry a frozen installation README; fixes on `main` do not modify an
already immutable release asset. Cross-guide links in `docs/containers.md` must
also work when that file becomes the bundle's root `README.md`.

An upgrade policy entry is a support commitment: add it only with actual lifecycle
coverage for that source version, on both architectures. Keep versions in the
package/lockfile and release policy aligned when intentionally publishing a new
runtime release. Documentation fixes alone do not require retagging or rebuilding
a published image, and must not restart an operator installation. Do not publish
Git tags to try out a draft release: tags trigger the real release workflow.

## Secret scanning

Install the pinned, checksum-verified Gitleaks CLI before contributing:

```bash
bash scripts/install-gitleaks.sh
git config core.hooksPath .githooks
bash scripts/test-gitleaks.sh
bash scripts/gitleaks.sh --staged
bash scripts/gitleaks.sh --history
```

Gitleaks 8.30.1 is free and runs directly; no paid Action or organization license
is required. The installer supports Linux and macOS on x64 and ARM64 and uses the
user cache, without sudo. Other platforms can put that exact version on PATH.
Missing or incompatible binaries fail the hooks rather than skipping checks.

The commit hook scans an export of the exact Git index, including force-added
ignored files. The push hook scans every outgoing ref's commit range, including
secrets deleted in a later commit. New refs or unavailable remote bases receive
a complete reachable-history scan. Existing privacy checks still run.

The `Gitleaks` workflow scans full reachable history on pushes, pull requests
and merge queues, and runs synthetic regression checks. Maintain `Gitleaks` as a
required status check on the default branch. CI runs after upload and can block
merging; local hooks and GitHub's native push protection help prevent upload.
Local hooks can be bypassed or absent on other clones, so install them in each
clone. No scanner guarantees detection of arbitrary secrets.

All output redacts matched secrets. Inline `gitleaks:allow` comments are ignored.
Review findings privately: rotate a real exposed credential and remove it through
the appropriate incident process. Never add real credentials to an allowlist.
Any false-positive exception in `.gitleaks.toml` must match both one exact value
and a specific file, with a reason; do not exempt whole test or documentation
directories or disable built-in detection rules.
