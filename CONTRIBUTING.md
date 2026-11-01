# Contributing

Read [PRIVACY.md](PRIVACY.md), [AGENTS.md](AGENTS.md), and the [compatibility guide](docs/compatibility.md). Use synthetic local data for bug reports and tests. Keep deployment configuration and operational evidence private.

Use a supported Node release from `package.json`, run `npm ci`, copy `.env.example` to a new `.env` without replacing existing operator configuration,
set unique local secrets, and run `chmod 600 .env`. The README describes development and optional database setup.

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

Add route coverage for API changes and browser coverage for changed user flows. Inspect desktop and mobile screenshots when changing UI. Keep the service boundary, snake_case protocol fields, public IDs, authentication, and persistence guarantees intact.

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
