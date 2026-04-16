import type { Translations } from '@/i18n/en';

export type ProjectStatus =
  | 'scoping'
  | 'literature_review'
  | 'hypothesis'
  | 'experiment'
  | 'analysis'
  | 'writing'
  | 'review'
  | 'complete';

export type Domain =
  | 'cs'
  | 'biology'
  | 'chemistry'
  | 'physics'
  | 'mathematics'
  | 'business'
  | 'medicine'
  | 'general';

export type SourceType =
  | 'arxiv'
  | 'scholar'
  | 'pubmed'
  | 'web'
  | 'pdf'
  | 'manual';

export type SourceStatus = 'pending' | 'ingesting' | 'indexed' | 'failed';

export const DOMAINS: readonly Domain[] = [
  'cs', 'biology', 'chemistry', 'physics', 'mathematics', 'business', 'medicine', 'general',
];

export const SOURCE_TYPES: readonly SourceType[] = [
  'arxiv', 'scholar', 'pubmed', 'web', 'pdf', 'manual',
];

export const PROJECT_STATUS_COLORS: Record<ProjectStatus, string> = {
  scoping: 'bg-amber-500/20 text-amber-300',
  literature_review: 'bg-blue-500/20 text-blue-300',
  hypothesis: 'bg-violet-500/20 text-violet-300',
  experiment: 'bg-emerald-500/20 text-emerald-300',
  analysis: 'bg-cyan-500/20 text-cyan-300',
  writing: 'bg-pink-500/20 text-pink-300',
  review: 'bg-orange-500/20 text-orange-300',
  complete: 'bg-green-500/20 text-green-300',
};

export const SOURCE_STATUS_COLORS: Record<SourceStatus, string> = {
  pending: 'bg-foreground/10 text-foreground/40',
  ingesting: 'bg-amber-500/20 text-amber-300',
  indexed: 'bg-green-500/20 text-green-300',
  failed: 'bg-red-500/20 text-red-300',
};

const FALLBACK_BADGE = 'bg-foreground/10 text-foreground/50';

export function projectStatusColor(status: string): string {
  return PROJECT_STATUS_COLORS[status as ProjectStatus] ?? FALLBACK_BADGE;
}

export function sourceStatusColor(status: string): string {
  return SOURCE_STATUS_COLORS[status as SourceStatus] ?? FALLBACK_BADGE;
}

type ResearchLabT = Translations['research_lab'];

export function projectStatusLabel(t: Translations, status: string): string {
  const map: Record<ProjectStatus, keyof ResearchLabT> = {
    scoping: 'status_scoping',
    literature_review: 'status_literature_review',
    hypothesis: 'status_hypothesis',
    experiment: 'status_experiment',
    analysis: 'status_analysis',
    writing: 'status_writing',
    review: 'status_review',
    complete: 'status_complete',
  };
  const key = map[status as ProjectStatus];
  return key ? (t.research_lab[key] as string) : status.replace(/_/g, ' ');
}

export function domainLabel(t: Translations, domain: string | null | undefined): string {
  if (!domain) return '';
  const map: Record<Domain, keyof ResearchLabT> = {
    cs: 'domain_cs',
    biology: 'domain_biology',
    chemistry: 'domain_chemistry',
    physics: 'domain_physics',
    mathematics: 'domain_mathematics',
    business: 'domain_business',
    medicine: 'domain_medicine',
    general: 'domain_general',
  };
  const key = map[domain as Domain];
  return key ? (t.research_lab[key] as string) : domain;
}

export function sourceTypeLabel(t: Translations, sourceType: string): string {
  const map: Record<SourceType, keyof ResearchLabT> = {
    arxiv: 'source_type_arxiv',
    scholar: 'source_type_scholar',
    pubmed: 'source_type_pubmed',
    web: 'source_type_web',
    pdf: 'source_type_pdf',
    manual: 'source_type_manual',
  };
  const key = map[sourceType as SourceType];
  return key ? (t.research_lab[key] as string) : sourceType;
}

export function sourceStatusLabel(t: Translations, status: string): string {
  if (status === 'indexed') return t.research_lab.source_indexed;
  if (status === 'ingesting') return t.research_lab.ingesting;
  return status;
}
