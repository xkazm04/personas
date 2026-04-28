import { describe, it, expect } from 'vitest';
import { buildCredentialGraph, analyzeBlastRadius, toAgentNodeId } from './credentialGraph';
import type { CredentialMetadata, ConnectorDefinition, Persona, CredentialEvent } from '@/lib/types/types';
import type { CredentialDependent } from '@/lib/bindings/CredentialDependent';

const cred: CredentialMetadata = {
  id: 'cred-1',
  name: 'GitHub PAT',
  service_type: 'github',
  healthcheck_last_success: true,
} as CredentialMetadata;

const persona: Persona = {
  id: 'persona-1',
  name: 'Researcher',
  color: '#3b82f6',
} as Persona;

function dep(linkType: string, viaConnector: string | null = 'github'): CredentialDependent {
  return {
    persona_id: 'persona-1',
    persona_name: 'Researcher',
    link_type: linkType,
    via_connector: viaConnector,
    last_used_at: null,
  };
}

describe('buildCredentialGraph edge dedupe', () => {
  it('collapses multiple link_types per (cred, persona) into one edge', () => {
    const dependentsMap = new Map<string, CredentialDependent[]>([
      ['cred-1', [dep('event_trigger', null), dep('tool_connector')]],
    ]);
    const graph = buildCredentialGraph([cred], [], [persona], [], dependentsMap);

    const credToAgentEdges = graph.edges.filter(
      (e) => e.source === 'cred-1' && e.target === toAgentNodeId('persona-1'),
    );
    expect(credToAgentEdges).toHaveLength(1);
    // tool_connector outranks event_trigger → solid style wins
    expect(credToAgentEdges[0]?.style).toBe('solid');
  });

  it('keeps the dominant link_type regardless of insertion order', () => {
    // Reverse the insertion order
    const dependentsMap = new Map<string, CredentialDependent[]>([
      ['cred-1', [dep('tool_connector'), dep('event_trigger', null)]],
    ]);
    const graph = buildCredentialGraph([cred], [], [persona], [], dependentsMap);

    const credToAgentEdges = graph.edges.filter(
      (e) => e.source === 'cred-1' && e.target === toAgentNodeId('persona-1'),
    );
    expect(credToAgentEdges).toHaveLength(1);
    expect(credToAgentEdges[0]?.style).toBe('solid');
  });

  it('analyzeBlastRadius counts each agent exactly once with stable via', () => {
    const dependentsMap = new Map<string, CredentialDependent[]>([
      ['cred-1', [dep('audit_log', null), dep('tool_connector')]],
    ]);
    const graph = buildCredentialGraph([cred], [], [persona], [], dependentsMap);
    const blast = analyzeBlastRadius('cred-1', graph);
    expect(blast).not.toBeNull();
    expect(blast!.affectedAgents).toHaveLength(1);
    // The 'via' label comes from via_connector first, falling back to the
    // dominant link_type. Since via_connector is set on the tool_connector
    // dep, it wins deterministically.
    expect(blast!.affectedAgents[0]?.via).toBe('github');
  });

  it('falls back to label = link_type when via_connector is null', () => {
    const dependentsMap = new Map<string, CredentialDependent[]>([
      ['cred-1', [dep('event_trigger', null)]],
    ]);
    const graph = buildCredentialGraph([cred], [], [persona], [], dependentsMap);
    const edge = graph.edges.find((e) => e.source === 'cred-1');
    expect(edge?.label).toBe('event_trigger');
  });

  it('treats unknown link_types as lowest precedence', () => {
    const dependentsMap = new Map<string, CredentialDependent[]>([
      ['cred-1', [dep('audit_log', null), dep('mystery_link', null)]],
    ]);
    const graph = buildCredentialGraph([cred], [], [persona], [], dependentsMap);
    const edge = graph.edges.find((e) => e.source === 'cred-1');
    // audit_log is known and outranks the unknown 'mystery_link'
    expect(edge?.label).toBe('audit_log');
  });
});

const _connectorsUnused: ConnectorDefinition[] = [];
const _eventsUnused: CredentialEvent[] = [];
void _connectorsUnused;
void _eventsUnused;
