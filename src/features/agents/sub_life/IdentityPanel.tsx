import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { getPersonaIdentity } from '@/api/agents/personaBrain';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { silentCatch } from '@/lib/silentCatch';
import { identityCache } from './lifeCache';

/** Strip the YAML frontmatter block identity.md leads with. */
function stripFrontmatter(md: string): string {
  return md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
}

/**
 * The persona's self-model (`identity.md`), read-only by design: it changes
 * only through approved `self_model_diff` proposals (the write-lane law).
 */
export function IdentityPanel({ personaId }: { personaId: string }) {
  const { t } = useTranslation();
  const life = t.agents.life;
  const [identity, setIdentity] = useState<string | null>(
    () => identityCache.get(personaId) ?? null,
  );
  const [isLoading, setIsLoading] = useState(!identityCache.has(personaId));

  useEffect(() => {
    let alive = true;
    setIdentity(identityCache.get(personaId) ?? null);
    getPersonaIdentity(personaId)
      .then((md) => {
        identityCache.set(personaId, md);
        if (alive) setIdentity(md);
      })
      .catch(silentCatch('life:getIdentity'))
      .finally(() => {
        if (alive) setIsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [personaId]);

  return (
    <div data-testid="life-brain-identity">
      <SectionCard
        title={life.brain_identity_title}
        action={
          <span className="flex items-center gap-1 typo-label text-foreground/85">
            <Lock className="w-3 h-3" />
            {life.brain_identity_note}
          </span>
        }
      >
        {identity == null ? (
          isLoading ? (
            <div className="space-y-1.5" aria-hidden>
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-4 rounded-input bg-secondary/30 animate-pulse" />
              ))}
            </div>
          ) : (
            <p className="typo-caption py-2">{life.brain_identity_empty}</p>
          )
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <MarkdownRenderer content={stripFrontmatter(identity)} />
          </div>
        )}
      </SectionCard>
    </div>
  );
}
