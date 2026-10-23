/**
 * EmptyArt motifs, part 2: places data lands (archive, stream, links, inbox,
 * search, folders, charts, shields, bells, reports). Conventions: motifsWork.tsx.
 */
import { at } from './motifsWork';

export function ArchiveMotif() {
  return (
    <g>
      <g className="ea-float" style={at(0)}>
        <g className="ea-pop" style={at(600)}>
          <rect className="ea-fill-strong" x="37" y="18" width="22" height="15" rx="2" />
          <path className="ea-line-accent" d="M37 20 L48 28 L59 20 M37 18 H59 V33 H37 Z" />
        </g>
      </g>
      <rect className="ea-fill" x="26" y="46" width="44" height="26" rx="4" />
      <path className="ea-line ea-draw" pathLength={1} d="M28 46 V68 Q28 72 32 72 H64 Q68 72 68 68 V46" />
      <rect className="ea-line ea-draw" pathLength={1} style={at(200)} x="23" y="38" width="50" height="9" rx="3" />
      <path className="ea-line ea-draw" pathLength={1} style={at(450)} d="M41 56 H55" />
    </g>
  );
}

export function StreamMotif() {
  return (
    <g>
      <circle className="ea-line-accent ea-ring" style={at(0)} cx="48" cy="50" r="10" />
      <circle className="ea-line-accent ea-ring" style={at(1400)} cx="48" cy="50" r="10" />
      <path className="ea-line ea-draw" pathLength={1} d="M37 39 A15 15 0 0 0 37 61 M59 39 A15 15 0 0 1 59 61" />
      <path className="ea-line ea-draw" pathLength={1} style={at(250)} d="M29 31 A26 26 0 0 0 29 69 M67 31 A26 26 0 0 1 67 69" />
      <circle className="ea-dot ea-pop" style={at(500)} cx="48" cy="50" r="4.5" />
    </g>
  );
}

export function LinkMotif() {
  return (
    <g>
      <path className="ea-line ea-draw" pathLength={1} style={at(300)} d="M35 48 H61" />
      <path className="ea-line ea-draw" pathLength={1} style={at(450)} d="M48 48 V32" />
      <circle className="ea-fill" cx="28" cy="48" r="8" />
      <circle className="ea-line ea-draw" pathLength={1} cx="28" cy="48" r="8" />
      <circle className="ea-fill" cx="68" cy="48" r="8" />
      <circle className="ea-line ea-draw" pathLength={1} style={at(150)} cx="68" cy="48" r="8" />
      <circle className="ea-line-accent ea-draw" pathLength={1} style={at(550)} cx="48" cy="27" r="5" />
      <g className="ea-fade" style={at(700)}>
        <circle className="ea-dot ea-drift" style={at(0)} cx="48" cy="48" r="3" />
      </g>
    </g>
  );
}

export function InboxMotif() {
  return (
    <g>
      <path className="ea-fill" d="M24 52 L31 34 H65 L72 52 V68 H24 Z" />
      <path className="ea-line ea-draw" pathLength={1} d="M24 52 L31 34 H65 L72 52 V64 Q72 68 68 68 H28 Q24 68 24 64 Z" />
      <path className="ea-line ea-draw" pathLength={1} style={at(300)} d="M24 52 H37 L41 58 H55 L59 52 H72" />
      <g className="ea-pop" style={at(750)}>
        <g className="ea-float" style={at(0)}>
          <circle className="ea-fill-strong" cx="66" cy="27" r="9" />
          <path className="ea-line-good" d="M62 27 L65 30 L71 24" />
        </g>
      </g>
    </g>
  );
}

export function SearchMotif() {
  return (
    <g>
      <path className="ea-line ea-draw" pathLength={1} style={at(100)} d="M24 70 H44 M24 76 H36" opacity="0.5" />
      <g className="ea-scan" style={at(0)}>
        <circle className="ea-fill" cx="44" cy="42" r="14" />
        <circle className="ea-line ea-draw" pathLength={1} cx="44" cy="42" r="14" />
        <path className="ea-line ea-draw" pathLength={1} style={at(400)} d="M54 52 L67 65" />
        <path className="ea-line-accent ea-draw" pathLength={1} style={at(600)} d="M37 37 A8 8 0 0 1 44 33" />
      </g>
    </g>
  );
}

