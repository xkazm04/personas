/**
 * The generic hands — what an agent can do on ANY tier-1 page without the page
 * publishing anything: click, fill, select, submit, each by a reference the
 * scan handed out rather than by a coordinate or a selector the model invented.
 *
 * Read-only surface. The hands are not configurable per site; what IS
 * configurable is whether each one has to ask first, and that lives on the
 * Policy tab. This tab exists so the operator can see what "tier 1" actually
 * buys before deciding.
 */
import { MousePointerClick, Pencil, ListChecks, SendHorizonal, Lock } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import type { BrowserSite } from '../../types';

export default function HandsTab({ site }: { site: BrowserSite }) {
  const { t, tx } = useTranslation();
  const d = t.browser.detail;
  const tier = site.scan_tier;
  const available = tier !== null && tier >= 1;

  const hands = [
    { icon: MousePointerClick, label: d.hands_click },
    { icon: Pencil, label: d.hands_fill },
    { icon: ListChecks, label: d.hands_select },
    { icon: SendHorizonal, label: d.hands_submit },
  ];

  return (
    <div className="space-y-3 min-w-0">
      <p className="typo-body text-foreground">{d.hands_description}</p>

      <ul className="grid grid-cols-2 gap-2">
        {hands.map(({ icon: Icon, label }) => (
          <li
            key={label}
            className={[
              'flex items-center gap-2 px-3 py-2 rounded-card border min-w-0',
              available
                ? 'border-primary/10 bg-background/40 text-foreground'
                : 'border-primary/5 bg-secondary/20 text-foreground',
            ].join(' ')}
          >
            {available ? <Icon className="w-3.5 h-3.5 shrink-0" /> : <Lock className="w-3.5 h-3.5 shrink-0" />}
            <span className="typo-body truncate">{label}</span>
          </li>
        ))}
      </ul>

      <p className="typo-caption text-foreground">
        {available
          ? tx(d.hands_budget, { budget: site.budget })
          : d.hands_unavailable}
      </p>
    </div>
  );
}
