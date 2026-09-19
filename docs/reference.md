# Action reference

[← Back to the README](../README.md) · [Shadow mode guide](shadow-mode.md) · [Security](../SECURITY.md)

`jev-ci-selector` produces a CI task selection plan. It does not execute tasks, generate commands, discover tests, or create a dynamic GitHub Actions job graph. Consumers own runners, secrets, commands, and execution order.

## Inputs

| Input | Default | Purpose |
| --- | --- | --- |
| `config` | `.github/ci-selector.yml` | Repository-relative path to the trusted catalog |
| `mode` | `shadow` | `shadow` records a proposal; `enforce` applies it |
| `github-token` | `${{ github.token }}` | Fetch immutable Git objects with `contents: read` |
| `api-key` | Empty | TypeSafe API key; no key means full CI without Jev |
| `allow-external-context` | `false` | Explicit permission to send the diff and metadata to TypeSafe |
| `force-all` | `false` | Immediately bypass selection and keep every task |
| `timeout-ms` | `10000` | Maximum duration of one Jev request, without retries |
| `max-diff-bytes` | `65536` | Maximum complete UTF-8 diff size; not a token count |

Boolean inputs accept only `true` and `false`. Quote them as strings in workflow YAML. Budgets must be positive integers; the timeout cannot exceed Node's timer limit of `2147483647` ms. `config` must be a relative path within the repository.

## Outputs

All output values are strings. Parse JSON outputs with `fromJSON(...)` in GitHub Actions expressions. Task keys and arrays use stable identifier order.

| Output | Content |
| --- | --- |
| `run` | JSON object with an effective boolean for every catalog task |
| `selected` | JSON array of effective task IDs |
| `matrix` | JSON object shaped as `{"include":[{"task":"…"}]}` |
| `has-tasks` | `"true"` or `"false"`; check at job level before matrix expansion |
| `status` | `planned`, `bypassed`, or `fallback` |
| `tested-sha` | Immutable commit that consumer jobs must test |
| `report-path` | Local path to the detailed JSON report on the planning runner |

In `shadow`, `run`, `selected`, and `matrix` always include every task, even when the proposal is empty. The hypothetical selection appears only in `tasks.*.proposed_run` in the report.

`enforce` applies the selection after adding mandatory tasks and transitive dependencies. Changing to this mode is an explicit consumer decision.

## Catalog rules

The [JSON Schema](../schemas/config.schema.json) defines the complete format. Version `1` requires an explicitly versioned model such as `jev-1.13.0`, a `skip_below` threshold in `[0, 1]`, and a `tasks` object. Model aliases are rejected.

| Field | Effect |
| --- | --- |
| `always: true` | Keep this task regardless of Jev's assessment |
| `run_if_paths` | Keep the task when any changed path matches; no match leaves it eligible for semantic evaluation |
| `requires` | Include these tasks, transitively, whenever this task is selected |
| `question` | Ask whether the change affects the functional scope covered by the task |
| `force_all_paths` | Top-level patterns that force every task when matched |

Every task without `always: true` needs a nonempty question. Questions describe affected behavior, rather than predicting test failures. Dependencies already required by deterministic rules do not consume Jev questions.

An optional task may be excluded only when its probability is **strictly below** `skip_below`. Equality keeps the task. The initial `0.05` value is experimental and does not guarantee an error rate.

### Paths

Patterns use `minimatch` with hidden files included and with negation and comments disabled. Paths are relative, case-sensitive, and use `/` separators. Renames include both old and new paths.

The exact configured catalog path and every path under `.github/workflows/` always force full CI, independently of `force_all_paths`.

### Validation

Duplicate YAML keys, aliases, unknown properties, nonexistent or cyclic dependencies, and tasks without a usable rule are rejected. Identifiers follow `[A-Za-z_][A-Za-z0-9_-]{0,63}`. Reserved IDs include `plan`, `ci-required`, `ci-contract`, `tasks`, `prototype`, and names inherited from `Object.prototype`; the schema lists them all.

An empty catalog is valid and produces `has-tasks: 'false'`. A missing, unreadable, or invalid catalog is a planner failure, because the action cannot identify what “all tasks” means.

`requires` controls selection only. Declare the real execution dependencies with `needs` in your workflow. A matrix does not schedule these dependencies; use independent tasks or separately executed common prerequisites.

## Status and failure behavior

| Situation | Status | Result |
| --- | --- | --- |
| Selection calculated, including an entirely deterministic plan | `planned` | Apply the chosen mode |
| `force-all`, fork PR, missing key, or no external-context permission | `bypassed` | All tasks; no Jev call |
| Protected catalog/workflow path or configured force-all path | `bypassed` | All tasks; no Jev call |
| Non-PR event | `bypassed` | All tasks; examples bypass the action itself |
| Timeout, API/network error, rate limit, or invalid/partial response | `fallback` | All tasks |
| Incomplete, oversized, incoherent, or unsupported diff | `fallback` | All tasks |
| Missing or invalid catalog; inconsistent catalog dependencies | No valid plan | Planner fails |
| Internal error preventing a coherent plan | No valid plan | Planner fails |

