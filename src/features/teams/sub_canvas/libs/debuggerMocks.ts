// -- Mock Data Generators for Dry Run ---------------------------------

export function generateMockInput(
  role: string,
  name: string,
  upstreamOutputs: Record<string, unknown>[],
): Record<string, unknown> {
  if (upstreamOutputs.length > 0) {
    return {
      upstream_results: upstreamOutputs,
      timestamp: new Date().toISOString(),
    };
  }

  switch (role) {
    case 'orchestrator':
      return { task: `Coordinate pipeline execution`, agents_available: 3, priority: 'normal' };
    case 'router':
      return { incoming_request: `Route this task to the appropriate handler`, metadata: { source: 'user', type: 'query' } };
    case 'reviewer':
      return { content_to_review: `[Output from upstream agent]`, criteria: ['accuracy', 'completeness', 'tone'] };
    default:
      return { instruction: `Process task for ${name}`, context: 'Pipeline dry-run simulation' };
  }
}

export function generateMockOutput(role: string, name: string): Record<string, unknown> {
  switch (role) {
    case 'orchestrator':
      return {
        delegations: [
          { agent: 'worker-1', task: 'Execute primary task' },
          { agent: 'worker-2', task: 'Execute secondary task' },
        ],
        strategy: 'parallel',
        estimated_steps: 3,
      };
    case 'reviewer':
      return {
        approved: true,
        score: 8.5,
        feedback: `Output meets quality criteria. Minor suggestions for improvement.`,
        issues: [],
      };
    case 'router':
      return {
        selected_route: 'specialist-a',
        confidence: 0.92,
        reason: `Request matches specialist-a's domain based on keyword analysis`,
        alternatives: ['specialist-b'],
      };
    default:
      return {
        result: `[Simulated output from ${name}]`,
        confidence: 0.89,
        tokens_used: Math.floor(Math.random() * 2000) + 500,
        latency_ms: Math.floor(Math.random() * 3000) + 200,
      };
  }
}
