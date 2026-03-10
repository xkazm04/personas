import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Trash2, ToggleLeft, ToggleRight, Pencil, X, Check } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import {
  ALERT_METRIC_OPTIONS,
  ALERT_SEVERITY_OPTIONS,
  type AlertMetric,
  type AlertOperator,
  type AlertSeverity,
  type AlertRule,
} from '@/stores/slices/alertSlice';

// ── Rule Form ─────────────────────────────────────────────────────────

interface RuleFormData {
  name: string;
  metric: AlertMetric;
  operator: AlertOperator;
  threshold: string;
  severity: AlertSeverity;
  personaId: string | null;
}

const DEFAULT_FORM: RuleFormData = {
  name: '',
  metric: 'error_rate',
  operator: '>',
  threshold: '10',
  severity: 'warning',
  personaId: null,
};

function RuleForm({
  initial,
  personas,
  onSubmit,
  onCancel,
}: {
  initial?: RuleFormData;
  personas: { id: string; name: string }[];
  onSubmit: (data: RuleFormData) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<RuleFormData>(initial ?? DEFAULT_FORM);
  const metricInfo = ALERT_METRIC_OPTIONS.find(m => m.value === form.metric);

  return (
    <div className="space-y-3 p-3 rounded-xl border border-primary/15 bg-secondary/20">
      {/* Name */}
      <input
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
        placeholder="Rule name (e.g. High error rate)"
        className="w-full px-3 py-2 text-sm rounded-lg bg-secondary/40 border border-primary/15 text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/30"
      />

      {/* Metric + Operator + Threshold */}
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={form.metric}
          onChange={(e) => setForm({ ...form, metric: e.target.value as AlertMetric })}
          className="px-2.5 py-1.5 text-sm rounded-lg bg-secondary/40 border border-primary/15 text-foreground focus:outline-none"
        >
          {ALERT_METRIC_OPTIONS.map(m => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>

        <select
          value={form.operator}
          onChange={(e) => setForm({ ...form, operator: e.target.value as AlertOperator })}
          className="px-2.5 py-1.5 text-sm rounded-lg bg-secondary/40 border border-primary/15 text-foreground focus:outline-none w-16"
        >
          <option value=">">&gt;</option>
          <option value="<">&lt;</option>
          <option value=">=">&ge;</option>
          <option value="<=">&le;</option>
        </select>

        <div className="relative">
          <input
            type="number"
            value={form.threshold}
            onChange={(e) => setForm({ ...form, threshold: e.target.value })}
            className="w-24 px-2.5 py-1.5 text-sm rounded-lg bg-secondary/40 border border-primary/15 text-foreground focus:outline-none pr-6"
            step="any"
          />
          {metricInfo?.unit && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground/50">
              {metricInfo.unit}
            </span>
          )}
        </div>
      </div>

      {/* Severity + Scope */}
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={form.severity}
          onChange={(e) => setForm({ ...form, severity: e.target.value as AlertSeverity })}
          className="px-2.5 py-1.5 text-sm rounded-lg bg-secondary/40 border border-primary/15 text-foreground focus:outline-none"
        >
          {ALERT_SEVERITY_OPTIONS.map(s => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>

        <select
          value={form.personaId ?? '__global__'}
          onChange={(e) => setForm({ ...form, personaId: e.target.value === '__global__' ? null : e.target.value })}
          className="px-2.5 py-1.5 text-sm rounded-lg bg-secondary/40 border border-primary/15 text-foreground focus:outline-none flex-1 min-w-[120px]"
        >
          <option value="__global__">All agents (global)</option>
          {personas.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => {
            if (!form.name.trim() || !form.threshold) return;
            onSubmit(form);
          }}
          disabled={!form.name.trim() || !form.threshold}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Check className="w-3.5 h-3.5" /> Save
        </button>
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-primary/15 text-muted-foreground hover:bg-secondary/40 transition-colors"
        >
          <X className="w-3.5 h-3.5" /> Cancel
        </button>
      </div>
    </div>
  );
}

// ── Rule Row ──────────────────────────────────────────────────────────

function RuleRow({
  rule,
  personas,
  onToggle,
  onDelete,
  onEdit,
}: {
  rule: AlertRule;
  personas: { id: string; name: string }[];
  onToggle: () => void;
  onDelete: () => void;
  onEdit: () => void;
}) {
  const metricInfo = ALERT_METRIC_OPTIONS.find(m => m.value === rule.metric);
  const sevInfo = ALERT_SEVERITY_OPTIONS.find(s => s.value === rule.severity);
  const scopeName = rule.personaId ? personas.find(p => p.id === rule.personaId)?.name ?? 'Unknown' : 'Global';

  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors ${rule.enabled ? 'border-primary/15 bg-secondary/20' : 'border-primary/8 bg-secondary/10 opacity-60'}`}>
      <button onClick={onToggle} className="shrink-0 text-muted-foreground hover:text-foreground transition-colors" title={rule.enabled ? 'Disable' : 'Enable'}>
        {rule.enabled
          ? <ToggleRight className="w-5 h-5 text-emerald-400" />
          : <ToggleLeft className="w-5 h-5" />
        }
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground truncate">{rule.name}</span>
          <span
            className="px-1.5 py-0.5 rounded text-[10px] font-medium"
            style={{ backgroundColor: `${sevInfo?.color ?? '#888'}20`, color: sevInfo?.color ?? '#888' }}
          >
            {sevInfo?.label ?? rule.severity}
          </span>
        </div>
        <p className="text-xs text-muted-foreground/60 mt-0.5">
          {metricInfo?.label ?? rule.metric} {rule.operator} {rule.threshold}{metricInfo?.unit ?? ''} &middot; {scopeName}
        </p>
      </div>
      <button onClick={onEdit} className="p-1 text-muted-foreground/50 hover:text-muted-foreground transition-colors" title="Edit">
        <Pencil className="w-3.5 h-3.5" />
      </button>
      <button onClick={onDelete} className="p-1 text-muted-foreground/50 hover:text-red-400 transition-colors" title="Delete">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────

export function AlertRulesPanel() {
  const alertRules = usePersonaStore((s) => s.alertRules);
  const addAlertRule = usePersonaStore((s) => s.addAlertRule);
  const updateAlertRule = usePersonaStore((s) => s.updateAlertRule);
  const deleteAlertRule = usePersonaStore((s) => s.deleteAlertRule);
  const toggleAlertRule = usePersonaStore((s) => s.toggleAlertRule);
  const personas = usePersonaStore((s) => s.personas);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const personaList = personas.map(p => ({ id: p.id, name: p.name }));

  const handleAdd = (data: RuleFormData) => {
    addAlertRule({
      name: data.name.trim(),
      metric: data.metric,
      operator: data.operator,
      threshold: parseFloat(data.threshold),
      severity: data.severity,
      personaId: data.personaId,
      enabled: true,
    });
    setShowForm(false);
  };

  const handleEdit = (id: string, data: RuleFormData) => {
    updateAlertRule(id, {
      name: data.name.trim(),
      metric: data.metric,
      operator: data.operator,
      threshold: parseFloat(data.threshold),
      severity: data.severity,
      personaId: data.personaId,
    });
    setEditingId(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Alert Rules</h3>
        <button
          onClick={() => { setShowForm(true); setEditingId(null); }}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-primary/15 text-muted-foreground hover:bg-secondary/40 hover:text-foreground transition-colors"
        >
          <Plus className="w-3 h-3" /> Add Rule
        </button>
      </div>

      <AnimatePresence mode="popLayout">
        {showForm && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <RuleForm personas={personaList} onSubmit={handleAdd} onCancel={() => setShowForm(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      {alertRules.length === 0 && !showForm && (
        <p className="text-sm text-muted-foreground/50 text-center py-6">
          No alert rules configured. Add a rule to get notified when metrics cross a threshold.
        </p>
      )}

      <div className="space-y-2">
        {alertRules.map((rule) => (
          editingId === rule.id ? (
            <RuleForm
              key={rule.id}
              initial={{
                name: rule.name,
                metric: rule.metric,
                operator: rule.operator,
                threshold: String(rule.threshold),
                severity: rule.severity,
                personaId: rule.personaId,
              }}
              personas={personaList}
              onSubmit={(data) => handleEdit(rule.id, data)}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <RuleRow
              key={rule.id}
              rule={rule}
              personas={personaList}
              onToggle={() => toggleAlertRule(rule.id)}
              onDelete={() => deleteAlertRule(rule.id)}
              onEdit={() => { setEditingId(rule.id); setShowForm(false); }}
            />
          )
        ))}
      </div>
    </div>
  );
}
