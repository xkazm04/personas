import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  Trash2,
  ToggleLeft,
  ToggleRight,
  ChevronDown,
  ChevronRight,
  Shield,
  ShieldCheck,
  FileJson,
  Type,
  Hash,
  Regex,
  Ban,
  Ruler,
} from "lucide-react";

import type {
  OutputAssertion,
  AssertionType,
  AssertionFailureAction,
} from "@/lib/bindings/OutputAssertion";
import * as api from "@/api/agents/outputAssertions";
import { silentCatch } from "@/lib/silentCatch";

interface Props {
  personaId: string;
}

const ASSERTION_TYPE_LABELS: Record<AssertionType, string> = {
  regex: "Regex Pattern",
  json_path: "JSONPath Check",
  contains: "Contains Phrases",
  not_contains: "Forbidden Patterns",
  json_schema: "JSON Schema",
  length: "Output Length",
};

const ASSERTION_TYPE_ICONS: Record<AssertionType, typeof Regex> = {
  regex: Regex,
  json_path: FileJson,
  contains: Type,
  not_contains: Ban,
  json_schema: Hash,
  length: Ruler,
};

const SEVERITY_STYLES: Record<string, string> = {
  info: "text-blue-400 bg-blue-400/10",
  warning: "text-amber-400 bg-amber-400/10",
  critical: "text-red-400 bg-red-400/10",
};

const FAILURE_ACTION_LABELS: Record<AssertionFailureAction, string> = {
  log: "Log Only",
  review: "Manual Review",
  heal: "Trigger Healing",
};