A fallback is a valid full plan. The final `ci-required` gate must reject a failed planner or invalid plan, and must verify that every selected task actually succeeded.

## Commit and diff collection

For a pull request, the event fixes all four SHA values:

```text
config_sha = event.pull_request.base.sha
base_sha   = event.pull_request.base.sha
head_sha   = event.pull_request.head.sha
tested_sha = GITHUB_SHA

diff = base_sha → tested_sha
```

The catalog comes from the **base Git object**, never from the PR's edited copy. The tested commit must have exactly `[base_sha, head_sha]` as its two parents. Branch names are never silently resolved to their latest state, so an older run remains tied to its own event.

If required objects can no longer be fetched, the action keeps all tasks, or fails if the trusted catalog itself is unavailable. Consumer jobs must check out `tested-sha`.

Collection uses a temporary bare Git repository, argument arrays, and exact-SHA fetches with depth `1`. There is no checkout, submodule initialization, dependency installation, or execution of project scripts. External diff programs, text conversion, hooks, and external Git configuration are disabled.

Additions, deletions, renames, and mode changes are included. Binary content, changed gitlinks, invalid UTF-8, and incomplete or oversized output force full CI. A truncated diff is never used to justify skipping a task. When a bypass is known before collection, no diff hash is invented.

Implementation limits also cap the catalog at 1 MiB (a blocking error), Git metadata at 4 MiB, and each inspected blob at 16 MiB (full CI if collection cannot complete).

## Jev request

The official `@typesafe-ai/sdk` calls `TypeSafeClient.systemOne()` with a shared state and one independent `noul()` question per remaining task. A `noul` returns a probability of an affirmative answer; there is no separate confidence field.

The action uses one request, `maxRetries: 0`, disabled SDK logs, and a fixed endpoint. It validates the exact expected IDs, `noul` types, finite probabilities in `[0, 1]`, the returned model version, and API usage. A missing or invalid answer causes a global fallback.

The byte limit is not a token budget. TypeSafe also limits the state and the complete request, including all questions. A provider rejection keeps every task.

The diff remains untrusted input. Keeping questions in the base catalog does not guarantee prompt-injection resistance. Essential checks should remain mandatory. See [Security](../SECURITY.md).

## Report

The [report schema](../schemas/report.schema.json) covers:

- Catalog, base, head, and tested SHAs; SHA-256 catalog and diff hashes.
- Mode, status, requested/returned model versions, collection/API/total durations, and validated API usage.
- Diff byte size, changed-path count, and each task's probability, proposal, effective decision, and reason codes.

Unavailable probabilities, proposals, and metadata use `null`. No score is invented for a task that was not evaluated. Reasons are deterministic codes generated by the action, not model explanations.

The report excludes source code, changed file paths, questions, API keys, and raw error bodies. It is local to the planning runner; passing its path as an output does not transfer the file to another job. Choose artifact visibility and retention deliberately.

## Development

Use Node.js 24 and Git. Dependencies are locked in `package-lock.json`.

```sh
npm ci --ignore-scripts
npm run build
npm run check
```

The normal test suite requires no TypeSafe key or service access. It covers pure selection, mocked HTTP, real temporary Git repositories, bundle execution, and the final gates extracted from the example workflows. `check:dist` rebuilds in memory and compares both distributed bundles and their dependency licenses byte for byte.

| Module | Responsibility |
| --- | --- |
| `src/config.ts` | Parse and strictly validate the catalog |
| `src/changes.ts` | Fetch Git objects and collect a complete diff |
| `src/policy.ts` | Pure deterministic selection with no I/O |
| `src/jev.ts` | Adapt and validate the SDK request/response |
| `src/planner.ts` | Orchestrate collection, evaluation, and failure policy |
| `src/report.ts` | Validate reports and serialize outputs and summaries |
| `src/action.ts` | Read action inputs and publish the validated plan |
| `scripts/analyze-shadow.mjs` | Compare shadow proposals with actual task results |

`dist/index.js` and `dist/validate.cjs` ship with their source. Rebuild and commit them together when their inputs change. Mocked tests do not validate the real TypeSafe service. A live test requires a separate, explicitly authorized call using a nonsensitive diff; a successful API call alone does not justify enabling `enforce`.

## Upstream documentation

- TypeSafe: [JavaScript SDK](https://docs.typesafe.ai/sdk/javascript), [Noul](https://docs.typesafe.ai/primitives/noul), [models and limits](https://docs.typesafe.ai/models), [adversarial-input limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13).
- GitHub: [events and merge commits](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request), [matrices](https://docs.github.com/en/actions/using-jobs/using-a-matrix-for-your-jobs), [job conditions](https://docs.github.com/en/actions/using-jobs/using-conditions-to-control-job-execution), [security](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions), [action metadata and runtime](https://docs.github.com/en/actions/reference/workflows-and-actions/metadata-syntax).
- Git: [diff options](https://git-scm.com/docs/git-diff).
