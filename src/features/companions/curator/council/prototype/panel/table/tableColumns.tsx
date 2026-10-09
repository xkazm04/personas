// PROTOTYPE ROUND (spark council-readout), direction C. The table's columns
// and cells. Two column sets from one model: with room (the 1920 stage) the
// project and its round get their own column; on a narrower panel they ride
// above the title as its eyebrow, so the title keeps its width.
//
// The heads sort (the kit's own sort buttons): project, the measured share
// (the bullet's band), the overall (its bar and figure) and the must-address
// count. A third press on a head returns to the queue's own order.
import type { ReactNode } from 'react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Ghost, type TableCol, type TableRow } from '@/features/shared/components/kit';
import { interpolate as tx, useTranslation } from '@/i18n/useTranslation';
import { formatCount } from '@/lib/utils/formatters';

import type { PanelRow } from '../../protoModel';
import { usePercent } from '../../../table/usePercent';
import { BulletFigure } from './BulletFigure';
import { MemberDots, MemberHead } from './MemberDots';
import { overallTone } from './tableModel';

const S = {
  council: 'Council',
  project: 'Project',
  projectCouncil: 'Project · council',
  measured: 'Measured',
  overall: 'Overall',
  mustAddress: 'To fix',
  lite: 'lite',
  roundN: 'round {n}',
  notMeasured: 'not measured',
  hard: '{n} hard failure',
  bulletLabel: 'Overall {overall} against the bar {threshold}; {coverage} of the weight measured',
  bulletTip: '{coverage} of the council weight measured. The bar is advisory while the council is uncalibrated.',
  mustLabel: '{n} must-address items',
};

export type ColKey = 'title' | 'project' | 'bullet' | 'score' | 'members' | 'must';

/** Dot 20 + gap 6: the members' pitch, shared with MemberDots' CSS. */
export const DOT_PITCH = 26;

export function useTableColumns({
  rows,
  members,
  wide,
  selectedId,
}: {
  rows: PanelRow[];
  members: string[];
  wide: boolean;
  selectedId: string | null;
}): { cols: TableCol<ColKey>[]; tableRows: TableRow<ColKey>[] } {
  const { language } = useTranslation();
  const percent = usePercent();
  const bulletW = wide ? 168 : 100;
  const num = (v: number) => formatCount(v, { precision: 2, language });

  const cols: TableCol<ColKey>[] = [
    wide
      ? { key: 'title', label: <span className="typo-body">{S.council}</span> }
      : { key: 'title', label: S.projectCouncil, sortable: 'asc' },
    ...(wide ? [{ key: 'project', label: S.project, sortable: 'asc', width: '8rem' } satisfies TableCol<ColKey>] : []),
    { key: 'bullet', label: S.measured, sortable: 'desc', width: `${bulletW + 20}px` },
    { key: 'score', label: S.overall, sortable: 'desc', width: wide ? '5rem' : '4.25rem' },
    { key: 'members', label: <MemberHead columns={members} />, width: `${members.length * DOT_PITCH + 14}px` },
    { key: 'must', label: S.mustAddress, sortable: 'desc', num: true, width: wide ? '4.5rem' : '4rem' },
  ];

  const tableRows = rows.map((row): TableRow<ColKey> => {
    const s = row.subject;
    const selected = s.id === selectedId;
    const threshold = row.rubric.threshold;
    const lite = row.liteOnly ? <span className="bt-lite typo-body">{S.lite}</span> : null;
    const roundText = s.roundNo == null ? null : tx(S.roundN, { n: s.roundNo });
    const coverageText = s.coverage == null ? S.notMeasured : percent(s.coverage);
    const tone = s.overall == null ? null : overallTone(s.overall, threshold);

    const where: ReactNode = (
      <>
        <span>{s.projectName}</span>
        {roundText && <span>{roundText}</span>}
        {lite}
      </>
    );

    const title = (
      <span className="bt-titlecell">
        {!wide && <span className="bt-eyebrow typo-body">{where}</span>}
        <span className={`bt-title ${wide ? 'typo-title-lg' : 'typo-heading'}${selected ? ' is-on' : ''}`}>{s.title}</span>
        {s.hardFailures > 0 && <span className="typo-body text-status-error">{tx(S.hard, { n: s.hardFailures })}</span>}
      </span>
    );

    const bullet = (
      <Tooltip content={<span className="typo-body">{tx(S.bulletTip, { coverage: coverageText })}</span>}>
        <BulletFigure
          overall={s.overall}
          coverage={s.coverage}
          threshold={threshold}
          lite={row.liteOnly}
          width={bulletW}
          label={tx(S.bulletLabel, {
            overall: s.overall == null ? S.notMeasured : num(s.overall),
            threshold: num(threshold),
            coverage: coverageText,
          })}
        />
      </Tooltip>
    );

    const must =
      row.mustAddress == null ? (
        <Ghost width="28px" inline />
      ) : (
        <b
          className={`typo-heading font-data ${row.mustAddress > 0 ? 'text-status-warning' : 'text-muted'}`}
          aria-label={tx(S.mustLabel, { n: row.mustAddress })}
        >
          {row.mustAddress}
        </b>
      );

    return {
      id: s.id,
      state: selected ? 'selected' : undefined,
      sort: {
        title: `${s.projectName} ${s.title}`,
        project: `${s.projectName} ${s.title}`,
        bullet: s.coverage,
        score: s.overall,
        must: row.mustAddress,
      },
      cells: {
        title,
        project: (
          <span className="bt-where typo-body">
            <span className="text-foreground">{s.projectName}</span>
            {(roundText || lite) && (
              <span className="bt-where__round">
                {roundText}
                {lite}
              </span>
            )}
          </span>
        ),
        bullet,
        score:
          s.overall == null ? (
            <span className="typo-body text-muted">{S.notMeasured}</span>
          ) : (
            <b className={`bt-num typo-heading font-data is-${tone}`}>{num(s.overall)}</b>
          ),
        members: <MemberDots seats={row.seats} columns={members} />,
        must,
      },
    };
  });

  return { cols, tableRows };
}
