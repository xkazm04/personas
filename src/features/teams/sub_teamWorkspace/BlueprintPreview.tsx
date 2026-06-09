import { Users, GitBranch, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { TopologyBlueprint } from '@/lib/bindings/TopologyBlueprint';

export const EXAMPLE_PROMPTS = [
  'Review this PR and run tests',
  'Write a blog post with research',
  'Analyze customer feedback',
  'Build a content publishing pipeline',
];

/**
 * Suggested-team preview. When `onRoleChange` / `onRemoveMember` are provided
 * (the auto-team modal's previewing phase), the member list is editable in
 * place: roles are inline inputs and members can be dropped before apply —
 * one wrong suggestion no longer forces a full regenerate.
 */
export function BlueprintPreview({ blueprint, onRoleChange, onRemoveMember }: {
  blueprint: TopologyBlueprint;
  onRoleChange?: (index: number, role: string) => void;
  onRemoveMember?: (index: number) => void;
}) {
  const { t, tx } = useTranslation();
  // Extract pattern hint from description (e.g. "(Pattern: sequential)")
  const patternMatch = blueprint.description.match(/\(Pattern:\s*(\w+)\)/i);
  const pattern = patternMatch?.[1] ?? null;
  const cleanDescription = blueprint.description.replace(/\s*\(Pattern:.*?\)/i, '').trim();
  const canRemove = !!onRemoveMember && blueprint.members.length > 1;

  return (
    <div className="space-y-3">
      {cleanDescription && (
        <p className="typo-caption text-foreground leading-relaxed">{cleanDescription}</p>
      )}

      {pattern && (
        <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-card bg-indigo-500/10 border border-indigo-500/20">
          <GitBranch className="w-3 h-3 text-indigo-400" />
          <span className="typo-caption font-medium text-indigo-400 capitalize">{pattern}</span>
        </div>
      )}

      <div className="space-y-1.5">
        {blueprint.members.map((member, i) => (
          <div
            key={`${member.persona_id}-${i}`}
            className="group flex items-center gap-2.5 p-2 rounded-card bg-secondary/30 border border-primary/10"
          >
            <div className="w-6 h-6 rounded-input bg-indigo-500/15 border border-indigo-500/20 flex items-center justify-center flex-shrink-0">
              <Users className="w-3 h-3 text-indigo-400" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="typo-caption font-medium text-foreground/90 truncate block">
                {member.persona_name}
              </span>
            </div>
            {onRoleChange ? (
              <input
                value={member.role}
                onChange={(e) => onRoleChange(i, e.target.value)}
                // Enter in the modal applies the blueprint — inside the role
                // field it should just commit the edit, not create the team.
                onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); e.currentTarget.blur(); } }}
                aria-label={t.pipeline.blueprint_role_label}
                className="w-28 typo-code text-foreground bg-secondary/50 border border-transparent hover:border-primary/20 focus:border-indigo-500/40 px-1.5 py-0.5 rounded font-mono flex-shrink-0 text-right focus-visible:outline-none transition-colors"
              />
            ) : (
              <span className="typo-code text-foreground bg-secondary/50 px-1.5 py-0.5 rounded font-mono flex-shrink-0">
                {member.role}
              </span>
            )}
            {canRemove && (
              <button
                type="button"
                onClick={() => onRemoveMember(i)}
                title={t.pipeline.blueprint_remove_member}
                aria-label={t.pipeline.blueprint_remove_member}
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-0.5 rounded text-foreground hover:text-red-400 transition-all flex-shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 typo-caption text-foreground pt-1">
        <span className="flex items-center gap-1">
          <Users className="w-3 h-3" />
          {tx(blueprint.members.length === 1 ? t.pipeline.auto_team_agents_one : t.pipeline.auto_team_agents_other, { count: blueprint.members.length })}
        </span>
        <span className="flex items-center gap-1">
          <GitBranch className="w-3 h-3" />
          {tx(blueprint.connections.length === 1 ? t.pipeline.auto_team_connections_one : t.pipeline.auto_team_connections_other, { count: blueprint.connections.length })}
        </span>
      </div>
    </div>
  );
}
