import { APITimeoutError, noul, TypeSafeClient, type EntryType } from '@typesafe-ai/sdk';
import type { Catalog } from './config.js';

export interface Usage { input_tokens: number; output_tokens: number }
export interface JevMetadata { model: string | null; usage: Usage | null }
export interface JevResult extends JevMetadata { probabilities: Record<string, number> }
export class JevError extends Error {
  constructor(public readonly code: 'jev-timeout' | 'jev-error' | 'invalid-response',
    public readonly metadata: JevMetadata = { model: null, usage: null }) { super(code); }
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function validateJevResponse(value: unknown, taskIds: string[], requestedModel: string): JevResult {
  const model = record(value) && typeof value.model === 'string' && /^jev-\d+\.\d+\.\d+$/.test(value.model) ? value.model : null;
  let usage: Usage | null = null;
  if (record(value) && record(value.usage)) {
    const { input_tokens, output_tokens } = value.usage;
    if (Number.isSafeInteger(input_tokens) && Number.isSafeInteger(output_tokens) &&
      (input_tokens as number) >= 0 && (output_tokens as number) >= 0) {
      usage = { input_tokens: input_tokens as number, output_tokens: output_tokens as number };
    }
  }
  const metadata = { model, usage };
  if (!record(value) || model !== requestedModel || !usage || !record(value.answers) ||
    Object.keys(value.answers).sort().join('\0') !== [...taskIds].sort().join('\0')) throw new JevError('invalid-response', metadata);
  const probabilities: Record<string, number> = {};
  for (const id of [...taskIds].sort()) {
    const answer = value.answers[id];
    if (!record(answer) || answer.type !== 'noul' || typeof answer.noul !== 'number' ||
      !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) throw new JevError('invalid-response', metadata);
    probabilities[id] = answer.noul;
  }
  return { probabilities, ...metadata };
}

export async function evaluateJev(input: {
  catalog: Catalog; taskIds: string[]; state: EntryType; apiKey: string; timeoutMs: number;
}, fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>): Promise<JevResult> {
  const { catalog, taskIds, state, apiKey, timeoutMs } = input;
  if (!taskIds.length) throw new Error('empty-jev-request');
  const questions = Object.fromEntries([...taskIds].sort().map(id => [id, noul(catalog.tasks[id]!.question!)]));
  // Explicit settings prevent SDK environment variables from redirecting data or enabling body logs.
  const client = new TypeSafeClient({ apiKey, baseURL: 'https://api.typesafe.ai',
    defaultModel: catalog.model, logLevel: 'off', retry: { maxRetries: 0 }, timeout: timeoutMs,
    ...(fetchImpl ? { fetch: fetchImpl } : {}) });
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const response: unknown = await client.systemOne({ model: catalog.model, state, questions },
      { signal, timeout: timeoutMs, retry: { maxRetries: 0 } });
    return validateJevResponse(response, taskIds, catalog.model);
  } catch (error) {
    if (error instanceof JevError) throw error;
    throw new JevError(error instanceof APITimeoutError || signal.aborted ? 'jev-timeout' : 'jev-error');
  }
}
