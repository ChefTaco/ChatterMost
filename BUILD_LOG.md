# ChatterMost Build Log

## Public source baseline

The public source snapshot includes the TypeScript/Hono application, service and storage layers, database migrations, deployment tools, documentation, and automated checks. Operator-specific deployment records and historical work logs belong in private storage.

The source uses generic deployment examples and includes Apache-2.0 licensing, contributor privacy guidance, and a publication check in CI. Run the gates in AGENTS.md before recording validation results. Keep future entries focused on public changes and omit deployment receipts, private identities, and runtime data.

Development tooling pins `minimatch` to `11.0.3` because the current lint packages still request the affected 10.x line. CI checks the full dependency audit at moderate severity and above, alongside privacy and application checks.

Live conversation refreshes preserve the focused composer and its selection synchronously, including a refresh between Shift and Enter. Browser regression coverage forces that refresh and checks that the newline lands at the original caret.

Container baseline 0.2.3 adds a separate digest-pinned Compose distribution and
native AMD64/ARM64 release pipeline. The application image runs without root,
excludes build tools, generates its native Prisma engine, and carries Apache-2.0
and dependency notices. Protected installation secrets, private networks, explicit
locked/checksummed/drift-checked migrations, persistent file storage, synthetic
container smoke verification and release SBOM/provenance/scanning are included.
The existing SSH/systemd script contracts remain separate from the distribution.

The container release gate exposed an attachment submission race. Composer busy
state now survives live refreshes, preventing the next message from inheriting a
prior in-flight attachment. A held-response browser regression verifies the race.
The build context is verified by exporting Docker's actual view and checking an
allowlist with excluded synthetic sentinels. Directory-level ignore exceptions
were removed so private deployment files cannot enter even an intermediate build
context. Release tar headers omit host user/group metadata.
Final images prune the actual required dependency closure, including optional-peer
tooling left by npm, and remove the base image's package managers. Local Trivy
scans of both application and migrator pass the fixed high/critical gate. The
2,001-write retention test has a targeted integration timeout for hosted runners;
all retention assertions remain intact.

Lifecycle release 0.3.2 builds on the published 0.2.3 container baseline. The
standalone manager adds explicit-version upgrades, private consistent backups,
explicit database/file restoration, schema-checked app rollback, and interrupted
transaction recovery. Release and cache integrity, generation/lineage contracts,
actual schema comparison, image identity, protected secrets, database locks,
clean writer shutdown and durable private transaction records gate activation.
Existing SSH deployment contracts remain separate; native-to-Compose moves use
the authorized migration procedure.

Native release jobs verify the published baseline against candidate image digests
before assembling a release. Synthetic coverage includes retained accounts, bot
authentication, messages, attachments/profile images, unchanged secrets, restart
persistence, backup restoration, compatible rollback, genuine failing Prisma SQL,
health failure recovery, incompatible-generation refusal, browser login and live
browser WebSocket delivery. Public archive/CLI verification repeats after release.
Release artifacts include native lifecycle reports alongside scans and publisher-attested
checksums. Image version reuse is refused; only reviewed upgrade paths are allowed.
The release gate uses isolated browser files for the shared synthetic server and
keeps concurrent two-browser WebSocket coverage. Multi-hash authentication tests
retain real hashing and assertions with targeted hosted integration timeouts.
Backup restoration is proven after deleting a retained post and erasing attachment
and profile files. GitHub release immutability is enabled for new publications.
Restore prepares the configured volume owner and performs clearing/extraction in
one container; new Compose installs disable volume copy-up. This prevents image
UID 1000 from replacing another operator UID while a volume is temporarily empty.
Coverage includes restoring the original baseline template and independent member
and custom-bot credentials that startup cannot recreate from configuration.

Documentation now leads with the public Compose/GHCR distribution and keeps native
operations explicitly separate. Upgrade guidance defines the reviewed source/target
matrix, first lifecycle-manager bootstrap, consistent recovery boundaries and
future policy/test requirements. Maintainer guidance covers public package access,
release artifacts, integrity/attestations, immutable versions and post-publication
verification. Source setup, runtime configuration and seeded bot-token restart
behavior are documented against their actual implementation. Private operational
receipts and verification data remain outside the public documentation.
