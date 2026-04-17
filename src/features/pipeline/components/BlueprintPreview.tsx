import { Users, GitBranch } from 'lucide-react';
import type { TopologyBlueprint } from '@/lib/bindings/TopologyBlueprint';

export const EXAMPLE_PROMPTS = [
  'Review this PR and run tests',
  'Write a blog post with research',
  'Analyze customer feedback',
  'Build a content publishing pipeline',
];

export function BlueprintPreview({ blueprint }: { blueprint: TopologyBlueprint }) {
  // Extract pattern hint from description (e.g. "(Pattern: sequential)")
  const patternMatch = blueprint.description.match(/\(Pattern:\s*(\w+)\)/i);
  const pattern = patternMatch?.[1] ?? null;
  const cleanDescription = blueprint.description.replace(/\s*\(Pattern:.*?\)/i, '').trim();

  return (
    <div className="space-y-3">
      {cleanDescription && (
        <p className="text-xs text-muted-foreground/70 leading-relaxed">{cleanDescription}</p>
      )}

      {pattern && (
        <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-card bg-indigo-500/10 border border-indigo-500/20">
          <GitBranch className="w-3 h-3 text-indigo-400" />
          <span className="text-xs font-medium text-indigo-400 capitalize">{pattern}</span>
        </div>
      )}

      <div className="space-y-1.5">
        {blueprint.members.map((member, i) => (
          <div
            key={i}
            className="flex items-center gap-2.5 p-2 rounded-card bg-secondary/30 border border-primary/10"
          >
            <div className="w-6 h-6 rounded-input bg-indigo-500/15 border border-indigo-500/20 flex items-center justify-center flex-shrink-0">
              <Users className="w-3 h-3 text-indigo-400" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-xs font-medium text-foreground/90 truncate block">
                {member.persona_name}
              </span>
            </div>
            <span className="text-xs text-muted-foreground/50 bg-secondary/50 px-1.5 py-0.5 rounded font-mono flex-shrink-0">
              {member.role}
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground/50 pt-1">
        <span className="flex items-center gap-1">
          <Users className="w-3 h-3" />
          {blueprint.members.length} agent{blueprint.members.length !== 1 ? 's' : ''}
        </span>
        <span className="flex items-center gap-1">
          <GitBranch className="w-3 h-3" />
          {blueprint.connections.length} connection{blueprint.connections.length !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  );
}
