import Ajv from 'ajv';
import { parseDocument } from 'yaml';
import schema from '../schemas/config.schema.json';

export interface Task {
  always?: boolean;
  force_paths?: string[];
  requires?: string[];
  question?: string;
}
export interface Catalog {
  version: 1;
  model: string;
  skip_below: number;
  force_all_paths?: string[];
  tasks: Record<string, Task>;
}

export class ConfigError extends Error {
  constructor() { super('invalid-catalog'); }
}

const reservedTaskIds = new Set(schema.definitions.taskId.not.enum.map(id => id.toLowerCase()));
const validate = new Ajv({ allErrors: true, strict: true }).compile<Catalog>(schema);

export function validateCatalog(value: unknown): asserts value is Catalog {
  if (!validate(value)) throw new ConfigError();
  const catalog = value;
  // GitHub step outputs use case-insensitive keys. Reject collisions before any plan exists.
  const outputIds = new Set<string>();
  for (const id of Object.keys(catalog.tasks)) {
    const outputId = id.toLowerCase();
    if (reservedTaskIds.has(outputId) || outputIds.has(outputId)) throw new ConfigError();
    outputIds.add(outputId);
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  function visit(id: string): void {
    if (active.has(id) || !Object.hasOwn(catalog.tasks, id)) throw new ConfigError();
    if (visited.has(id)) return;
    active.add(id);
    for (const dependency of catalog.tasks[id]!.requires ?? []) visit(dependency);
    active.delete(id);
    visited.add(id);
  }
  for (const id of Object.keys(catalog.tasks)) visit(id);
}

export function parseCatalog(source: string): Catalog {
  try {
    const document = parseDocument(source, { uniqueKeys: true, strict: true });
    if (document.errors.length || document.warnings.length) throw new ConfigError();
    // Aliases and merge keys are unnecessary for this deliberately small contract.
    const value: unknown = document.toJS({ maxAliasCount: 0 });
    validateCatalog(value);
    return value;
  } catch { throw new ConfigError(); }
}

export function validateConfigPath(path: string): void {
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\0') ||
      path.split('/').some(part => !part || part === '.' || part === '..')) throw new ConfigError();
}
