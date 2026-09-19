# Learn from shadow mode

[← Back to the README](../README.md) · [Action reference](reference.md) · [paths-filter migration](paths-filter.md)

Shadow mode answers a practical question: **what would this policy have skipped, and what happened when those tasks actually ran?** All effective outputs remain complete, so you can collect evidence before changing execution.

The direct output for every task is the exact string `"true"` in shadow mode; the aggregate `run` map contains boolean `true` values. Only the report records the hypothetical proposal. Unless an `always` or `force_paths` rule or a required dependency fixes the decision, the task remains eligible for Jev regardless of which paths changed. Bypassed and fallback plans also keep every task.

## Collect a matched pair

For each run, keep:

1. The JSON file from `report-path`, saved as an artifact from the planning job.
2. Actual results and durations for every catalog task, from the same workflow run and `tested_sha`.

The report path alone does not move the file between jobs. Do not join an old report with the latest PR state or combine separate attempts just because they share a SHA. The analyzer verifies SHA and task IDs; matching the workflow run or attempt is your responsibility.

For a catalog containing `unit` and `helm`, a `results.json` file could look like this. Replace the SHA placeholder with the report's full `tested_sha`:

```json
{
  "tested_sha": "<same full SHA as the report>",
  "tasks": {
    "unit": { "result": "success", "duration_ms": 15000 },
    "helm": { "result": "failure", "duration_ms": 8000, "classification": "regression" }
  },
  "relevant_tasks": ["helm"]
}
```

Include **exactly** the task IDs in that run's catalog. Results are `success`, `failure`, `skipped`, or `cancelled`; durations are nonnegative milliseconds. Failure classifications are `regression`, `flaky`, `infrastructure`, or `unknown` (the default). The optional `relevant_tasks` array records suites you manually identified as relevant.

## Compare the proposal with reality

From a checkout of this project, with dependencies installed:

```sh
node scripts/analyze-shadow.mjs report.json results.json
```

The analyzer rejects mismatched SHAs, task IDs, or invalid inputs. It returns:

| Field | What it tells you |
| --- | --- |
| `tasks_would_skip` | Tasks the policy proposed excluding |
| `duration_ms_would_skip` | Their summed task durations |
| `failures_would_miss` | Failures among those tasks, grouped by classification |
| `skipped_or_cancelled_would_skip` | Proposed exclusions whose outcomes were not observed |
| `manually_relevant_would_skip` | Manually relevant suites that the policy would exclude |
| `status`, `fallback` | Whether evaluation completed or degraded to full CI |

Task duration is not necessarily elapsed CI time saved: jobs can run in parallel. A skipped or cancelled task is not a successful observation. A passing test is not necessarily an irrelevant test.

## From observation to enforce

Compare results by catalog hash, model version, and suite. Look at proposed savings alongside missed regressions and fallback frequency. Classify flaky tests and infrastructure failures separately, and include changes with manually identified relevant suites.

Enable `enforce` only after an explicit review of that evidence. Keep suites that still need observation under `always: true`, and retain full control runs, especially on non-PR events. There is no universal success threshold or guaranteed error rate for the initial `skip_below: 0.05` setting.

To restore full CI immediately, add `force-all: 'true'` to the selector step or switch back to `mode: shadow`. Keep `ci-required` mandatory throughout the rollout.