export function AssertionPanel({ personaId }: Props) {
  const [assertions, setAssertions] = useState<OutputAssertion[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api
      .listOutputAssertions(personaId)
      .then(setAssertions)
      .catch(silentCatch("assertions:panel"))
      .finally(() => setLoading(false));
  }, [personaId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleToggle = useCallback(
    (assertion: OutputAssertion) => {
      api
        .updateOutputAssertion({ id: assertion.id, enabled: !assertion.enabled })
        .then(() => load())
        .catch(silentCatch("assertions:panel"));
    },
    [load],
  );

  const handleDelete = useCallback(
    (id: string) => {
      api
        .deleteOutputAssertion(id)
        .then(() => load())
        .catch(silentCatch("assertions:panel"));
    },
    [load],
  );

  const enabledCount = assertions.filter((a) => a.enabled).length;
  const totalFails = assertions.reduce((sum, a) => sum + a.failCount, 0);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-slate-400" />
          <h3 className="text-sm font-medium text-slate-200">
            Output Assertions
          </h3>
          <span className="rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-400">
            {enabledCount}/{assertions.length} active
          </span>
          {totalFails > 0 && (
            <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-xs text-red-400">
              {totalFails} failures
            </span>
          )}
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-1 rounded-md bg-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-600 transition-colors"
        >
          <Plus className="h-3 w-3" />
          Add Assertion
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <CreateAssertionForm
          personaId={personaId}
          onCreated={() => {
            setShowCreate(false);
            load();
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {/* List */}
      {loading ? (
        <div className="py-6 text-center text-xs text-slate-500">
          Loading assertions...
        </div>
      ) : assertions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-700 py-8 text-center">
          <ShieldCheck className="mx-auto mb-2 h-8 w-8 text-slate-600" />
          <p className="text-sm text-slate-500">
            No assertions configured yet.
          </p>
          <p className="mt-1 text-xs text-slate-600">
            Add assertions to continuously validate execution outputs.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {assertions.map((a) => (
            <AssertionRow
              key={a.id}
              assertion={a}
              expanded={expandedId === a.id}
              onToggleExpand={() =>
                setExpandedId(expandedId === a.id ? null : a.id)
              }
              onToggleEnabled={() => handleToggle(a)}
              onDelete={() => handleDelete(a.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// -- Assertion Row ---------------------------------------------------------

function AssertionRow({
  assertion,
  expanded,
  onToggleExpand,
  onToggleEnabled,
  onDelete,
}: {
  assertion: OutputAssertion;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleEnabled: () => void;
  onDelete: () => void;
}) {
  const Icon = ASSERTION_TYPE_ICONS[assertion.assertionType] ?? Shield;
  const passRate =
    assertion.passCount + assertion.failCount > 0
      ? Math.round(
          (assertion.passCount / (assertion.passCount + assertion.failCount)) *
            100,
        )
      : null;

  return (
    <div
      className={`rounded-lg border ${assertion.enabled ? "border-slate-700 bg-slate-800/50" : "border-slate-800 bg-slate-900/30 opacity-60"}`}
    >
      <div
        className="flex cursor-pointer items-center gap-3 px-3 py-2"
        onClick={onToggleExpand}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-slate-500 shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-slate-500 shrink-0" />
        )}
        <Icon className="h-4 w-4 text-slate-400 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm text-slate-200">
              {assertion.name}
            </span>
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${SEVERITY_STYLES[assertion.severity] ?? SEVERITY_STYLES.info}`}
            >
              {assertion.severity}
            </span>
          </div>
          {assertion.description && (
            <p className="truncate text-xs text-slate-500">
              {assertion.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {passRate !== null && (
            <span
              className={`text-xs font-mono ${passRate >= 90 ? "text-emerald-400" : passRate >= 50 ? "text-amber-400" : "text-red-400"}`}
            >
              {passRate}%
            </span>
          )}
          <span className="text-[10px] text-slate-600">
            {ASSERTION_TYPE_LABELS[assertion.assertionType]}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleEnabled();
            }}
            className="text-slate-500 hover:text-slate-300"
            title={assertion.enabled ? "Disable" : "Enable"}
          >
            {assertion.enabled ? (
              <ToggleRight className="h-4 w-4 text-emerald-400" />
            ) : (
              <ToggleLeft className="h-4 w-4" />
            )}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="text-slate-600 hover:text-red-400"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-slate-700/50 px-3 py-2 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-slate-500">Type:</span>{" "}
              <span className="text-slate-300">
                {ASSERTION_TYPE_LABELS[assertion.assertionType]}
              </span>
            </div>
            <div>
              <span className="text-slate-500">On Failure:</span>{" "}
              <span className="text-slate-300">
                {FAILURE_ACTION_LABELS[assertion.onFailure]}
              </span>
            </div>
            <div>
              <span className="text-slate-500">Pass/Fail:</span>{" "}
              <span className="text-emerald-400">{assertion.passCount}</span>
              {" / "}
              <span className="text-red-400">{assertion.failCount}</span>
            </div>
            <div>
              <span className="text-slate-500">Last Evaluated:</span>{" "}
              <span className="text-slate-300">
                {assertion.lastEvaluatedAt
                  ? new Date(assertion.lastEvaluatedAt).toLocaleString()
                  : "Never"}
              </span>
            </div>
          </div>
          <div className="mt-2">
            <span className="text-slate-500">Config:</span>
            <pre className="mt-1 overflow-x-auto rounded bg-slate-900 p-2 text-[10px] text-slate-400">
              {JSON.stringify(JSON.parse(assertion.config), null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

// -- Create Form -----------------------------------------------------------

function CreateAssertionForm({
  personaId,
  onCreated,
  onCancel,
}: {
  personaId: string;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [assertionType, setAssertionType] = useState<AssertionType>("contains");
  const [severity, setSeverity] = useState("warning");
  const [onFailure, setOnFailure] = useState<AssertionFailureAction>("log");
  const [config, setConfig] = useState("{}");
  const [submitting, setSubmitting] = useState(false);

  const configTemplates: Record<AssertionType, string> = {
    regex: '{"pattern": "your-pattern-here", "negate": false}',
    json_path: '{"path": "$.result.status", "expected": "ok"}',
    contains: '{"phrases": ["success"], "match_all": true}',
    not_contains: '{"patterns": ["SSN", "password", "secret"]}',
    json_schema: '{"required_keys": ["status", "message"]}',
    length: '{"min": 10, "max": 5000}',
  };

  const handleTypeChange = (type: AssertionType) => {
    setAssertionType(type);
    setConfig(configTemplates[type]);
  };

  const handleSubmit = () => {
    if (!name.trim()) return;
    setSubmitting(true);
    api
      .createOutputAssertion({
        personaId,
        name,
        description: description || undefined,
        assertionType,
        config,
        severity,
        onFailure,
      })
      .then(onCreated)
      .catch(silentCatch("assertions:panel"))
      .finally(() => setSubmitting(false));
  };

  return (
    <div className="rounded-lg border border-slate-600 bg-slate-800/80 p-3 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
            Name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded bg-slate-900 px-2 py-1.5 text-sm text-slate-200 border border-slate-700 focus:border-blue-500 focus:outline-none"
            placeholder="e.g. No PII Leakage"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
            Type
          </label>
          <select
            value={assertionType}
            onChange={(e) =>
              handleTypeChange(e.target.value as AssertionType)
            }
            className="w-full rounded bg-slate-900 px-2 py-1.5 text-sm text-slate-200 border border-slate-700 focus:border-blue-500 focus:outline-none"
          >
            {Object.entries(ASSERTION_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
            Severity
          </label>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            className="w-full rounded bg-slate-900 px-2 py-1.5 text-sm text-slate-200 border border-slate-700 focus:border-blue-500 focus:outline-none"
          >
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
            On Failure
          </label>
          <select
            value={onFailure}
            onChange={(e) =>
              setOnFailure(e.target.value as AssertionFailureAction)
            }
            className="w-full rounded bg-slate-900 px-2 py-1.5 text-sm text-slate-200 border border-slate-700 focus:border-blue-500 focus:outline-none"
          >
            {Object.entries(FAILURE_ACTION_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
          Description
        </label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full rounded bg-slate-900 px-2 py-1.5 text-sm text-slate-200 border border-slate-700 focus:border-blue-500 focus:outline-none"
          placeholder="Optional description..."
        />
      </div>
      <div>
        <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
          Config (JSON)
        </label>
        <textarea
          value={config}
          onChange={(e) => setConfig(e.target.value)}
          rows={3}
          className="w-full rounded bg-slate-900 px-2 py-1.5 text-xs font-mono text-slate-200 border border-slate-700 focus:border-blue-500 focus:outline-none"
        />
      </div>
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded px-3 py-1 text-xs text-slate-400 hover:text-slate-200"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={submitting || !name.trim()}
          className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {submitting ? "Creating..." : "Create"}
        </button>
      </div>
    </div>
  );
}
