# Privacy for source contributions

This policy covers commits, pull requests, issues, CI output, screenshots, release archives, and Git metadata. Application privacy behavior is documented in [docs/privacy.md](docs/privacy.md).

## Keep private material local

Never commit credentials, password hashes from real accounts, tokens, cookies, invite links, webhook URLs, private keys, certificates, `.env` files, deployment SSH trust pins, or secret-manager exports. Public host keys can identify private infrastructure and belong in ignored operator configuration too.

Do not publish real hostnames, tailnet names, internal IP addresses, account names, personal email addresses, home-directory paths, private project inventories, customer identities, chat content, attachments, database exports, audit logs, release receipts, or operational history. Keep backups and historical Git bundles outside the repository in private storage. Ignore rules are a convenience; force-adding a file bypasses them.

Use reserved domains such as `chat.example.test`, synthetic people and bot accounts, documentation IP ranges, and clearly disposable test credentials. Reconstruct small fixtures from scratch rather than redacting live exports. A screenshot or browser trace can expose names, conversations, tokens, URLs, storage, and network traffic; use a synthetic local instance and inspect the complete artifact before sharing. Never attach live evidence to a public issue or PR.

## Compose installation state

Keep the complete installation directory outside Git worktrees. Protected
`secrets/runtime.env`, `secrets/postgres_password`, `installation.json`, `compose.env`,
transaction journals, pending transitions, migration evidence, verified-release
receipts and backup directories are private operator state. A generated password
can be sensitive even when no provider-token pattern recognizes it. The index
scanner blocks these specific installation markers at arbitrary directory depths,
including force-added ignored files. Use disposable synthetic installations for
container and lifecycle verification; publish only the sanitized report fields.

## Container builds and public release surfaces

Do not send an operator worktree wholesale as a build context. Preserve the
Docker input allowlist and explicit COPY sources, and check Docker's actual view
with `python3 tests/container/context.py` when changing build inputs. Images,
SBOM/provenance, release archives, Actions logs and workflow artifacts are public
publication surfaces. Maximum build provenance includes build arguments; never
put credentials, private endpoints or operator paths in them. The release workflow
uses only public version, revision and creation metadata as build arguments.

Keep live verification evidence private. Release/public-install tests use disposable
synthetic data and publish only their sanitized report fields. Review scan/report
paths and metadata too. Changing a package to public exposes its published content;
repository visibility alone does not establish image visibility or privacy.
Follow [maintainer releases](docs/releases.md) before publishing new versions.

## Before every commit

1. Select files explicitly with `git add <paths>`; avoid blanket staging.
2. Review `git diff --cached --stat` and the complete `git diff --cached`. Inspect new files and binary artifacts separately.
3. Run `npm run privacy:check` and `npm run privacy:test`. The check reads the Git index, including force-added ignored files. It reports paths and rule names without echoing matched values. Stage any fixes before rerunning it.
4. Use a privacy-preserving Git author/committer identity, such as your provider's verified no-reply address, when desired. Check both identities and the commit message before pushing.
5. Run the repository verification gates. Review generated logs before quoting or uploading them.

Install the optional local hook with `git config core.hooksPath .githooks`. CI runs the privacy gate independently. Automated checks catch selected patterns and prohibited file types; they do not establish that arbitrary prose or images are anonymous. Reviewers must still read contributions. Do not add broad exclusions to make a failing check pass.

The scanner also compares staged text against sufficiently long credential and private deployment values from an available local `.env`, without printing those values. CI has no operator `.env`; it uses the portable pattern and path checks. Keep a local secret scanner available for deeper reviews.

## Before the first public push

Audit every branch and tag intended for publication, including commit messages, authors, deleted files, binary objects, and large-file storage. Deleting private material at the branch tip leaves earlier copies in history. Prefer a reviewed source snapshot with a new root commit when historical privacy cannot be established. Keep recovery history outside the public repository and never push it as an archival branch or tag.

Review hosting-service surfaces separately: pull requests, issues, releases and assets, Actions logs/artifacts/caches, packages, wikis, descriptions, websites, and Git LFS storage. Replacing Git history does not remove these copies or clones. Coordinate any replacement of a shared branch and retire old publication refs deliberately. A clean snapshot is preparation; changing repository visibility is a separate publication action.

After publication, ordinary changes retain the reviewed public history. Do not
rewrite shared history, retag releases or publish old private recovery refs as
routine cleanup. A history replacement needs its own explicit authorization.

## If private information is exposed

Stop further publication, revoke or rotate exposed credentials through the supported operational workflow, and notify the maintainer privately. Remove the content and coordinate history/hosting cleanup; a deletion commit alone is insufficient. Preserve incident evidence privately and avoid repeating the secret in an issue, commit message, or scanner output.
