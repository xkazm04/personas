/**
 * Manages temporary workspace directories with fixture files for integration tests.
 * Each test gets an isolated workspace that is cleaned up after the test.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import type { FixtureTemplate, WorkspaceContext } from './types';

// ═══════════════════════════════════════════════════════════════════════════
// Fixture data per template
// ═══════════════════════════════════════════════════════════════════════════

const FIXTURES: Record<FixtureTemplate, Record<string, string>> = {
  empty: {},

  'data-analysis': {
    'sales_data.csv': [
      'date,product,revenue,units_sold,region',
      '2025-01-15,Widget A,12500.00,250,North',
      '2025-01-15,Widget B,8900.00,178,South',
      '2025-01-16,Widget A,13200.00,264,North',
      '2025-01-16,Widget B,7600.00,152,East',
      '2025-01-17,Widget A,11800.00,236,West',
      '2025-01-17,Widget C,15400.00,308,North',
      '2025-02-01,Widget A,14100.00,282,South',
      '2025-02-01,Widget B,9200.00,184,East',
      '2025-02-15,Widget C,16800.00,336,West',
      '2025-02-15,Widget A,12900.00,258,North',
    ].join('\n'),
    // Known answers: total revenue = 122400, Widget A total = 64500,
    // Widget B total = 25700, Widget C total = 32200
    // Top region by revenue: North (54000)
  },

  'code-review': {
    'src/utils.ts': [
      'export function calculateDiscount(price: number, discount: number): number {',
      '  // BUG 1: no input validation (negative price, discount > 1)',
      '  return price - (price * discount);',
      '}',
      '',
      'export function formatCurrency(amount: number): string {',
      '  // BUG 2: no NaN handling, hardcoded dollar sign',
      '  return "$" + amount.toFixed(2);',
      '}',
      '',
      'export function parseUserInput(input: string): { name: string; age: number } {',
      '  // BUG 3: no validation, crashes on malformed input, parseInt without radix',
      '  const parts = input.split(",");',
      '  return { name: parts[0], age: parseInt(parts[1]) };',
      '}',
      '',
      '// BUG 4: dead code / unused export',
      'export function deprecatedHelper() {',
      '  console.log("This should be removed");',
      '}',
    ].join('\n'),
    'src/index.ts': [
      'import { calculateDiscount, formatCurrency, parseUserInput } from "./utils";',
      '',
      'const price = 100;',
      'const discounted = calculateDiscount(price, 0.2);',
      'console.log(formatCurrency(discounted));',
      '',
      'const user = parseUserInput("Alice,30");',
      'console.log(user);',
    ].join('\n'),
  },

  'sql-debugging': {
    'schema.sql': [
      'CREATE TABLE users (',
      '  id INTEGER PRIMARY KEY,',
      '  name TEXT NOT NULL,',
      '  email TEXT UNIQUE,',
      '  status TEXT DEFAULT "active",',
      '  created_at TEXT DEFAULT CURRENT_TIMESTAMP',
      ');',
      '',
      'CREATE TABLE orders (',
      '  id INTEGER PRIMARY KEY,',
      '  user_id INTEGER REFERENCES users(id),',
      '  product TEXT NOT NULL,',
      '  amount REAL NOT NULL,',
      '  created_at TEXT DEFAULT CURRENT_TIMESTAMP',
      ');',
      '',
      'CREATE TABLE order_items (',
      '  id INTEGER PRIMARY KEY,',
      '  order_id INTEGER REFERENCES orders(id),',
      '  product_name TEXT NOT NULL,',
      '  quantity INTEGER NOT NULL,',
      '  unit_price REAL NOT NULL',
      ');',
    ].join('\n'),
    'broken_query.sql': [
      '-- This query has 3 bugs:',
      '-- 1. Missing JOIN condition (implicit cross join)',
      '-- 2. Ambiguous column reference (status without table alias)',
      '-- 3. Wrong HAVING clause (uses raw column instead of aggregate)',
      'SELECT name, SUM(amount), COUNT(*)',
      'FROM users, orders',
      'WHERE status = "active"',
      'GROUP BY name',
      'HAVING amount > 100;',
    ].join('\n'),
  },

  'multi-file-project': {
    'package.json': JSON.stringify(
      {
        name: 'test-project',
        version: '1.0.0',
        main: 'src/index.ts',
        scripts: { build: 'tsc', test: 'echo "no tests"' },
      },
      null,
      2,
    ),
    'tsconfig.json': JSON.stringify(
      {
        compilerOptions: {
          target: 'es2020',
          module: 'commonjs',
          strict: true,
          outDir: 'dist',
        },
        include: ['src/**/*'],
      },
      null,
      2,
    ),
    'src/index.ts': [
      'import { Config } from "./config";',
      'import { processData } from "./processor";',
      'import { formatOutput } from "./formatter";',
      '',
      'const config = new Config();',
      'const data = processData(config.getInputPath());',
      'console.log(formatOutput(data));',
    ].join('\n'),
    'src/config.ts': [
      'export class Config {',
      '  private inputPath: string;',
      '  constructor() { this.inputPath = "./data/input.json"; }',
      '  getInputPath(): string { return this.inputPath; }',
      '}',
    ].join('\n'),
    'src/processor.ts': [
      'import { readFileSync } from "fs";',
      '',
      'export interface DataRecord { id: number; value: string; timestamp: string; }',
      '',
      'export function processData(path: string): DataRecord[] {',
      '  const raw = readFileSync(path, "utf-8");',
      '  const records: DataRecord[] = JSON.parse(raw);',
      '  return records.filter(r => r.value !== "").sort((a, b) => a.id - b.id);',
      '}',
    ].join('\n'),
    'src/formatter.ts': [
      'import { DataRecord } from "./processor";',
      '',
      'export function formatOutput(records: DataRecord[]): string {',
      '  return records.map(r => `[${r.id}] ${r.value} (${r.timestamp})`).join("\\n");',
      '}',
    ].join('\n'),
    'data/input.json': JSON.stringify([
      { id: 1, value: 'alpha', timestamp: '2025-01-01' },
      { id: 3, value: '', timestamp: '2025-01-02' },
      { id: 2, value: 'beta', timestamp: '2025-01-03' },
    ]),
  },

  'large-input': {
    'large_data.txt': Array.from(
      { length: 1000 },
      (_, i) =>
        `Record ${i + 1}: ${randomUUID()} | value=${Math.random().toFixed(4)} | status=${i % 3 === 0 ? 'active' : 'inactive'}`,
    ).join('\n'),
    // Known answer: 334 active records (indices 0, 3, 6, ..., 999)
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Workspace factory
// ═══════════════════════════════════════════════════════════════════════════

export function createWorkspace(template: FixtureTemplate = 'empty'): WorkspaceContext {
  const rootDir = join(tmpdir(), 'personas-integration', `ws_${randomUUID().slice(0, 8)}`);
  mkdirSync(rootDir, { recursive: true });

  // Populate fixture files
  const files = FIXTURES[template];
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(rootDir, ...relativePath.split('/'));
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, 'utf-8');
  }

  return {
    rootDir,
    writeFile(relativePath: string, content: string): string {
      const fullPath = join(rootDir, ...relativePath.split('/'));
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, content, 'utf-8');
      return fullPath;
    },
    readFile(relativePath: string): string | null {
      try {
        return readFileSync(join(rootDir, ...relativePath.split('/')), 'utf-8');
      } catch {
        return null;
      }
    },
    fileExists(relativePath: string): boolean {
      return existsSync(join(rootDir, ...relativePath.split('/')));
    },
    destroy(): void {
      try {
        rmSync(rootDir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    },
  };
}
