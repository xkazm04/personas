export interface ExamplePair {
  id: string;
  input: string;
  output: string;
}

/**
 * Format example pairs into a structured intent string for the compiler.
 * This becomes the `intent` parameter passed to `compileFromIntent`.
 */
export function formatExamplePairsAsIntent(pairs: ExamplePair[], supplementaryNote?: string): string {
  const validPairs = pairs.filter((p) => p.input.trim() || p.output.trim());
  if (validPairs.length === 0) return supplementaryNote?.trim() ?? '';

  const parts: string[] = [];

  parts.push(
    'Design this agent based on the following concrete input/output examples. ' +
    'Reverse-engineer the full configuration (prompt, tools, triggers, connectors, use cases) ' +
    'from these examples. Each example shows a real input the agent would receive and the ' +
    'desired output it should produce.\n',
  );

  for (let i = 0; i < validPairs.length; i++) {
    const pair = validPairs[i]!;
    parts.push(`### Example ${i + 1}`);
    parts.push('**Input:**');
    parts.push('```');
    parts.push(pair.input.trim() || '(empty)');
    parts.push('```');
    parts.push('**Desired Output:**');
    parts.push('```');
    parts.push(pair.output.trim() || '(empty)');
    parts.push('```');
    parts.push('');
  }

  if (supplementaryNote?.trim()) {
    parts.push('### Additional Context');
    parts.push(supplementaryNote.trim());
  }

  return parts.join('\n');
}
