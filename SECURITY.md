# Security reports

Do not publish exploit details, credentials, live endpoints, user data, or private deployment evidence in public issues.

Use GitHub's [private vulnerability report](https://github.com/ChefTaco/ChatterMost/security/advisories/new)
for this repository (private reporting is enabled). If private reporting is unavailable, open a minimal issue asking the maintainer for a private contact channel without including sensitive details. Operators should preserve evidence privately and coordinate any compromised-credential
rotation with their deployment type. Native rotation scripts do not operate the
Compose installation's secret files/database and must not be run against it.

Include affected versions, a synthetic reproduction, expected behavior, and impact in the private report. Review attachments using [PRIVACY.md](PRIVACY.md) before sharing them.

For container reports, include the ChatterMost version, app/migrator image digests,
architecture and relevant advisory identifiers. Do not attach runtime secret files,
installation directories, database dumps or live screenshots. Published image scans
cover fixed HIGH/CRITICAL findings at release time; a passing historical scan does
not guarantee that no later advisory exists. See [release verification](docs/releases.md)
and [safe upgrades/recovery](docs/upgrading.md). Supported upgrade sources are
explicit in each release manifest; the older test baseline is not a promise of
ongoing fixes or a backport policy.
