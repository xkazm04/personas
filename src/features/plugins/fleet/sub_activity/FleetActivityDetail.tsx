/**
 * Fleet Activity (composition kit): the selected session's detail layer (the side pane on a wide
 * surface, the drawer on a narrow one). Tokens, run facts, tools and files, from the transcript's
 * own rollup; Open (or Enter) goes where a row click went before (live session or insights).
 */
import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import { Numeric } from '@/features/shared/components/display/Numeric';
import {
  ChipRow, Dot, KeyValueGrid, KitButton, ListRow, Meta, Rows, Section, UnitStrip, apportion,
} from '@/features/shared/components/kit';
import { STATE_GLYPH, TOKEN_PARTS, splitPath, type ActivitySession } from './activityModel';
import type { ActivityWords } from './useActivityWords';

export function FleetActivityDetail({ s, live, onOpen, w }: {
  s: ActivitySession | null;
  live: boolean;
  onOpen: (s: ActivitySession) => void;
  w: ActivityWords;
}) {
  if (!s) return <Section title={w.f.monitor_col_session} state="empty" empty={{ title: w.f.activity_empty }} />;
  const g = STATE_GLYPH[s.state];
  const t = s.tokens;
  const top = s.row.tools[0]?.count ?? 1;
  const stateLabel = w.state[s.state];
  return (
    <Section
      id="s-fa-detail"
      eyebrow={`${w.f.monitor_col_session} · ${stateLabel}`}
      title={s.title ?? <span className="k-quiet">{s.project ?? w.t.overview.activity.unknown}</span>}
      meta={<Meta parts={[s.project, s.model, stateLabel]} />}
      state={s.state === 'gone' ? 'muted' : undefined}
      actions={
        <KitButton onClick={() => onOpen(s)} hint="↵" testId="fleet-activity-open">
          {live ? w.f.jump_to_session : w.f.view_insights}
        </KitButton>
      }
    >
      {s.stateReason && <p className="k-in typo-caption" style={{ margin: '0 0 12px' }}><Dot {...g} /> {s.stateReason}</p>}
      <Section
        level={2}
        title={w.f.insights_tokens}
        count={<Numeric value={t.total} unit="compact" />}
        meta={w.tx(w.f.fleet_cache_hit, { percent: Math.round(s.cacheShare * 100) })}
      >
        <div className="k-in" style={{ margin: '2px 0 10px' }}>
          <UnitStrip size="m" rows={4} label={w.f.insights_tokens} segments={apportion(TOKEN_PARTS.map((p) => ({ value: t[p.k], tone: p.tone })), 50_000)} />
        </div>
        <KeyValueGrid
          min="120px"
          items={[
            ...TOKEN_PARTS.map((p) => ({ k: w.tokenLabels[p.k], v: <Numeric value={t[p.k]} unit="count" />, draw: <Dot tone={p.tone} /> })),
            { k: w.t.monitor.context, v: <Numeric value={Number(s.row.lastContextTokens)} unit="count" /> },
          ]}
        />
      </Section>
      <Section
        level={2}
        title={w.t.monitor.run}
        meta={s.row.parseErrors > 0 ? <span className="t-error k-toned">{w.tx(w.f.insights_parse_errors, { count: s.row.parseErrors })}</span> : undefined}
      >
        <KeyValueGrid
          min="120px"
          items={[
            { k: w.t.agents.ops.models, v: s.models.length ? s.models.join(', ') : null, none: w.t.common.none },
            { k: w.t.overview.activity.col_duration, v: s.durationMin == null ? null : w.tx(w.f.insights_span, { minutes: s.durationMin }), none: w.t.common.none },
            {
              k: w.f.insights_turns,
              v: `${s.row.userMessages} · ${s.row.assistantMessages}`,
              draw: <UnitStrip size="s" label={w.f.insights_turns} segments={[{ n: s.row.userMessages / 5, tone: 'human' }, { n: s.row.assistantMessages / 5, tone: 'agent' }]} />,
            },
            { k: w.t.monitor.grid_session_recap_last_activity, v: s.row.lastTimestamp ? <AbsoluteTime timestamp={s.row.lastTimestamp} variant="compact" /> : null, none: w.t.common.none },
            { k: w.t.overview.athena.spend_origin, v: s.origin, none: w.t.common.inactive },
          ]}
        />
      </Section>
      <Section level={2} title={w.t.common.tools} count={s.toolCalls}>
        <ChipRow
          label={w.f.insights_tools}
          emptyLabel={w.f.insights_no_tools}
          chips={s.row.tools.map((x) => ({ id: x.name, label: x.name, count: x.count, share: x.count / top }))}
        />
      </Section>
      <Section level={2} title={w.tx(w.f.insights_files, { count: s.row.filesTouched.length })}>
        <Rows count={s.row.filesTouched.length} empty={{ title: w.f.insights_no_files }}>
          {s.row.filesTouched.map((file) => {
            const { base, dir } = splitPath(file);
            return <ListRow key={file} size="s" name={base} nameClass="typo-code k-strong" meta={dir || '/'} mark={{ tone: 'highlight', glyph: 'soft', label: w.files }} />;
          })}
        </Rows>
      </Section>
    </Section>
  );
}
