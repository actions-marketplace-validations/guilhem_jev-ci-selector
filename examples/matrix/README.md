# Matrix example

Copy `.github/ci-selector.yml` and `.github/workflows/ci.yml` into a Go and
Helm repository that provides the commands referenced by the workflow. The
two e2e shell scripts are consumer-owned examples.
Also copy the bundled `dist/validate.cjs` from this project to
`.github/ci-selector-validate.cjs` in the consumer. No npm installation is needed.

Replace the visibly documented
`OWNER/jev-ci-selector@0000000000000000000000000000000000000000` placeholder
with the published immutable action SHA before enabling the workflow. The
external context transfer is explicitly authorized in the action input:
`allow-external-context: true`, authorizing the diff, paths, and task questions
to be sent to TypeSafe.

The matrix launcher validates a fixed shell allowlist and fails unsupported
task IDs. Its `has-tasks` condition is evaluated before matrix expansion, so a
valid empty selection skips the matrix and is accepted by `ci-required`.
Selected matrix failures remain failures; there is no `continue-on-error`.
Push, schedule, and merge-group events synthesize a full plan, while only
`pull_request` invokes the published selector action.

Run `node examples/validate.mjs examples/matrix` from the repository root to
check the catalog, job IDs, final `needs`, and fixed launcher allowlist. Run
`npm test` to parse the catalog and workflow, validate catalog/launcher
consistency, and execute the inline gate for malformed plans, skipped and
empty matrices, matrix failures, and plan divergence.

The mandatory `ci-contract` job runs the validator at the tested SHA, even for
an empty matrix. Both the task matrix and `ci-required` require its success.
Keep this check outside the planning job. Each matrix task must set up and
build its own prerequisites: a separate `build` matrix entry does not supply
artifacts or ordering to the e2e entries. Go, Helm and cluster tooling belong to
the consumer's normal task setup.
