/**
 * SQLite test database for recording and comparing integration test results.
 * Uses better-sqlite3 for synchronous, reliable DB operations.
 */
import Database from 'better-sqlite3';
import { mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import type { TestExecutionRecord, ProviderComparison, ProviderName } from './types';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS test_executions (
  id                  TEXT PRIMARY KEY,
  round               TEXT NOT NULL,
  test_name           TEXT NOT NULL,
  provider            TEXT NOT NULL,
  model               TEXT NOT NULL,
  status              TEXT NOT NULL CHECK(status IN ('pass','fail','skip','timeout','error')),
  score               REAL NOT NULL DEFAULT 0,
  duration_ms         INTEGER NOT NULL DEFAULT 0,
  cost_usd            REAL NOT NULL DEFAULT 0,
  input_tokens        INTEGER NOT NULL DEFAULT 0,
  output_tokens       INTEGER NOT NULL DEFAULT 0,
  tool_call_count     INTEGER NOT NULL DEFAULT 0,
  tools_used          TEXT NOT NULL DEFAULT '[]',
  assistant_text_len  INTEGER NOT NULL DEFAULT 0,
  error_message       TEXT,
  validation_details  TEXT NOT NULL DEFAULT '[]',
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_te_round ON test_executions(round);
CREATE INDEX IF NOT EXISTS idx_te_provider ON test_executions(provider);
`;

export interface TestDbContext {
  dbPath: string;
  /** Record a test execution result */
  recordExecution(record: TestExecutionRecord): void;
  /** Get all executions for a round */
  getByRound(round: string): TestExecutionRecord[];
  /** Get all executions for a provider */
  getByProvider(provider: ProviderName): TestExecutionRecord[];
  /** Get aggregate comparison across providers */
  getProviderComparison(): ProviderComparison[];
  /** Get all records */
  getAll(): TestExecutionRecord[];
  /** Export full results as JSON */
  exportJson(): object;
  /** Destroy: close DB and delete file */
  destroy(): void;
}

export function createTestDb(): TestDbContext {
  const testDir = join(tmpdir(), 'personas-integration');
  mkdirSync(testDir, { recursive: true });
  const dbPath = join(testDir, `integration_${randomUUID().slice(0, 8)}.db`);

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  const insertStmt = db.prepare(`
    INSERT INTO test_executions (
      id, round, test_name, provider, model, status, score,
      duration_ms, cost_usd, input_tokens, output_tokens,
      tool_call_count, tools_used, assistant_text_len,
      error_message, validation_details
    ) VALUES (
      @id, @round, @testName, @provider, @model, @status, @score,
      @durationMs, @costUsd, @inputTokens, @outputTokens,
      @toolCallCount, @toolsUsed, @assistantTextLength,
      @errorMessage, @validationDetails
    )
  `);

  return {
    dbPath,

    recordExecution(record: TestExecutionRecord): void {
      insertStmt.run({
        id: record.id || randomUUID(),
        round: record.round,
        testName: record.testName,
        provider: record.provider,
        model: record.model,
        status: record.status,
        score: record.score,
        durationMs: record.durationMs,
        costUsd: record.costUsd,
        inputTokens: record.inputTokens,
        outputTokens: record.outputTokens,
        toolCallCount: record.toolCallCount,
        toolsUsed: record.toolsUsed,
        assistantTextLength: record.assistantTextLength,
        errorMessage: record.errorMessage ?? null,
        validationDetails: record.validationDetails,
      });
    },

    getByRound(round: string): TestExecutionRecord[] {
      return db
        .prepare('SELECT * FROM test_executions WHERE round = ? ORDER BY provider, test_name')
        .all(round) as TestExecutionRecord[];
    },

    getByProvider(provider: ProviderName): TestExecutionRecord[] {
      return db
        .prepare('SELECT * FROM test_executions WHERE provider = ? ORDER BY round, test_name')
        .all(provider) as TestExecutionRecord[];
    },

    getProviderComparison(): ProviderComparison[] {
      const rows = db
        .prepare(
          `
        SELECT
          provider,
          COUNT(*) as totalTests,
          SUM(CASE WHEN status = 'pass' THEN 1 ELSE 0 END) as passed,
          SUM(CASE WHEN status = 'fail' THEN 1 ELSE 0 END) as failed,
          SUM(CASE WHEN status = 'skip' THEN 1 ELSE 0 END) as skipped,
          ROUND(AVG(score), 3) as avgScore,
          ROUND(AVG(duration_ms), 0) as avgDurationMs,
          ROUND(SUM(cost_usd), 6) as totalCostUsd,
          SUM(input_tokens) as totalInputTokens,
          SUM(output_tokens) as totalOutputTokens,
          ROUND(AVG(tool_call_count), 1) as avgToolCalls
        FROM test_executions
        WHERE status != 'skip'
        GROUP BY provider
        ORDER BY avgScore DESC
      `,
        )
        .all() as ProviderComparison[];
      return rows;
    },

    getAll(): TestExecutionRecord[] {
      return db
        .prepare('SELECT * FROM test_executions ORDER BY round, test_name, provider')
        .all() as TestExecutionRecord[];
    },

    exportJson(): object {
      const all = db
        .prepare('SELECT * FROM test_executions ORDER BY round, test_name, provider')
        .all() as TestExecutionRecord[];
      const comparison = this.getProviderComparison();

      // Group by round
      const rounds: Record<string, TestExecutionRecord[]> = {};
      for (const row of all) {
        if (!rounds[row.round]) rounds[row.round] = [];
        rounds[row.round].push(row);
      }

      return {
        generatedAt: new Date().toISOString(),
        summary: {
          total: all.length,
          passed: all.filter((r) => r.status === 'pass').length,
          failed: all.filter((r) => r.status === 'fail').length,
          skipped: all.filter((r) => r.status === 'skip').length,
          totalCostUsd: all.reduce((s, r) => s + (r.costUsd || 0), 0),
          totalDurationMs: all.reduce((s, r) => s + (r.durationMs || 0), 0),
        },
        providerComparison: comparison,
        rounds,
      };
    },

    destroy(): void {
      try {
        db.close();
      } catch {
        /* ignore */
      }
      try {
        unlinkSync(dbPath);
      } catch {
        /* ignore */
      }
      try {
        unlinkSync(dbPath + '-wal');
      } catch {
        /* ignore */
      }
      try {
        unlinkSync(dbPath + '-shm');
      } catch {
        /* ignore */
      }
    },
  };
}
