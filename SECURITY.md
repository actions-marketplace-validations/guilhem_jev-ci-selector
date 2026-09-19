# Security

The planner treats pull request content as untrusted data. Keep its job separate from any checkout, dependency installation, or execution of PR code. CI commands belong in consumer jobs.

## Keep planning isolated

- Use `pull_request`. Do not use `pull_request_target` to work around unavailable secrets. Fork PRs keep every task and never contact TypeSafe.
- Pin the action to a reviewed full commit SHA containing `dist/index.js`. Limit the GitHub token to `contents: read`. Do not pass planner secrets to jobs that test PR code.
- The active catalog is read at the event's base SHA. Changes to the catalog or workflow files force all tasks. A proposed catalog may be validated separately as data; it must not become the active policy for that run.
- Keep `ci-required` mandatory. A selected task that is skipped, cancelled, or unsuccessful must block validation. Maintain the catalog, jobs, `needs`, and contract checks together. Jobs executing PR code retain their own trust boundaries.

## Understand what leaves the runner

Set `allow-external-context: 'true'` only after approving the transfer of the diff, changed paths, commit SHAs, and task questions to TypeSafe. **Shadow mode sends this context too** when a key and permission are provided; it preserves all tasks, not the confidentiality of an authorized request.

Questions come from the trusted base catalog, but the diff can contain adversarial content. This separation does not guarantee resistance to prompt injection. Jev can be wrong or influenced by the input, so keep essential checks under `always: true`.

SDK logging is disabled, and the action uses a fixed API endpoint. Do not add logs containing request bodies, diffs, credentials, or raw errors. Public messages are fixed; reports contain validated metadata, hashes, probabilities, and deterministic reason codes.

Reports still reveal task names, commit SHAs, and probabilities. Choose their visibility and retention according to your repository's policies, and never put secrets in catalog identifiers.

## Respond to a selection incident

Set `force-all: 'true'` or return to `mode: shadow`, then compare the report and actual task results for the same tested SHA and workflow run.

Merge-parent checks tie the diff to the event; they do not establish the semantic accuracy of a Jev response. This MVP does not guarantee detection of every regression. Measurement and an explicit decision to enable selective execution remain the maintainer's responsibility.

## Report a vulnerability

Report suspected vulnerabilities privately to the repository maintainer. This project does not publish a dedicated security contact yet; arrange a private channel before sharing sensitive details. Do not put credentials, confidential source code, or sensitive exploit details in a public issue.
