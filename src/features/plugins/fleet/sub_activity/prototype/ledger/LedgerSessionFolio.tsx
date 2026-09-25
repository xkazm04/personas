/**
 * The selected session's folio (Ledger port): Tokens (four drawn figures, context,
 * cache share), Run (models, duration, turns, parse errors, project, origin),
 * Tools as a chip row, Files touched as single-line ledger rows (name, then the
 * folder quiet). The Open action is the page's existing door: the live session
 * when the registry has one, the transcript's insights otherwise.
 */
import { ArrowUpRight } from 'lucide-react';
import {
  Folio, FolioPart, KeyValueGrid, ChipRow, Figure, Units, LedgerBlock, LedgerRow, EmptyRow, ledgerCompact, type LedgerSpec,
} from '@/features/shared/components/kit-proto/ledger';
import { Button } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import { stateLabel, type LedgerSession } from './ledgerModel';

const FILE_SPEC: LedgerSpec = {};

function splitPath(p: string): { base: string; dir: string } {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return { base: p.slice(i + 1), dir: i > 0 ? p.slice(0, i) : '' };
}

export function LedgerSessionFolio({ session: s, onClose, onOpen }: { session: LedgerSession; onClose: () => void; onOpen: () => void }) {
  const { t, tx } = useTranslation();
  const f = t.plugins.fleet;
  const tk = s.tokens;
  const tmax = Math.max(tk.input, tk.output, tk.cacheCreation, tk.cacheRead) || 1;
  const toolMax = s.row.tools.reduce((a, x) => Math.max(a, x.count), 0) || 1;
  const n = (v: number) => <Numeric>{ledgerCompact(v)}</Numeric>;

  return (
    <Folio
      data-testid="kit-proto-ledger-folio"
      label={f.activity_detail_label}
      eyebrow={<>{f.monitor_col_session}<span className="dot">·</span><RelativeTime timestamp={s.row.lastTimestamp} showTooltip={false} /></>}
      title={s.title ?? <span className="k-quiet k-regular">{s.project}</span>}
      state={(
        <>
          {s.tone && <Units units={[{ tone: s.tone, hollow: s.hollow }]} label={stateLabel(f, s.state)} />}
          <span>{stateLabel(f, s.state)}{s.reason ? ` · ${s.reason}` : ''}</span>
        </>
      )}
      close={<Button variant="ghost" size="xs" onClick={onClose}>{t.common.close} <span className="kbd typo-code">Esc</span></Button>}
      actions={(
        <Button variant="secondary" size="xs" icon={<ArrowUpRight className="w-3.5 h-3.5" />} onClick={onOpen} data-testid="kit-proto-ledger-open">
          {s.live ? f.jump_to_session : f.view_insights}
        </Button>
      )}
    >
      <FolioPart title={f.insights_tokens} count={n(tk.total)}>
        <KeyValueGrid nullText={f.activity_not_recorded} items={[
          { key: 'in', label: f.insights_input, figure: <Figure value={n(tk.input)} of={tk.input / tmax} /> },
          { key: 'out', label: f.insights_output, figure: <Figure value={n(tk.output)} of={tk.output / tmax} /> },
          { key: 'cw', label: f.insights_cache_write, figure: <Figure value={n(tk.cacheCreation)} of={tk.cacheCreation / tmax} /> },
          { key: 'cr', label: f.insights_cache_read, figure: <Figure value={n(tk.cacheRead)} of={tk.cacheRead / tmax} tone="primary" /> },
          { key: 'ctx', label: f.activity_context, value: n(s.context) },
          { key: 'share', label: f.activity_cache_share, value: <Numeric value={s.cacheShare} unit="ratio" precision={0} /> },
        ]} />
      </FolioPart>
      <FolioPart title={f.activity_run}>
        <KeyValueGrid nullText={f.activity_not_recorded} items={[
          { key: 'models', label: f.activity_models, value: s.models.length ? s.models.join(', ') : null },
          { key: 'dur', label: f.activity_duration, value: tx(f.monitor_age_minutes, { count: s.durationMin }) },
          { key: 'turns', label: f.insights_turns, value: <><Numeric value={s.prompts} unit="count" /> {f.insights_prompts.toLowerCase()} · <Numeric value={s.replies} unit="count" /> {f.insights_turns.toLowerCase()}</> },
          { key: 'pe', label: f.activity_parse_errors, value: <Numeric value={s.row.parseErrors} unit="count" />, warn: s.row.parseErrors > 0 },
          { key: 'proj', label: f.monitor_col_project, value: s.row.cwd ? s.project : null },
          { key: 'origin', label: f.activity_origin, value: s.live?.origin ? `${s.live.origin.replace(/_/g, ' ')}${s.live.mode ? ` · ${s.live.mode}` : ''}` : null },
        ]} />
      </FolioPart>
      <FolioPart title={t.common.tools} count={<Numeric value={s.toolCalls} unit="count" />}>
        {s.row.tools.length
          ? <ChipRow chips={s.row.tools.map((x) => ({ name: x.name, count: <Numeric value={x.count} unit="count" />, share: x.count / toolMax }))} />
          : <EmptyRow title={f.insights_no_tools} />}
      </FolioPart>
      <FolioPart title={tx(f.insights_files, { count: s.files })}>
        {s.files ? (
          <LedgerBlock spec={FILE_SPEC} role="list" label={tx(f.insights_files, { count: s.files })}>
            {s.row.filesTouched.map((p) => {
              const { base, dir } = splitPath(p);
              return (
                <LedgerRow key={p} spec={FILE_SPEC} height={1} primary={(
                  <span className="lg-name typo-code">{base}{dir ? <> <span className="k-quiet">{dir}</span></> : null}</span>
                )} />
              );
            })}
          </LedgerBlock>
        ) : <EmptyRow title={f.insights_no_files} />}
      </FolioPart>
    </Folio>
  );
}
