import { strict as assert } from 'node:assert';
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import vm from 'node:vm';
import { parse as parseYaml, stringify } from 'yaml';
import { parseCatalog, type Catalog } from '../../src/config.js';

const root = process.cwd();
const examples = ['static-jobs', 'matrix'] as const;
const taskIds = (catalog: Catalog): string[] => Object.keys(catalog.tasks).sort();
const readCatalog = (name: string): Catalog =>
  parseCatalog(readFileSync(resolve(root, 'examples', name, '.github/ci-selector.yml'), 'utf8'));
const readWorkflow = (name: string): Record<string, any> => parseYaml(
  readFileSync(resolve(root, 'examples', name, '.github/workflows/ci.yml'), 'utf8'),
);

function gateScript(workflow: Record<string, any>): string {
  const steps = workflow.jobs['ci-required'].steps as Array<Record<string, unknown>>;
  const step = steps.find((candidate) => typeof candidate.run === 'string' && candidate.run.includes('node <<'));
  assert.ok(step && typeof step.run === 'string', 'ci-required must execute its inline gate');
  return step.run;
}

function planEnv(tasks: string[], selected: string[], result: string = 'success') {
  const run = Object.fromEntries(tasks.map((task) => [task, selected.includes(task)]));
  const matrix = { include: selected.map((task) => ({ task })) };
  const needs: Record<string, { result: string }> = { plan: { result } };
  for (const task of tasks) needs[task] = { result: selected.includes(task) ? 'success' : 'skipped' };
  return {
    EXPECTED_TASKS: tasks.join(','),
    EXPECTED_DEPENDENCIES: 'e2e_network=build;e2e_upgrade=build',
    EXPECTED_ALWAYS: 'build,lint,unit',
    EXPECTED_NEEDS: ['plan', ...tasks].join(','),
    PLAN_RESULT: result,
    PLAN_RUN: JSON.stringify(run),
    PLAN_SELECTED: JSON.stringify(selected),
    PLAN_MATRIX: JSON.stringify(matrix),
    PLAN_HAS_TASKS: selected.length > 0 ? 'true' : 'false',
    PLAN_STATUS: 'planned',
    PLAN_TESTED_SHA: 'a'.repeat(40),
    EXPECTED_TESTED_SHA: 'a'.repeat(40),
    NEEDS_JSON: JSON.stringify(needs),
  };
}

function matrixEnv(tasks: string[], selected: string[], matrixResult: string = 'success') {
  const run = Object.fromEntries(tasks.map((task) => [task, selected.includes(task)]));
  const matrix = { include: selected.map((task) => ({ task })) };
  return {
    EXPECTED_TASKS: tasks.join(','),
    EXPECTED_NEEDS: 'ci-contract,plan,tasks',
    PLAN_RESULT: 'success',
    PLAN_RUN: JSON.stringify(run),
    PLAN_SELECTED: JSON.stringify(selected),
    PLAN_MATRIX: JSON.stringify(matrix),
    PLAN_HAS_TASKS: selected.length > 0 ? 'true' : 'false',
    PLAN_STATUS: 'planned',
    PLAN_TESTED_SHA: 'a'.repeat(40),
    EXPECTED_TESTED_SHA: 'a'.repeat(40),
    NEEDS_JSON: JSON.stringify({ plan: { result: 'success' }, 'ci-contract': { result: 'success' }, tasks: { result: matrixResult } }),
  };
}

function runGate(workflow: Record<string, any>, env: Record<string, string>): { status: number | null; output: string } {
  const shell = gateScript(workflow);
  const marker = "node <<'NODE'\n";
  const start = shell.indexOf(marker);
  assert.notEqual(start, -1, 'gate must contain a Node heredoc');
  const codeStart = start + marker.length;
  const end = shell.indexOf('\nNODE', codeStart);
  assert.notEqual(end, -1, 'gate Node heredoc must be terminated');
  const contextProcess = { env: { ...process.env, ...env }, exitCode: 0 };
  const messages: string[] = [];
  try {
    vm.runInNewContext(codeSlice(shell, codeStart, end), {
      process: contextProcess,
      console: { error: (...parts: unknown[]) => messages.push(parts.join(' ')) },
    });
  } catch (error) {
    messages.push(error instanceof Error ? error.message : String(error));
    contextProcess.exitCode = 1;
  }
  return { status: contextProcess.exitCode, output: messages.join('\n') };
}

