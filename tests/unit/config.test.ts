import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stringify, parse } from 'yaml';
import { readFileSync } from 'node:fs';
import { parseCatalog, validateCatalog, validateConfigPath, ConfigError } from '../../src/config.js';
import { catalog } from '../fixtures/catalog.js';

test('catalog parses strictly and preserves zero threshold', () => {
  const value = catalog(); value.skip_below = 0;
  assert.deepEqual(parseCatalog(stringify(value)), value);
});
test('duplicates, aliases, unknown fields, invalid IDs, versions, models and tasks are fatal', () => {
  const source = stringify(catalog());
  for (const invalid of [source + 'version: 1\n', 'version: 1\ntasks: {unit: {}, unit: {}}',
    source.replace('always: true', 'always: true\n    surprise: true'),
    source.replace('unit:', '__proto__:'), source.replace('unit:', 'plan:'), source.replace('unit:', 'ci-contract:'),
    source.replace('unit:', 'bad.id:'), source.replace('version: 1', 'version: 2'),
    source.replace('jev-1.13.0', 'jev-latest'), source + 'unknown: true',
    source.replace('always: true', 'always: false'), source.replace('always: true', 'requires: [build]'),
    source.replace('always: true', 'force_paths: [src/**]'),
    source.replace('always: true', 'question: "   "'), source.replace('0.05', '1.01'),
    source.replace('0.05', '-0.01'), source.replace('0.05', '.nan'),
    source.replace('unit:', 'unit: &anchor').replace('helm:', 'helm: *anchor\n  other:'),
  ]) assert.throws(() => parseCatalog(invalid), ConfigError);
});
test('unknown and cyclic dependencies rejected, including self and disconnected cycles', () => {
  for (const requires of [['absent'], ['e2e']]) {
    const value = catalog(); value.tasks.e2e!.requires = requires;
    assert.throws(() => validateCatalog(value), ConfigError);
  }
  const value = catalog(); value.tasks.prepare!.requires = ['e2e'];
  assert.throws(() => validateCatalog(value), ConfigError);
});
test('only literal relative catalog paths and positive glob patterns', () => {
  for (const path of ['/tmp/policy', '../policy', 'x/../policy', './policy', 'x//policy', 'x\\y', 'x\0y']) {
    assert.throws(() => validateConfigPath(path), ConfigError);
  }
  validateConfigPath('policy/catalog.yml');
  for (const pattern of ['!src/**', '/src/**', '../src/**']) {
    const value = catalog(); value.force_all_paths = [pattern];
    assert.throws(() => validateCatalog(value), ConfigError);
  }
});

test('force_paths is the only supported task path rule', () => {
  const source = `version: 1
model: jev-1.13.0
skip_below: 0.05
tasks:
  helm:
    question: Does this change affect chart rendering?
    force_paths: [charts/**/values.schema.json]
`;
  assert.doesNotThrow(() => parseCatalog(source));
  assert.throws(() => parseCatalog(source.replace('force_paths:', 'run_if_paths:')), ConfigError);
  assert.throws(() => parseCatalog(source.replace('    question: Does this change affect chart rendering?\n', '')), ConfigError);
});

test('task outputs cannot collide with standard outputs or another task regardless of case', () => {
  const metadata = parse(readFileSync('action.yml', 'utf8'));
  for (const name of [...Object.keys(metadata.outputs), 'constructor', 'plan', 'ci-required', 'ci-contract']) {
    for (const id of [name, name.toUpperCase()]) {
      const value = catalog(); value.tasks = { [id]: { always: true } };
      assert.throws(() => validateCatalog(value), ConfigError, `reserved output/task ID: ${id}`);
    }
  }
  const value = catalog(); value.tasks.Helm = { always: true };
  assert.throws(() => validateCatalog(value), ConfigError, 'GitHub output lookup is case-insensitive');
  value.tasks = { Helm: { always: true }, 'e2e-network': { always: true } };
  assert.doesNotThrow(() => validateCatalog(value), 'distinct output IDs retain their spelling');
});
