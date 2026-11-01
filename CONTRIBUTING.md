# Contributing

Read [PRIVACY.md](PRIVACY.md), [AGENTS.md](AGENTS.md), and the [compatibility guide](docs/compatibility.md). Use synthetic local data for bug reports and tests. Keep deployment configuration and operational evidence private.

Use a supported Node release from `package.json`, run `npm ci`, copy `.env.example` to `.env`, set unique local secrets, and run `chmod 600 .env`. The README describes development and optional database setup.

Before submitting changes, stage only intended files and run:

```bash
npm run privacy:check
npm run privacy:test
npm run typecheck
npm run lint
npm run test:unit
npm run build
npx playwright test
```

Add route coverage for API changes and browser coverage for changed user flows. Inspect desktop and mobile screenshots when changing UI. Keep the service boundary, snake_case protocol fields, public IDs, authentication, and persistence guarantees intact.

Describe ChatterMost as **Mattermost-compatible**. Use the compatibility qualifier in descriptive text. Exact protocol identifiers, header names, fixture user agents, and upstream configuration keys are retained for interoperability. Do not add upstream logos or imply affiliation, endorsement, certification, or full feature parity. Retain the trademark attribution in the README.

Contributions are provided under the Apache License, Version 2.0. Submit only material you have the right to contribute; preserve third-party notices and do not add vendored tools or assets without reviewing their licenses. Dependency licenses remain separate from this project's license.