function codeSlice(source: string, start: number, end: number): string {
  return source.slice(start, end);
}

test('example catalogs and workflow job IDs have one stable contract', () => {
  for (const name of examples) {
    const catalog = readCatalog(name);
    const workflow = readWorkflow(name);
    const tasks = taskIds(catalog);
    const jobs = workflow.jobs as Record<string, any>;
    const finalNeeds = (Array.isArray(jobs['ci-required'].needs) ? jobs['ci-required'].needs : [jobs['ci-required'].needs]).sort();
    assert.deepEqual(jobs['ci-required'].env.EXPECTED_TASKS.split(',').sort(), tasks);
    assert.match(jobs['ci-required'].env.EXPECTED_NEEDS, /plan/);
    assert.equal(jobs['ci-required'].if, '${{ always() }}');
    assert.ok(jobs.plan.outputs.run && jobs.plan.outputs.selected && jobs.plan.outputs.matrix);
    assert.ok(jobs.plan.outputs['has-tasks'] && jobs.plan.outputs['tested-sha']);
    assert.ok(jobs.plan.steps.every((step: Record<string, unknown>) => !('uses' in step && String(step.uses).startsWith('actions/checkout@'))), 'planning must not checkout PR code');
    const selector = jobs.plan.steps.find((step: Record<string, unknown>) => step.id === 'select') as Record<string, any>;
    assert.equal(selector.if, "${{ github.event_name == 'pull_request' }}");
    assert.equal(selector.uses, 'OWNER/jev-ci-selector@0000000000000000000000000000000000000000');
    assert.deepEqual(selector.with, {
      config: '.github/ci-selector.yml',
      mode: 'shadow',
      'github-token': '${{ secrets.GITHUB_TOKEN }}',
      'api-key': '${{ secrets.JEV_API_KEY }}',
      'allow-external-context': 'true',
      'force-all': 'false',
    });
    assert.match(String(jobs.plan.steps.find((step: Record<string, unknown>) => step.id === 'full')?.if), /!= 'pull_request'/);
    assert.match(readFileSync(resolve(root, 'examples', name, '.github/workflows/ci.yml'), 'utf8'), /tested-sha/);
    assert.match(readFileSync(resolve(root, 'examples', name, '.github/workflows/ci.yml'), 'utf8'), /11bd71901bbe5b1630ceea73d27597364c9af683/);

    if (name === 'static-jobs') {
      assert.deepEqual(Object.keys(jobs).filter((id) => !['plan', 'ci-required'].includes(id)).sort(), tasks);
      assert.deepEqual(finalNeeds, ['build', 'e2e_network', 'e2e_upgrade', 'helm', 'lint', 'plan', 'unit']);
      for (const task of tasks) {
        const needs = Array.isArray(jobs[task].needs) ? jobs[task].needs : [jobs[task].needs];
        assert.ok(needs.includes('plan'), `${task} must depend on plan`);
        for (const dependency of catalog.tasks[task]?.requires ?? []) assert.ok(needs.includes(dependency), `${task} must depend on ${dependency}`);
      }
      assert.match(jobs['ci-required'].env.NEEDS_JSON, /toJSON\(needs\)/);
      assert.ok(jobs.lint.steps.some((step: Record<string, any>) => step.run === 'node .github/ci-selector-validate.cjs .' && !step.if));
      assert.equal(catalog.tasks.lint!.always, true);
    } else {
      assert.deepEqual(Object.keys(jobs).filter((id) => !['plan', 'ci-required', 'ci-contract'].includes(id)), ['tasks']);
      assert.deepEqual(finalNeeds, ['ci-contract', 'plan', 'tasks']);
      assert.ok(jobs['ci-contract'].steps.some((step: Record<string, any>) => step.run === 'node .github/ci-selector-validate.cjs .' && !step.if));
      assert.ok(jobs.tasks.needs.includes('ci-contract'));
      assert.match(jobs.tasks.if, /has-tasks/);
      assert.match(jobs.tasks.steps[1].run, /unsupported task/);
      const launcher = String(jobs.tasks.steps[1].run);
      for (const task of tasks) assert.match(launcher, new RegExp(`\\b${task}\\)`), `${task} must have a fixed launcher case`);
      for (const [task, definition] of Object.entries(catalog.tasks)) {
        for (const dependency of definition.requires ?? []) {
          assert.ok(catalog.tasks[dependency], `${task} requires an unknown catalog task`);
          assert.match(launcher, new RegExp(`(?:${task}|${dependency})`), `${task} dependency must be represented by the launcher contract`);
        }
      }
      assert.doesNotMatch(readFileSync(resolve(root, 'examples', name, '.github/workflows/ci.yml'), 'utf8'), /continue-on-error/);
    }
    for (const task of tasks) assert.match(readFileSync(resolve(root, 'examples', name, '.github/workflows/ci.yml'), 'utf8'), new RegExp(`['"]?${task}['"]?`));
  }
});

