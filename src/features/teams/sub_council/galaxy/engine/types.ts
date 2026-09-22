// The galaxy's node model — the shape the layout pass produces and every
// other engine pass reads. Nothing here is a React type: the canvas engine
// owns these objects for the lifetime of one dataset and mutates them in
// place, which is what keeps drawing off the React render path entirely.
//
// The visual contract is `.claude/council-reference/index.html`.
import type { CouncilOverlaySubject } from '@/lib/bindings/CouncilOverlaySubject';

/** Council signal on one star. `none` is "never councilled", never zero. */
export type CouncilMark = 'none' | 'approved' | 'rejected' | 'pending';

export interface Wedge {
  /** Subcategory slug, or `''` when the subjects carry none. */
  key: string;
  a0: number;
  a1: number;
  mid: number;
  n: number;
}

export interface TechniqueNode {
  kind: 'technique';
  slug: string;
  laws: string[];
  useWhen: string[];
  /** 1-based, in name order — the number the docked list prints. */
  rank: number;
  x: number;
  y: number;
  subject: SubjectNode;
}

export interface SubjectNode {
  kind: 'subject';
  slug: string;
  title: string;
  subcategory: string | null;
  status: string;
  applications: number;
  rank: number;
  x: number;
  y: number;
  domain: DomainNode;
  category: CategoryNode;
  wedge: Wedge;
  techniques: TechniqueNode[];
  lawCount: number;
  mark: CouncilMark;
  overlay: CouncilOverlaySubject | null;
}

export interface CategoryNode {
  kind: 'category';
  id: string;
  title: string;
  rank: number;
  x: number;
  y: number;
  r: number;
  pad: number;
  domain: DomainNode;
  subjects: SubjectNode[];
  wedges: Wedge[];
  techniqueCount: number;
}

export interface DomainNode {
  kind: 'domain';
  slug: string;
  title: string;
  rank: number;
  x: number;
  y: number;
  r: number;
  pad: number;
  categories: CategoryNode[];
  subjectCount: number;
  techniqueCount: number;
  lawCount: number;
  counts: Record<CouncilMark, number>;
}

export type GalaxyNode = DomainNode | CategoryNode | SubjectNode | TechniqueNode;

export interface Dust {
  x: number;
  y: number;
  s: number;
}

/** The whole laid-out field. Computed once per dataset, never per frame. */
export interface GalaxyLayout {
  domains: DomainNode[];
  subjects: SubjectNode[];
  bySlug: Map<string, SubjectNode>;
  /** Radius of the smallest circle at the origin that holds every cluster. */
  boundRadius: number;
  dust: Dust[];
  totals: { domains: number; subjects: number; techniques: number };
}

/**
 * Where the reader is standing. ONE value, read by the canvas, the docked
 * list and the breadcrumb alike — never three components with their own idea
 * of "where am I" (the reference's `focusCouncil` is one state, not three).
 */
export type GalaxyFocus =
  | { kind: 'none' }
  | {
      kind: 'node';
      domainSlug: string | null;
      categoryId: string | null;
      subjectSlug: string | null;
    }
  | {
      kind: 'council';
      subjectId: string;
      title: string;
      registrySubjects: string[];
    };

/** The altitude the focus lands at — the legend and the rail both name it. */
export type Altitude = 'sky' | 'domain' | 'category' | 'subject';

export interface CameraState {
  x: number;
  y: number;
  k: number;
}

/** Counts the HUD and the rail footer print. Pushed, never polled. */
export interface GalaxyCounts {
  altitude: Altitude;
  /** Rows at this altitude, before the name filter. */
  shown: number;
  /** Stars outside a council's set. Zero when nothing is focused. */
  dimmed: number;
  /** Stars inside a council's set. Zero when nothing is focused. */
  lit: number;
  /** Labels the occupancy pass could not place. */
  labelsHidden: number;
}
