import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import ts from 'typescript';

/**
 * Runs SQL against the D1 database through the Wrangler CLI, so operator scripts work the
 * same way locally and against a deployed environment.
 */
export interface D1Target {
  /** `local` (Wrangler's local D1) or a Wrangler environment name such as `staging`. */
  environment: string;
}

const API_ROOT = join(import.meta.dirname, '..', '..');
const require = createRequire(import.meta.url);
const WRANGLER_BIN = join(dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js');

function targetArgs(target: D1Target): string[] {
  return target.environment === 'local' ? ['--local'] : ['--remote', '--env', target.environment];
}

function runWrangler(args: string[]): string {
  const result = spawnSync(process.execPath, [WRANGLER_BIN, 'd1', 'execute', 'DB', ...args], {
    cwd: API_ROOT,
    encoding: 'utf8',
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  if (result.status !== 0) {
    throw new Error(`wrangler d1 execute failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

/** Runs a read-only query and returns its rows. */
export function queryRows<TRow>(target: D1Target, sql: string): TRow[] {
  const output = runWrangler([...targetArgs(target), '--json', '--command', sql]);
  const parsed = JSON.parse(output) as { results: TRow[] }[];
  return parsed.flatMap((entry) => entry.results);
}

/**
 * Executes statements atomically from a temporary file, which is removed afterwards.
 * Statements must already be safely escaped (see `sqlString`).
 */
export function executeStatements(target: D1Target, statements: string[]): void {
  const directory = mkdtempSync(join(tmpdir(), 'hse-d1-'));
  const file = join(directory, 'statements.sql');
  try {
    writeFileSync(file, `${statements.join(';\n')};\n`, 'utf8');
    runWrangler([...targetArgs(target), '--file', file, '--yes']);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Single-quoted SQL string literal. */
export function sqlString(value: string | null): string {
  return value === null ? 'NULL' : `'${value.replace(/'/g, "''")}'`;
}

/** Reads a `vars` value for the target environment from wrangler.jsonc. */
export function readWranglerVar(target: D1Target, name: string): string {
  const path = join(API_ROOT, 'wrangler.jsonc');
  // TypeScript's JSONC parser understands the comments and trailing commas in wrangler.jsonc.
  const parsed = ts.parseConfigFileTextToJson(path, readFileSync(path, 'utf8'));
  if (parsed.error) throw new Error('wrangler.jsonc could not be parsed');

  interface WranglerVars {
    vars?: Record<string, unknown>;
    env?: Record<string, { vars?: Record<string, unknown> }>;
  }
  const config = parsed.config as WranglerVars;
  const vars =
    target.environment === 'local' ? config.vars : config.env?.[target.environment]?.vars;
  const value = vars?.[name];
  if (typeof value !== 'string') {
    throw new Error(`${name} is not set for "${target.environment}" in wrangler.jsonc`);
  }
  return value;
}
