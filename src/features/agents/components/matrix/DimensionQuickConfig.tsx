import { useState, useRef, useEffect, useCallback } from 'react';
import { Clock, Plug, ChevronUp, ChevronDown, Zap } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useHealthyConnectors } from './useHealthyConnectors';
import { SchedulePanel } from './SchedulePanel';
import { ServicesPanel } from './ServicesPanel';
import { EventsPanel } from './EventsPanel';
import type { Frequency, EventSubscription, QuickConfigState } from './quickConfigTypes';

// Re-export public API so existing consumers don't need to change imports
export { serializeQuickConfig, describeTriggerConfig, describeSelectedConnectors } from './quickConfigTypes';
export type { QuickConfigState, EventSubscription } from './quickConfigTypes';

// ---------------------------------------------------------------------------
// Main toolbar overlay
// ---------------------------------------------------------------------------

interface DimensionQuickConfigProps {
  onChange: (state: QuickConfigState) => void;
}

export function DimensionQuickConfig({ onChange }: DimensionQuickConfigProps) {
  const { t } = useTranslation();
  const healthyConnectors = useHealthyConnectors();
  const [collapsed, setCollapsed] = useState(false);
  const [openPanel, setOpenPanel] = useState<'conditions' | 'services' | null>(null);

  const [frequency, setFrequency] = useState<Frequency | null>(null);
  const [days, setDays] = useState<string[]>(['mon']);
  const [monthDay, setMonthDay] = useState(1);
  const [time, setTime] = useState('09:00');
  const [selectedConnectors, setSelectedConnectors] = useState<string[]>([]);
  const [connectorTables, setConnectorTables] = useState<Record<string, string>>({});
  const [selectedEvents, setSelectedEvents] = useState<EventSubscription[]>([]);

  // Notify parent on change
  useEffect(() => {
    onChange({ frequency, days, monthDay, time, selectedConnectors, connectorTables, selectedEvents });
  }, [frequency, days, monthDay, time, selectedConnectors, connectorTables, selectedEvents, onChange]);

  const toggleConnector = useCallback((name: string) => {
    setSelectedConnectors((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  }, []);

  const handleTableSelect = useCallback((connectorName: string, tableName: string | null) => {
    setConnectorTables((prev) => {
      if (tableName === null) {
        const next = { ...prev };
        delete next[connectorName];
        return next;
      }
      return { ...prev, [connectorName]: tableName };
    });
  }, []);

  const toggleEvent = useCallback((event: EventSubscription) => {
    setSelectedEvents((prev) =>
      prev.some((e) => e.triggerId === event.triggerId)
        ? prev.filter((e) => e.triggerId !== event.triggerId)
        : [...prev, event],
    );
  }, []);

  const togglePanel = (panel: 'conditions' | 'services') => {
    setOpenPanel((prev) => (prev === panel ? null : panel));
  };

  // Animated panel height
  const conditionsRef = useRef<HTMLDivElement>(null);
  const servicesRef = useRef<HTMLDivElement>(null);
  const [conditionsHeight, setConditionsHeight] = useState(0);
  const [servicesHeight, setServicesHeight] = useState(0);

  useEffect(() => {
    if (openPanel !== 'conditions' || !conditionsRef.current) return;
    const el = conditionsRef.current;
    setConditionsHeight(el.scrollHeight);
    const ro = new ResizeObserver(() => {
      setConditionsHeight(el.scrollHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [openPanel]);

  useEffect(() => {
    if (openPanel !== 'services' || !servicesRef.current) return;
    const el = servicesRef.current;
    setServicesHeight(el.scrollHeight);
    const ro = new ResizeObserver(() => {
      setServicesHeight(el.scrollHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [openPanel]);

  return (
    <div className="w-full min-w-[1100px]">
      <div className="rounded-modal border border-primary/10 bg-white/[0.03] backdrop-blur-sm overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <Zap className="w-3.5 h-3.5 text-amber-400/70 flex-shrink-0" />
          <span className="text-[11px] font-semibold text-muted-foreground/50 uppercase tracking-wider">{t.agents.quick_config.title}</span>

          {!collapsed && (
            <div className="flex items-center gap-2 ml-2">
              <button
                type="button"
                onClick={() => togglePanel('conditions')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-card text-xs font-medium transition-all duration-200 ${
                  openPanel === 'conditions'
                    ? 'bg-primary/15 text-primary border border-primary/25'
                    : 'bg-secondary/20 text-muted-foreground/60 border border-transparent hover:border-primary/15'
                }`}
              >
                <Clock className="w-3 h-3" />
                {t.agents.quick_config.start_conditions}
                {(frequency || selectedEvents.length > 0) && (
                  <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-primary/20 text-primary leading-none">
                    {(frequency ? 1 : 0) + selectedEvents.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => togglePanel('services')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-card text-xs font-medium transition-all duration-200 ${
                  openPanel === 'services'
                    ? 'bg-primary/15 text-primary border border-primary/25'
                    : 'bg-secondary/20 text-muted-foreground/60 border border-transparent hover:border-primary/15'
                }`}
              >
                <Plug className="w-3 h-3" />
                {t.agents.quick_config.apps_and_services}
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => { setCollapsed(!collapsed); setOpenPanel(null); }}
            className="ml-auto text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors p-1"
          >
            {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Start Conditions panel — schedule + event triggers unified */}
        <div
          className="transition-[max-height,opacity] duration-250 ease-out overflow-hidden"
          style={{
            maxHeight: openPanel === 'conditions' ? conditionsHeight : 0,
            opacity: openPanel === 'conditions' ? 1 : 0,
          }}
        >
          <div ref={conditionsRef} className="border-t border-primary/8 px-4 py-4">
            <div className="flex gap-6">
              <div className="flex-1 min-w-0">
                <span className="text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider mb-2 block">{t.agents.quick_config.time_schedule}</span>
                <SchedulePanel
                  frequency={frequency} setFrequency={setFrequency}
                  days={days} setDays={setDays}
                  monthDay={monthDay} setMonthDay={setMonthDay}
                  time={time} setTime={setTime}
                />
              </div>
              <div className="w-px bg-primary/8 self-stretch" />
              <div className="flex-1 min-w-0">
                <span className="text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider mb-2 block">{t.agents.quick_config.event_triggers}</span>
                <EventsPanel
                  selectedEvents={selectedEvents}
                  onToggleEvent={toggleEvent}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Services dropdown panel */}
        <div
          className="transition-[max-height,opacity] duration-250 ease-out overflow-hidden"
          style={{
            maxHeight: openPanel === 'services' ? servicesHeight : 0,
            opacity: openPanel === 'services' ? 1 : 0,
          }}
        >
          <div ref={servicesRef} className="border-t border-primary/8 px-4 py-4">
            <ServicesPanel
              connectors={healthyConnectors}
              selectedConnectors={selectedConnectors}
              onToggle={toggleConnector}
              connectorTables={connectorTables}
              onTableSelect={handleTableSelect}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
