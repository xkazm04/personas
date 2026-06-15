// State + actions for the Add-KPI modal, split out so the modal stays a thin
// presentational shell. Two submit paths:
//   · createManual — all fields required → an ACTIVE manual KPI, no LLM.
//   · setupWithAi  — a PROPOSED KPI; the backend (dev_tools_propose_kpi_auto)
//                    creates it and, for the codebase mechanism, runs a truly-
//                    background compose that applies the tested measurement +
//                    baseline. The modal closes immediately; the proposal lands
//                    in Teams › KPIs and fills in on its own.
import { useEffect, useMemo, useState } from 'react';

import * as kpiApi from '@/api/devTools/kpis';
import { listCredentials } from '@/api/vault/credentials';
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';
import type { ThemedSelectOption } from '@/features/shared/components/forms/ThemedSelect';

import { type KpiCategory, type KpiTier, type MeasureKind } from './factoryMock';
import { useFactoryData } from './factoryData';
import { CATEGORY_DEFAULT_KIND, DERIVED_METRICS, errMsg } from './composeTask';
import { num, type Measured } from './addKpiPrimitives';

export function useAddKpi({
  projectId,
  contextGroupId,
  contextId,
  onClose,
}: {
  projectId: string;
  contextGroupId?: string;
  contextId?: string;
  onClose: () => void;
}) {
  const { reload } = useFactoryData();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<KpiCategory>('technical');
  const [tier, setTier] = useState<KpiTier>('supporting');
  const [direction, setDirection] = useState<'up' | 'down'>('up');
  const [measured, setMeasured] = useState<Measured>('auto');
  const [autoKind, setAutoKind] = useState<MeasureKind>('codebase');
  const [connector, setConnector] = useState('');
  const [derivedMetric, setDerivedMetric] = useState('');
  const [unit, setUnit] = useState('');
  const [baseline, setBaseline] = useState('');
  const [target, setTarget] = useState('');
  const [cadence, setCadence] = useState('weekly');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [creds, setCreds] = useState<PersonaCredential[]>([]);
  useEffect(() => {
    let alive = true;
    void listCredentials().then((c) => { if (alive) setCreds(c); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const connectorOpts: ThemedSelectOption[] = useMemo(
    () => creds.map((c) => ({ value: c.serviceType, label: c.name, description: c.serviceType })),
    [creds],
  );
  const derivedOpts: ThemedSelectOption[] = useMemo(
    () => DERIVED_METRICS.map((m) => ({ value: m.id, label: m.label, description: m.hint })),
    [],
  );

  const onCategory = (c: KpiCategory) => {
    setCategory(c);
    const def = CATEGORY_DEFAULT_KIND[c];
    if (def !== 'manual') setAutoKind(def);
  };

  const isManual = measured === 'manual';
  const manualReady = name.trim() !== '' && unit.trim() !== '' && num(baseline) != null && num(target) != null;

  const createManual = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const kpi = await kpiApi.createKpi({
        projectId, name: name.trim(), description: description.trim() || undefined,
        contextGroupId, contextId, category, measureKind: 'manual',
        unit: unit.trim() || undefined, direction,
        baselineValue: num(baseline), targetValue: num(target),
        cadence, status: 'active',
      });
      if (tier !== 'supporting') await kpiApi.updateKpi(kpi.id, { tier });
      reload();
      onClose();
    } catch (e) {
      setMsg(errMsg(e));
      setBusy(false);
    }
  };

  const setupWithAi = async () => {
    if (!name.trim()) { setMsg('Give the KPI a name.'); return; }
    setBusy(true);
    setMsg(null);
    try {
      await kpiApi.proposeKpiAuto(projectId, {
        contextGroupId, contextId, name: name.trim(), description: description.trim() || undefined,
        category, tier, direction, measureKind: autoKind, cadence,
        unit: unit.trim() || undefined,
        neededConnector: autoKind === 'connector' ? (connector || undefined) : undefined,
        derivedMetric: autoKind === 'derived' ? (derivedMetric || undefined) : undefined,
      });
      reload();
      onClose();
    } catch (e) {
      setMsg(errMsg(e));
      setBusy(false);
    }
  };

  return {
    name, setName, description, setDescription, category, onCategory, tier, setTier,
    direction, setDirection, measured, setMeasured, autoKind, setAutoKind,
    connector, setConnector, derivedMetric, setDerivedMetric, unit, setUnit,
    baseline, setBaseline, target, setTarget, cadence, setCadence,
    busy, msg, isManual, manualReady, connectorOpts, derivedOpts,
    createManual, setupWithAi,
  };
}
