import { describe, it, expect } from 'vitest';
import { classifyError, type ErrorCategory } from '@/lib/errorTaxonomy';

// MIRRORED PAIR — this list is kept byte-for-byte in sync with the
// `PARITY_FIXTURES` const in `src-tauri/src/engine/error_taxonomy.rs`. Both
// ladders (Rust `classify_error` and TS `classifyError`) must map every fixture
// string to the same category. When you add a case to one side, add the SAME
// case with the SAME expected category to the other file.
//
// This is the guarantee that lets the frontend trust the Rust-computed
// `category` on the IPC envelope: whatever the backend classified a raw string
// as, the TS fallback ladder would classify it the same way.
const PARITY_FIXTURES: Array<[string, ErrorCategory]> = [
  ['Error: rate limit exceeded', 'rate_limit'],
  ['Too many requests', 'rate_limit'],
  ['HTTP 429 from provider', 'rate_limit'],
  ['quota exceeded for this key', 'rate_limit'],
  ['usage limit reached', 'rate_limit'],
  ['Session limit reached', 'session_limit'],
  ['Execution timed out after 600s', 'timeout'],
  ['Request timeout', 'timeout'],
  ['deadline exceeded', 'timeout'],
  ['connect ETIMEDOUT 10.0.0.1:443', 'timeout'],
  ['Claude CLI not found', 'provider_not_found'],
  ['spawn ENOENT', 'provider_not_found'],
  ["'claude' is not recognized", 'provider_not_found'],
  ['Failed to decrypt credential', 'credential_error'],
  ['Invalid API key provided', 'credential_error'],
  ['HTTP 401 Unauthorized', 'credential_error'],
  ['403 returned', 'credential_error'],
  ['ECONNREFUSED 127.0.0.1:3000', 'network'],
  ['ERR_NETWORK while fetching', 'network'],
  ['connection refused', 'network'],
  ['fetch failed', 'network'],
  ['tool_use failed', 'tool_error'],
  ['Tool call failed', 'tool_error'],
  ['HTTP 500 internal server error', 'api_error'],
  ['502 Bad Gateway', 'api_error'],
  ['validation failed: missing field', 'validation'],
  ['malformed JSON in body', 'validation'],
  // Real fleet shapes — Claude Code CLI / Anthropic API stderr as it lands
  // inside `Execution failed (exit code N): <stderr>`. These are the templates
  // the failures-by-category dashboard was burying under Unknown.
  ['API Error: 529 {"type":"overloaded_error","message":"Overloaded"}', 'api_error'],
  ['Overloaded', 'api_error'],
  ['API Error: 404 not_found_error: model: claude-sonnet-4-20250514', 'provider_not_found'],
  ['model not found', 'provider_not_found'],
  ['Credit balance is too low', 'credential_error'],
  ['API Error: 403 permission_error', 'credential_error'],
  ['authentication_error: invalid x-api-key', 'credential_error'],
  ['prompt is too long: exceeds the model maximum', 'validation'],
  ['Request too large (413)', 'validation'],
  ['read ECONNRESET', 'network'],
  ['socket hang up', 'network'],
  ['Execution failed (exit code 137): Killed', 'transient_process_failure'],
  ['Execution failed (exit code 1): ', 'transient_process_failure'],
  ['some entirely novel failure', 'unknown'],
];

describe('errorTaxonomy classifyError — cross-FFI parity', () => {
  it.each(PARITY_FIXTURES)('classifies %j the same as the Rust ladder', (input, expected) => {
    expect(classifyError(input)).toBe(expected);
  });
});
