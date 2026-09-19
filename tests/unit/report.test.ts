import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectTasks, REASONS } from '../../src/policy.js';
import { actionOutputs, validateReport, summary } from '../../src/report.js';
import schema from '../../schemas/report.schema.json';
import { catalog } from '../fixtures/catalog.js';

test('report schema covers every deterministic reason and rejects arbitrary publishable data', () => {
  assert.deepEqual([...schema.properties.tasks.additionalProperties.properties.reasons.items.enum].sort(), [...REASONS].sort());
  const plan = selectTasks({ catalog: catalog(), changedPaths: [], mode: 'shadow', forceAllReason: { status: 'bypassed', code: 'missing-api-key' } });
  const report = { version: 1, config_sha: 'a'.repeat(40), base_sha: 'a'.repeat(40), head_sha: 'b'.repeat(40), tested_sha: 'c'.repeat(40),
    catalog_hash: 'd'.repeat(64), diff_hash: null, diff_bytes: null, changed_path_count: null,
    mode: 'shadow', status: 'bypassed', model: { requested: 'jev-1.13.0', returned: null },
    durations_ms: { collection: 1, jev: null, total: 1 }, usage: null, tasks: plan.tasks };
  validateReport(report);
  assert.throws(() => validateReport({ ...report, diff: 'private source' }));
  assert.throws(() => validateReport({ ...report, usage: { input_tokens: 1, output_tokens: 1, raw: 'private error' } }));
  assert.throws(() => validateReport({ ...report, tasks: { unit: { ...plan.tasks.unit, reasons: ['generated explanation'] } } }));
  assert.match(summary(report), /missing-api-key/);
  const outputs = actionOutputs(plan, report.tested_sha, '/tmp/report.json');
  assert.deepEqual(Object.keys(outputs), ['run', 'selected', 'matrix', 'has-tasks', 'status', 'tested-sha', 'report-path']);
  assert.ok(Object.values(JSON.parse(outputs.run!)).every(value => value === true));
  assert.ok(Object.values(plan.tasks).every(task => task.probability === null && task.proposed_run === null));
});
