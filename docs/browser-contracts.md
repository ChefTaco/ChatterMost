# Browser API contracts

`src/shared/browser-chat.ts` owns pure Zod schemas for the Mattermost-compatible
conversation routes used by browser clients. The corresponding native wire types,
route inventory and response schemas are checked against the actual server and
`docs/openapi-browser.json`. Administration retains its separate
`browser-admin.ts` contract. Binary downloads and WebSockets retain native session
cookies and exact-origin checks; these artifacts never contain server code.

After reviewing and committing a change, run `npm run contracts:browser:chat --
--output NEW_DIRECTORY`. The export contains only the immutable committed
`browser-chat.ts` blob and its SHA-256 provenance. Existing output is refused.
Consumers verify this artifact and import no sibling backend source. Run
`npm run check:openapi:browser` to verify the browser API snapshot.