test('static ci-required rejects planner, plan-shape, selected-job, and dependency failures', () => {
  const workflow = readWorkflow('static-jobs');
  const tasks = taskIds(readCatalog('static-jobs'));
  const all = tasks;

  assert.equal(runGate(workflow, planEnv(tasks, all)).status, 0, 'full successful CI must pass');
  assert.equal(runGate(workflow, planEnv(tasks, ['build', 'lint', 'unit'])).status, 0, 'valid selective CI must pass');

  assert.notEqual(runGate(workflow, planEnv(tasks, all, 'failure')).status, 0, 'planner failure must fail the gate');

  const malformed = planEnv(tasks, all);
  malformed.PLAN_RUN = '{';
  assert.notEqual(runGate(workflow, malformed).status, 0, 'malformed plan must fail the gate');

  const selectedSkipped = planEnv(tasks, all);
  selectedSkipped.NEEDS_JSON = JSON.stringify({
    plan: { result: 'success' },
    ...Object.fromEntries(tasks.map((task) => [task, { result: task === 'build' ? 'skipped' : 'success' }])),
  });
  assert.notEqual(runGate(workflow, selectedSkipped).status, 0, 'a selected skipped job must fail the gate');

  const dependency = planEnv(tasks, ['e2e_network']);
  assert.notEqual(runGate(workflow, dependency).status, 0, 'a selected e2e job without its build must fail the gate');

  assert.notEqual(runGate(workflow, planEnv(tasks, [])).status, 0, 'static mandatory tasks cannot all be skipped');

  const fallbackSelective = planEnv(tasks, ['build', 'lint', 'unit']);
  fallbackSelective.PLAN_STATUS = 'fallback';
  assert.notEqual(runGate(workflow, fallbackSelective).status, 0, 'fallback must select every task');

  const invalidBoolean = planEnv(tasks, ['build', 'lint', 'unit']);
  invalidBoolean.PLAN_RUN = JSON.stringify({ ...JSON.parse(invalidBoolean.PLAN_RUN), helm: 'false' });
  assert.notEqual(runGate(workflow, invalidBoolean).status, 0, 'run values must be booleans');

  const invalidHasTasks = planEnv(tasks, ['build', 'lint', 'unit']);
  invalidHasTasks.PLAN_HAS_TASKS = 'garbage';
  assert.notEqual(runGate(workflow, invalidHasTasks).status, 0, 'has-tasks must be an exact boolean string');
});

