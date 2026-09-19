import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stringify } from 'yaml';
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
    source.replace('always: true', 'run_if_paths: [src/**]'),
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
