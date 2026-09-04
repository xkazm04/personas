import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { PillGroup } from '@/features/shared/components/forms/PillGroup';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import {
  classesForDomain,
  CUSTOM_CLASS_PREFIX,
  DOMAIN_SOFTWARE_ENGINEERING,
} from '../../libs/charterMeta';

interface RespPolicyFieldsProps {
  domain: string;
  scopeRung: number;
  refusalClasses: string[];
  onScopeRung: (rung: number) => void;
  onRefusalClasses: (classes: string[]) => void;
}

/**
 * Scope rung (0..2, the grantable ceiling) and refusal classes: the domain's
 * library as toggle chips plus `custom:` free text — mirroring exactly what
 * the Rust intake admits.
 */
export function RespPolicyFields({
  domain,
  scopeRung,
  refusalClasses,
  onScopeRung,
  onRefusalClasses,
}: RespPolicyFieldsProps) {
  const { t } = useTranslation();
  const life = t.agents.life;
  const [customPending, setCustomPending] = useState('');

  const library = classesForDomain(domain);
  const customClasses = refusalClasses.filter((c) => !library.includes(c));
  const toggle = (cls: string) =>
    onRefusalClasses(
      refusalClasses.includes(cls)
        ? refusalClasses.filter((c) => c !== cls)
        : [...refusalClasses, cls],
    );
  const addCustom = () => {
    const raw = customPending.trim();
    if (!raw) return;
    const cls = raw.startsWith(CUSTOM_CLASS_PREFIX) ? raw : `${CUSTOM_CLASS_PREFIX}${raw}`;
    if (!refusalClasses.includes(cls)) onRefusalClasses([...refusalClasses, cls]);
    setCustomPending('');
  };

  return (
    <div className="space-y-4">
      <div data-testid="resp-scope">
        <p className="typo-title mb-1.5">{life.resp_scope_label}</p>
        {/* A value picker, not a view switcher — PillGroup (radiogroup), not a tab strip. */}
        <PillGroup<number>
          options={[
            { value: 0, label: life.resp_scope_0 },
            { value: 1, label: life.resp_scope_1 },
            { value: 2, label: life.resp_scope_2 },
          ]}
          value={Math.min(2, Math.max(0, scopeRung))}
          onChange={onScopeRung}
          data-testid="resp-scope-pills"
        />
      </div>

      <div data-testid="resp-refusals">
        <p className="typo-title mb-1.5">{life.resp_refusals_label}</p>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {library.map((cls) => {
            const active = refusalClasses.includes(cls);
            return (
              <button
                key={cls}
                type="button"
                onClick={() => toggle(cls)}
                aria-pressed={active}
                className={`px-2 py-1 rounded-pill border typo-code transition-colors ${
                  active
                    ? 'bg-primary/15 border-primary/40 text-primary'
                    : 'bg-secondary/30 border-primary/10 text-foreground/85 hover:border-primary/25'
                }`}
                data-testid={`resp-refusal-${cls}`}
              >
                {cls}
              </button>
            );
          })}
          {customClasses.map((cls) => (
            <button
              key={cls}
              type="button"
              onClick={() => toggle(cls)}
              aria-pressed
              className="px-2 py-1 rounded-pill border typo-code bg-primary/15 border-primary/40 text-primary"
            >
              {cls}
            </button>
          ))}
        </div>
        <input
          value={customPending}
          onChange={(e) => setCustomPending(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addCustom();
            }
          }}
          placeholder={life.resp_refusal_custom_placeholder}
          className={INPUT_FIELD}
          data-testid="resp-refusal-custom"
        />
        {domain !== DOMAIN_SOFTWARE_ENGINEERING && (
          <p className="flex items-start gap-1.5 mt-2 typo-caption text-status-warning">
            <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            {life.resp_prompt_level_note}
          </p>
        )}
      </div>
    </div>
  );
}
