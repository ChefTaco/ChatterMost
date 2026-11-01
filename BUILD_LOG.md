# ChatterMost Build Log

## Public source baseline

The public source snapshot includes the TypeScript/Hono application, service and storage layers, database migrations, deployment tools, documentation, and automated checks. Operator-specific deployment records and historical work logs belong in private storage.

The source uses generic deployment examples and includes Apache-2.0 licensing, contributor privacy guidance, and a publication check in CI. Run the gates in AGENTS.md before recording validation results. Keep future entries focused on public changes and omit deployment receipts, private identities, and runtime data.

Development tooling pins `minimatch` to `11.0.3` because the current lint packages still request the affected 10.x line. CI checks the full dependency audit at moderate severity and above, alongside privacy and application checks.

Live conversation refreshes preserve the focused composer and its selection synchronously, including a refresh between Shift and Enter. Browser regression coverage forces that refresh and checks that the newline lands at the original caret.
