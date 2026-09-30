import { useMemo, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { formatNumeric } from '@/lib/utils/formatters';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Collapse } from '@/features/shared/components/display/Collapse';
import {
  ChipRow,
  KeyValueGrid,
  KitButton,
  KitHost,
  Section,
  type KeyValueItem,
} from '@/features/shared/components/kit';
import {
  kpRequirementsFromDesignContext,
  type KpRequirementsView,
} from '../libs/kpRequirements';

/**
 * "Requirements from kp" — why a requirement-driven kp hire was designed the
 * way it was.
 *
 * kp researched the role and sent `kp.agent-requirements.v1` instead of a
 * prompt; Personas designed the agent from it and pinned its constraints into
 * the agent's instructions. The object rides on `design_context.kpLink.
 * requirements`; this panel reads it back so the operator can hold the design
 * against its brief. Role, purpose and the MUST constraints are always shown;
 * the rest (responsibilities, craft, research, inputs, outputs, tools) sits
 * behind one disclosure because a researched brief runs long.
 *
 * Renders nothing for a persona that was not hired from kp requirements —
 * which is every persona but those.
 */
export function KpRequirementsPanel({ designContext }: { designContext: string | null | undefined }) {
  const req = useMemo(() => kpRequirementsFromDesignContext(designContext), [designContext]);
  if (!req) return null;
  return <KpRequirementsBody req={req} />;
}

