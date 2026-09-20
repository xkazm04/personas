// The path rows above the list: Field / Domain / Category / Subject, or
// Field / Council when a council is focused. The same steps the breadcrumb
// shows, because both read the one focus in the store.
import { useCouncilStore } from '../../councilStore';
import type { GalaxyFocus, GalaxyLayout } from '../engine/types';

export interface PathStep {
  tag: string;
  name: string;
  focus: GalaxyFocus;
}

/** The steps for a focus. Pure, so the breadcrumb and the rail share it. */
export function pathSteps(
  layout: GalaxyLayout | null,
  focus: GalaxyFocus,
  labels: { field: string; allDomains: string; council: string; domain: string; category: string; subject: string },
): PathStep[] {
  const steps: PathStep[] = [
    { tag: labels.field, name: labels.allDomains, focus: { kind: 'none' } },
  ];
  if (focus.kind === 'council') {
    steps.push({ tag: labels.council, name: focus.title, focus });
    return steps;
  }
  if (focus.kind === 'none' || !layout) return steps;
  const domain = layout.domains.find((d) => d.slug === focus.domainSlug);
  if (!domain) return steps;
  steps.push({
    tag: labels.domain,
    name: domain.title,
    focus: { kind: 'node', domainSlug: domain.slug, categoryId: null, subjectSlug: null },
  });
  const category = domain.categories.find((c) => c.id === focus.categoryId);
  if (!category) return steps;
  steps.push({
    tag: labels.category,
    name: category.title,
    focus: { kind: 'node', domainSlug: domain.slug, categoryId: category.id, subjectSlug: null },
  });
  const subject = category.subjects.find((s) => s.slug === focus.subjectSlug);
  if (!subject) return steps;
  steps.push({
    tag: labels.subject,
    name: subject.title,
    focus: { kind: 'node', domainSlug: domain.slug, categoryId: category.id, subjectSlug: subject.slug },
  });
  return steps;
}

interface Props {
  steps: PathStep[];
}

export function RailPath({ steps }: Props) {
  const setFocus = useCouncilStore((s) => s.setFocus);
  return (
    <div className="flex flex-col gap-0.5" data-testid="council-rail-path">
      {steps.map((step, i) => {
        const current = i === steps.length - 1;
        return (
          <button
            key={`${step.tag}-${step.name}`}
            type="button"
            onClick={() => setFocus(step.focus)}
            aria-current={current ? 'true' : undefined}
            className={`flex w-full items-center gap-2.5 rounded-interactive px-1.5 py-1 text-left ${
              current ? 'typo-title bg-secondary/70 text-foreground' : 'typo-caption text-muted hover:bg-secondary/50 hover:text-foreground'
            }`}
          >
            <span
              className={`w-[84px] flex-none uppercase tracking-[0.09em] ${current ? 'text-accent' : 'text-muted-dark'}`}
            >
              {step.tag}
            </span>
            <span className="flex-1 truncate">{step.name}</span>
          </button>
        );
      })}
    </div>
  );
}
