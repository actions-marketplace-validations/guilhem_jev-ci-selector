# Static jobs example

Copy `.github/ci-selector.yml` and `.github/workflows/ci.yml` into a Go and
Helm repository that provides the commands referenced by the workflow. The
workflow is an illustrative consumer: `./ci/e2e-network.sh` and
`./ci/e2e-upgrade.sh` are expected to be supplied by that repository.
Also copy the bundled `dist/validate.cjs` from this project to
`.github/ci-selector-validate.cjs` in the consumer. It includes its dependencies.

Before enabling it, replace the visibly documented
`OWNER/jev-ci-selector@0000000000000000000000000000000000000000` placeholder
with the reviewed immutable action SHA. Set `JEV_API_KEY` only when
the diff, paths, and task questions may be sent to TypeSafe; this is an
explicit authorization decision.

The selector runs only for `pull_request`. Push, schedule, and merge-group
events synthesize a full plan without invoking semantic selection. Every PR
consumer checks out `tested-sha` (the merge commit supplied by GitHub).

Run `node examples/validate.mjs examples/static-jobs` from the repository root
to check the catalog, job IDs, final `needs`, and dependency wiring. Run the
repository integration tests with `npm test`. They parse this
catalog and workflow, check task/dependency parity, and execute the inline
`ci-required` gate against malformed plans, empty selections, skipped
selections, dependency failures, and job divergence.

The supplied mandatory `lint` job runs `node .github/ci-selector-validate.cjs .`
before linting. Its failure blocks `ci-required`; missing or unknown workflow
jobs therefore cannot disappear silently. Keep this step and `lint.always: true`.
The validator stays outside the planning job. Go, Helm and any cluster tooling
used by the consumer-owned e2e scripts must be installed by your normal task setup.
