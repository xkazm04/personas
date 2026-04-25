import { ConfigGlyph } from './ConfigGlyph';
import { RuntimeGlyph } from './RuntimeGlyph';
import { PolicyGlyph } from './PolicyGlyph';
import type { IssueCategory } from './index';
import { useTranslation } from '@/i18n/useTranslation';

const CATEGORY_TINT: Record<IssueCategory, string> = {
  config: 'bg-sky-500/12 text-sky-300',
  runtime: 'bg-amber-500/12 text-amber-300',
  policy: 'bg-violet-500/12 text-violet-300',
};

interface IssueCategoryBadgeProps {
  category: IssueCategory;
}

export function IssueCategoryBadge({ category }: IssueCategoryBadgeProps) {
  const { t } = useTranslation();
  const tint = CATEGORY_TINT[category];
  const label =
    category === 'config'
      ? t.agents.health_issue.category_config
      : category === 'runtime'
        ? t.agents.health_issue.category_runtime
        : t.agents.health_issue.category_policy;

  const Glyph =
    category === 'config' ? ConfigGlyph : category === 'runtime' ? RuntimeGlyph : PolicyGlyph;

  return (
    <span
      title={label}
      aria-label={label}
      className={`inline-flex items-center justify-center w-5 h-5 rounded-card shrink-0 ${tint}`}
    >
      <Glyph size={14} />
    </span>
  );
}