test('matrix ci-required accepts an empty matrix and rejects matrix failures and divergence', () => {
  const workflow = readWorkflow('matrix');
  const tasks = taskIds(readCatalog('matrix'));
  const empty = runGate(workflow, matrixEnv(tasks, [], 'skipped'));
  assert.equal(empty.status, 0, `empty matrix is a valid no-task plan: ${empty.output}`);
  for (const invalidSelected of [null, {}, false, 'invalid']) {
    const invalid = matrixEnv(tasks, [], 'skipped');
    invalid.PLAN_SELECTED = JSON.stringify(invalidSelected);
    assert.notEqual(runGate(workflow, invalid).status, 0, 'a malformed selected value must not become an empty successful plan');
  }
  assert.equal(runGate(workflow, matrixEnv(tasks, ['build', 'lint'])).status, 0);
  assert.notEqual(runGate(workflow, matrixEnv(tasks, ['build'], 'failure')).status, 0, 'matrix failure must fail the gate');
  for (const result of ['failure', 'skipped', 'cancelled']) {
    const invalidContract = matrixEnv(tasks, [], 'skipped');
    const needs = JSON.parse(invalidContract.NEEDS_JSON); needs['ci-contract'].result = result;
    invalidContract.NEEDS_JSON = JSON.stringify(needs);
    assert.notEqual(runGate(workflow, invalidContract).status, 0, 'even empty matrices require successful contract validation');
  }

  const extraMatrixItem = matrixEnv(tasks, ['build']);
  extraMatrixItem.PLAN_MATRIX = JSON.stringify({ include: [{ task: 'build', extra: true }] });
  assert.notEqual(runGate(workflow, extraMatrixItem).status, 0, 'matrix entries must have only task');

  const bypassedSelective = matrixEnv(tasks, ['build']);
  bypassedSelective.PLAN_STATUS = 'bypassed';
  assert.notEqual(runGate(workflow, bypassedSelective).status, 0, 'bypassed must select every task');

  const divergence = matrixEnv(tasks, ['build']);
  divergence.PLAN_RUN = JSON.stringify({ build: true, lint: false, unit: false, unexpected: false });
  assert.notEqual(runGate(workflow, divergence).status, 0, 'catalog/output divergence must fail the gate');
});

test('standalone consumer validator catches unknown jobs, incomplete final needs and dependent matrices', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'jev-workflow-contract-'));
  try {
    mkdirSync(resolve(directory, '.github/workflows'), { recursive: true });
    const validatorPath = resolve(directory, '.github/ci-selector-validate.cjs');
    copyFileSync(resolve(root, 'dist/validate.cjs'), validatorPath);
    const check = (name: string, mutate?: (workflow: Record<string, any>, catalog: Catalog) => void) => {
      const workflow = readWorkflow(name), catalog = readCatalog(name);
      mutate?.(workflow, catalog);
      writeFileSync(resolve(directory, '.github/workflows/ci.yml'), stringify(workflow));
      writeFileSync(resolve(directory, '.github/ci-selector.yml'), stringify(catalog));
      return spawnSync(process.execPath, [validatorPath, directory], { encoding: 'utf8' });
    };
    for (const name of examples) assert.equal(check(name).status, 0, 'validator works at any consumer path');
    assert.notEqual(check('static-jobs', workflow => { workflow.jobs.unknown = { needs: 'plan' }; }).status, 0);
    assert.notEqual(check('matrix', workflow => { workflow.jobs.unknown = { needs: 'plan' }; }).status, 0);
    assert.notEqual(check('static-jobs', workflow => {
      workflow.jobs['ci-required'].needs = workflow.jobs['ci-required'].needs.filter((id: string) => id !== 'helm');
      workflow.jobs['ci-required'].env.EXPECTED_NEEDS = workflow.jobs['ci-required'].env.EXPECTED_NEEDS.replace('helm,', '');
    }).status, 0);
    assert.notEqual(check('static-jobs', workflow => { workflow.jobs.e2e_network.needs = ['plan']; }).status, 0);
    assert.notEqual(check('matrix', (_workflow, catalog) => { catalog.tasks.e2e_network!.requires = ['build']; }).status, 0);
    assert.notEqual(check('matrix', (workflow, catalog) => {
      catalog.tasks.extra = { question: 'Does this affect storage?' };
      workflow.jobs['ci-required'].env.EXPECTED_TASKS = Object.keys(catalog.tasks).sort().join(',');
    }).status, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