function KpRequirementsBody({ req }: { req: KpRequirementsView }) {
  const { t, tx, language } = useTranslation();
  const k = t.agents.kp_requirements;
  const [open, setOpen] = useState(false);

  const facts: KeyValueItem[] = [
    { k: k.role, v: req.role || null, none: k.not_set },
    { k: k.arena, v: req.arena || null, none: k.not_set },
    { k: k.niche, v: req.niche || null, none: k.not_set },
    {
      k: k.budget,
      v: req.budgetUsdPerAttempt != null ? <Numeric value={req.budgetUsdPerAttempt} unit="usd" /> : null,
      none: k.not_set,
    },
  ];

  const research = req.research;
  const effort = research && (research.effortMin != null || research.effortMax != null)
    ? tx(k.effort_range, {
        min: research.effortMin != null ? formatNumeric(research.effortMin, 'plain', { language }) : '?',
        max: research.effortMax != null ? formatNumeric(research.effortMax, 'plain', { language }) : '?',
      })
    : null;
  const outputs = req.outputs;

  return (
    <KitHost testId="kp-requirements-panel">
      <Section
        level={2}
        title={k.title}
        count={req.constraints.length > 0 ? req.constraints.length : undefined}
        desc={k.desc}
        actions={
          <KitButton quiet expanded={open} onClick={() => setOpen((o) => !o)} testId="kp-requirements-toggle">
            {open ? k.hide_all : k.show_all}
          </KitButton>
        }
      >
        <div className="space-y-4">
          {req.purpose && <p className="typo-body text-foreground">{req.purpose}</p>}
          <KeyValueGrid items={facts} min="10rem" />

          <Section level={2} title={k.constraints_title} count={req.constraints.length}>
            {req.constraints.length === 0 ? (
              <p className="typo-caption">{k.constraints_none}</p>
            ) : (
              <ol className="list-decimal pl-5 space-y-1 typo-body text-foreground" data-testid="kp-requirements-constraints">
                {req.constraints.map((c, i) => <li key={i}>{c}</li>)}
              </ol>
            )}
          </Section>

          <Collapse open={open} unmountWhenClosed>
            <div className="space-y-4 pt-1" data-testid="kp-requirements-detail">
              {req.responsibilities.length > 0 && (
                <Section level={2} title={k.responsibilities_title} count={req.responsibilities.length}>
                  <ul className="list-disc pl-5 space-y-1 typo-body text-foreground">
                    {req.responsibilities.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </Section>
              )}

              {req.craft.length > 0 && (
                <Section level={2} title={k.craft_title} count={req.craft.length}>
                  <div className="space-y-3">
                    {req.craft.map((c, i) => (
                      <div key={i} className="space-y-1">
                        <p className="typo-heading">{c.title || c.recipe}</p>
                        {c.title && c.recipe && <p className="typo-code">{c.recipe}</p>}
                        <KeyValueGrid
                          min="14rem"
                          items={[
                            { k: k.craft_need, v: c.need || null, none: k.not_set },
                            { k: k.craft_core_action, v: c.coreAction || null, none: k.not_set },
                          ]}
                        />
                        {c.successCriteria.length > 0 && (
                          <>
                            <p className="typo-label">{k.craft_success}</p>
                            <ul className="list-disc pl-5 space-y-0.5 typo-body text-foreground">
                              {c.successCriteria.map((s, j) => <li key={j}>{s}</li>)}
                            </ul>
                          </>
                        )}
                        {c.lessons.length > 0 && (
                          <>
                            <p className="typo-label">{k.craft_lessons}</p>
                            <ul className="list-disc pl-5 space-y-0.5 typo-body text-foreground">
                              {c.lessons.map((s, j) => <li key={j}>{s}</li>)}
                            </ul>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {research && (
                <Section
                  level={2}
                  title={k.research_title}
                  meta={[
                    research.gigsResearched != null
                      ? research.gigsResearched === 1
                        ? k.research_gigs_one
                        : tx(k.research_gigs_other, { count: research.gigsResearched })
                      : null,
                    research.asOf ? tx(k.research_as_of, { date: research.asOf }) : null,
                  ].filter(Boolean).join(' · ') || undefined}
                >
                  <div className="space-y-3">
                    {research.categories.length > 0 && (
                      <ChipRow
                        label={k.research_categories}
                        emptyLabel={k.not_set}
                        chips={research.categories.map((c, i) => ({ id: `cat-${i}`, label: c }))}
                      />
                    )}
                    <KeyValueGrid
                      min="14rem"
                      items={[
                        { k: k.research_effort, v: effort, none: k.not_set },
                      ]}
                    />
                    {research.commonAsks.length > 0 && (
                      <>
                        <p className="typo-label">{k.research_asks}</p>
                        <ul className="list-disc pl-5 space-y-0.5 typo-body text-foreground">
                          {research.commonAsks.map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                      </>
                    )}
                    {research.commonChallenges.length > 0 && (
                      <>
                        <p className="typo-label">{k.research_challenges}</p>
                        <ul className="list-disc pl-5 space-y-0.5 typo-body text-foreground">
                          {research.commonChallenges.map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                      </>
                    )}
                  </div>
                </Section>
              )}

              {req.inputs && (req.inputs.assignment || req.inputs.fields.length > 0) && (
                <Section level={2} title={k.inputs_title} meta={req.inputs.assignment || undefined}>
                  <ChipRow
                    label={k.inputs_title}
                    emptyLabel={k.not_set}
                    chips={req.inputs.fields.map((f, i) => ({ id: `in-${i}`, label: f }))}
                  />
                </Section>
              )}

              {outputs && (
                <Section level={2} title={k.outputs_title} meta={outputs.contract || undefined}>
                  <div className="space-y-3">
                    <KeyValueGrid
                      min="12rem"
                      items={[
                        { k: k.outputs_handoff, v: outputs.handoffFile || null, none: k.not_set },
                        { k: k.outputs_client_files, v: outputs.clientFilesDir || null, none: k.not_set },
                        { k: k.outputs_process_log, v: outputs.processLog || null, none: k.not_set },
                      ]}
                    />
                    {outputs.reviewChecklist.length > 0 && (
                      <ChipRow
                        label={k.outputs_checklist}
                        emptyLabel={k.not_set}
                        chips={outputs.reviewChecklist.map((c, i) => ({ id: `chk-${i}`, label: c }))}
                      />
                    )}
                  </div>
                </Section>
              )}

              <Section level={2} title={k.tools_title} count={req.tools.length}>
                {req.tools.length === 0 ? (
                  <p className="typo-caption">{k.tools_none}</p>
                ) : (
                  <KeyValueGrid
                    min="14rem"
                    items={req.tools.map((tool) => ({ k: tool.connector, v: tool.why || null, none: k.not_set }))}
                  />
                )}
              </Section>
            </div>
          </Collapse>
        </div>
      </Section>
    </KitHost>
  );
}