export function FolderMotif() {
  return (
    <g>
      <g className="ea-float" style={at(0)}>
        <g className="ea-fade" style={at(500)}>
          <rect className="ea-fill-strong" x="34" y="26" width="26" height="26" rx="3" />
          <path className="ea-line-accent" d="M39 33 H55 M39 39 H51" />
        </g>
      </g>
      <path className="ea-fill" d="M24 40 H72 V68 H24 Z" />
      <path className="ea-line ea-draw" pathLength={1} d="M24 36 Q24 32 28 32 H40 L45 37 H68 Q72 37 72 41 V66 Q72 70 68 70 H28 Q24 70 24 66 Z" />
      <path className="ea-line ea-draw" pathLength={1} style={at(300)} d="M24 46 H72" />
    </g>
  );
}

export function ChartMotif() {
  return (
    <g>
      <path className="ea-line ea-draw" pathLength={1} d="M26 24 V70 H72" />
      <rect className="ea-fill-strong ea-rise" style={at(250)} x="33" y="52" width="8" height="18" rx="2" />
      <rect className="ea-fill-strong ea-rise" style={at(380)} x="46" y="42" width="8" height="28" rx="2" />
      <rect className="ea-fill-strong ea-rise" style={at(510)} x="59" y="32" width="8" height="38" rx="2" />
      <path className="ea-line-accent ea-draw" pathLength={1} style={at(650)} d="M33 46 L50 36 L63 26" />
      <g className="ea-pop" style={at(1100)}>
        <circle className="ea-dot ea-pulse" style={at(0)} cx="63" cy="26" r="3.5" />
      </g>
    </g>
  );
}

export function ShieldMotif() {
  return (
    <g>
      <path className="ea-fill" d="M48 20 L70 28 V46 C70 60 60 70 48 76 C36 70 26 60 26 46 V28 Z" />
      <path className="ea-line ea-draw" pathLength={1} d="M48 20 L70 28 V46 C70 60 60 70 48 76 C36 70 26 60 26 46 V28 Z" />
      <circle className="ea-line-accent ea-ring" style={at(0)} cx="48" cy="46" r="8" />
      <g className="ea-pop" style={at(550)}>
        <circle className="ea-dot" cx="48" cy="43" r="4" />
        <path className="ea-line-accent" d="M48 47 V56" />
      </g>
    </g>
  );
}

export function BellMotif() {
  return (
    <g>
      <g className="ea-swing" style={at(0)}>
        <path className="ea-fill" d="M34 60 V46 C34 37 40 30 48 30 C56 30 62 37 62 46 V60 L66 64 H30 Z" />
        <path className="ea-line ea-draw" pathLength={1} d="M34 60 V46 C34 37 40 30 48 30 C56 30 62 37 62 46 V60 L66 64 H30 Z" />
        <path className="ea-line ea-draw" pathLength={1} style={at(300)} d="M48 30 V25" />
        <circle className="ea-dot ea-pop" style={at(600)} cx="48" cy="69" r="3.5" />
      </g>
      <path className="ea-line-accent ea-draw" pathLength={1} style={at(700)} d="M24 40 Q22 46 24 52 M72 40 Q74 46 72 52" />
    </g>
  );
}

export function ReportMotif() {
  return (
    <g>
      <path className="ea-fill" d="M30 20 H56 L66 30 V76 H30 Z" />
      <path className="ea-line ea-draw" pathLength={1} d="M34 20 H56 L66 30 V72 Q66 76 62 76 H34 Q30 76 30 72 V24 Q30 20 34 20 Z M56 20 V30 H66" />
      <path className="ea-line ea-draw" pathLength={1} style={at(350)} d="M37 40 H58 M37 48 H58 M37 56 H50" />
      <g className="ea-pop" style={at(800)}>
        <g className="ea-float" style={at(0)}>
          <circle className="ea-fill-strong" cx="64" cy="64" r="9" />
          <path className="ea-line-accent" d="M60 64 L63 67 L68 61" />
        </g>
      </g>
    </g>
  );
}
