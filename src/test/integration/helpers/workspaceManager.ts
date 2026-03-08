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

  'persona-design': {
    'persona_brief.md': [
      '# Customer Support Agent',
      '',
      '## Role',
      'You are a customer support agent for a SaaS company.',
      '',
      '## Tone',
      'Empathetic, professional, solution-oriented.',
      '',
      '## Capabilities',
      '- Answer product questions from the knowledge base',
      '- Escalate billing issues to the finance team',
      '- Log bug reports in the issue tracker',
      '',
      '## Constraints',
      '- Never share internal pricing formulas',
      '- Always verify customer identity before account changes',
      '- Response time target: under 2 minutes',
    ].join('\n'),
  },

  'credential-design': {
    'connector_spec.json': JSON.stringify(
      {
        name: 'stripe',
        label: 'Stripe',
        auth_type: 'api_key',
        fields: [
          { key: 'secret_key', label: 'Secret Key', required: true, pattern: '^sk_(test|live)_' },
          { key: 'publishable_key', label: 'Publishable Key', required: false, pattern: '^pk_(test|live)_' },
        ],
        test_endpoint: 'https://api.stripe.com/v1/balance',
        docs_url: 'https://dashboard.stripe.com/apikeys',
      },
      null,
      2,
    ),
  },

  'n8n-workflow': {
    'workflow.json': JSON.stringify(
      {
        name: 'Email to Slack Notification',
        nodes: [
          { type: 'n8n-nodes-base.emailTrigger', name: 'Email Trigger', parameters: { mailbox: 'inbox' } },
          {
            type: 'n8n-nodes-base.function',
            name: 'Extract Subject',
            parameters: { functionCode: 'return [{json: {subject: $input.first().json.subject}}]' },
          },
          {
            type: 'n8n-nodes-base.slack',
            name: 'Send Slack',
            parameters: { channel: '#notifications', text: '={{$json.subject}}' },
          },
        ],
        connections: {
          'Email Trigger': { main: [[{ node: 'Extract Subject', type: 'main', index: 0 }]] },
          'Extract Subject': { main: [[{ node: 'Send Slack', type: 'main', index: 0 }]] },
        },
      },
      null,
      2,
    ),
  },

  'healing-diagnosis': {
    'error_log.txt': [
      '[2026-03-07 10:15:23] ERROR connector.stripe: API call failed - 401 Unauthorized',
      '[2026-03-07 10:15:23] DEBUG connector.stripe: Headers: {Authorization: Bearer sk_test_****expired}',
      '[2026-03-07 10:15:24] WARN connector.stripe: Retry 1/3 failed',
      '[2026-03-07 10:15:25] WARN connector.stripe: Retry 2/3 failed',
      '[2026-03-07 10:15:26] ERROR connector.stripe: All retries exhausted',
      '[2026-03-07 10:15:26] INFO system: Marking connector stripe as unhealthy',
      '[2026-03-07 10:16:00] ERROR execution.pipeline_42: Step 3 failed - dependency connector.stripe unavailable',
      '[2026-03-07 10:16:00] INFO execution.pipeline_42: Pipeline halted at step 3 of 5',
    ].join('\n'),
    'connector_config.json': JSON.stringify(
      {
        name: 'stripe',
        status: 'unhealthy',
        last_success: '2026-03-06T22:00:00Z',
        error_count: 5,
        credentials: { secret_key: 'sk_test_****expired', last_rotated: '2025-12-01' },
      },
      null,
      2,
    ),
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
