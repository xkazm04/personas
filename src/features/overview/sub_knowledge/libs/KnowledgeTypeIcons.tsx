import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const defaults: IconProps = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  stroke: 'currentColor',
};

/** Interconnected chain links — represents tool sequences */
export function ToolSequenceIcon(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M4.5 6.5L7 4a2.12 2.12 0 0 1 3 3L7.5 9.5" />
      <path d="M11.5 9.5L9 12a2.12 2.12 0 0 1-3-3L8.5 6.5" />
      <circle cx="3.5" cy="3.5" r="1" />
      <circle cx="12.5" cy="12.5" r="1" />
    </svg>
  );
}

/** Fractured circuit node — represents failure patterns */
export function FailurePatternIcon(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <circle cx="8" cy="8" r="3.5" />
      <path d="M6 6l4 4" />
      <path d="M10 6l-4 4" />
      <path d="M8 1.5v3" />
      <path d="M8 11.5v3" />
      <path d="M1.5 8h3" />
      <path d="M11.5 8h3" />
    </svg>
  );
}

/** Speedometer with neural spokes — represents model performance */
export function ModelPerformanceIcon(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M3 12a6 6 0 0 1 10 0" />
      <path d="M8 12V7" />
      <path d="M8 7l2.5 1.5" />
      <path d="M8 7L5.5 8.5" />
      <circle cx="8" cy="6" r="1" />
      <circle cx="4" cy="11" r="0.75" />
      <circle cx="12" cy="11" r="0.75" />
    </svg>
  );
}

/** Stacked coin with data flow lines — represents cost patterns */
export function CostPatternIcon(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <ellipse cx="8" cy="5" rx="4.5" ry="2" />
      <path d="M3.5 5v3c0 1.1 2 2 4.5 2s4.5-.9 4.5-2V5" />
      <path d="M3.5 8v3c0 1.1 2 2 4.5 2s4.5-.9 4.5-2V8" />
      <path d="M13 7l1.5 1-1.5 1" />
    </svg>
  );
}

/** Speech bubble with brain inside — represents agent annotations */
export function AgentAnnotationIcon(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M3 3h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H6l-3 2.5V11a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M6.5 7c0-1 .7-1.5 1.5-1.5s1.5.5 1.5 1.5-.7 1.5-1.5 1.5" />
      <circle cx="8" cy="9.5" r="0.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Speech bubble with pencil — represents user annotations */
export function UserAnnotationIcon(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M3 3h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H6l-3 2.5V11a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M7 9l2.5-2.5a.7.7 0 0 1 1 1L8 10H7V9z" />
    </svg>
  );
}

/** Data flow network — represents data flow patterns */
export function DataFlowIcon(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <circle cx="3" cy="4" r="1.5" />
      <circle cx="13" cy="4" r="1.5" />
      <circle cx="8" cy="12" r="1.5" />
      <path d="M4.2 5.2L7 10.5" />
      <path d="M11.8 5.2L9 10.5" />
      <path d="M4.5 4h7" />
    </svg>
  );
}

/** Cost/quality balance — represents cost quality tradeoffs */
export function CostQualityIcon(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M2 12l3-4 2.5 2L11 5l3 3" />
      <circle cx="2" cy="12" r="0.75" />
      <circle cx="14" cy="8" r="0.75" />
    </svg>
  );
}
