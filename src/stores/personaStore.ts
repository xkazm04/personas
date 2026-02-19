import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import {
  enrichWithPersona,
  type DbPersona,
  type DbPersonaToolDefinition,
  type DbPersonaExecution,
  type DbCredentialEvent,
  type PersonaWithDetails,
  type CredentialMetadata,
  type ConnectorDefinition,
  type SidebarSection,
  type EditorTab,
  type OverviewTab,
  type GlobalExecution,
  type ManualReviewItem,
  type PersonaMessage,
  type PersonaEvent,
  type DbPersonaGroup,
  type DbPersonaMemory,
  type ToolUsageSummary,
  type ToolUsageOverTime,
  type PersonaUsageSummary,
  toCredentialMetadata as toCredMeta,
  parseConnectorDefinition as parseConn,
} from "@/lib/types/types";
import type { DesignPhase, DesignAnalysisResult } from "@/lib/types/designTypes";
import type { ObservabilityMetrics } from "@/lib/bindings/ObservabilityMetrics";
import type { PersonaTeamConnection } from "@/lib/bindings/PersonaTeamConnection";
import { listen } from "@tauri-apps/api/event";
import * as api from "@/api/tauriApi";

// ============================================================================
// Store Types
// ============================================================================

export interface ActiveDesignSession {
  personaId: string;
  designId: string;
  phase: DesignPhase;
  outputLines: string[];
  result: DesignAnalysisResult | null;
  error: string | null;
  question?: { question: string; options?: string[]; context?: string } | null;
}

interface PersonaState {
  // Data
  personas: DbPersona[];
  selectedPersonaId: string | null;
  selectedPersona: PersonaWithDetails | null;
  toolDefinitions: DbPersonaToolDefinition[];
  credentials: CredentialMetadata[];
  credentialEvents: DbCredentialEvent[];
  connectorDefinitions: ConnectorDefinition[];
  executions: DbPersonaExecution[];
  activeExecutionId: string | null;
  executionOutput: string[];

  // Overview / Global
  overviewTab: OverviewTab;
  globalExecutions: GlobalExecution[];
  globalExecutionsTotal: number;
  globalExecutionsOffset: number;
  manualReviews: ManualReviewItem[];
  manualReviewsTotal: number;
  pendingReviewCount: number;

  // Messages
  messages: PersonaMessage[];
  messagesTotal: number;
  unreadMessageCount: number;

  // Tool Usage Analytics
  toolUsageSummary: ToolUsageSummary[];
  toolUsageOverTime: ToolUsageOverTime[];
  toolUsageByPersona: PersonaUsageSummary[];

  // Events
  recentEvents: PersonaEvent[];
  pendingEventCount: number;

  // Observability
  observabilityMetrics: ObservabilityMetrics | null;
  promptVersions: any[];

  // Healing
  healingIssues: any[];
  healingRunning: boolean;

  // Teams
  teams: any[];
  selectedTeamId: string | null;
  teamMembers: any[];
  teamConnections: PersonaTeamConnection[];

  // Sidebar card summaries (trigger counts + last run)
  personaTriggerCounts: Record<string, number>;
  personaLastRun: Record<string, string | null>;

  // Groups
  groups: DbPersonaGroup[];

  // Memories
  memories: DbPersonaMemory[];
  memoriesTotal: number;

  // Design Analysis
  designPhase: DesignPhase;
  activeDesignSession: ActiveDesignSession | null;

  // UI State
  sidebarSection: SidebarSection;
  editorTab: EditorTab;
  isLoading: boolean;
  isExecuting: boolean;
  error: string | null;
}

interface PersonaActions {
  // Personas
  fetchPersonas: () => Promise<void>;
  fetchPersonaSummaries: () => Promise<void>;
  fetchDetail: (id: string) => Promise<void>;
  createPersona: (input: { name: string; description?: string; system_prompt: string; icon?: string; color?: string }) => Promise<DbPersona>;
  updatePersona: (id: string, input: Record<string, unknown>) => Promise<void>;
  deletePersona: (id: string) => Promise<void>;
  selectPersona: (id: string | null) => void;

  // Tools
  fetchToolDefinitions: () => Promise<void>;
  assignTool: (personaId: string, toolId: string) => Promise<void>;
  removeTool: (personaId: string, toolId: string) => Promise<void>;

  // Triggers
  createTrigger: (personaId: string, input: { trigger_type: string; config?: object; enabled?: boolean }) => Promise<void>;
  updateTrigger: (personaId: string, triggerId: string, updates: Record<string, unknown>) => Promise<void>;
  deleteTrigger: (personaId: string, triggerId: string) => Promise<void>;

  // Executions
  executePersona: (personaId: string, inputData?: object) => Promise<string | null>;
  cancelExecution: (executionId: string) => Promise<void>;
  finishExecution: (status?: string) => void;
  fetchExecutions: (personaId: string) => Promise<void>;
  appendExecutionOutput: (line: string) => void;
  clearExecutionOutput: () => void;

  // Credentials
  fetchCredentials: () => Promise<void>;
  createCredential: (input: { name: string; service_type: string; data: object }) => Promise<void>;
  deleteCredential: (id: string) => Promise<void>;
  healthcheckCredential: (credentialId: string) => Promise<{ success: boolean; message: string }>;

  // Connector Definitions & Credential Events
  fetchConnectorDefinitions: () => Promise<void>;
  createConnectorDefinition: (input: { name: string; label: string; category: string; color: string; fields: string; services: string; events: string }) => Promise<ConnectorDefinition>;
  deleteConnectorDefinition: (id: string) => Promise<void>;
  fetchCredentialEvents: () => Promise<void>;
  createCredentialEvent: (input: { credential_id: string; event_template_id: string; name: string; config?: object | null }) => Promise<void>;
  updateCredentialEvent: (id: string, updates: { name?: string; config?: object; enabled?: boolean }) => Promise<void>;
  deleteCredentialEvent: (id: string) => Promise<void>;

  // Overview / Global
  setOverviewTab: (tab: OverviewTab) => void;
  fetchGlobalExecutions: (reset?: boolean, status?: string) => Promise<void>;
  fetchManualReviews: (status?: string) => Promise<void>;
  updateManualReview: (id: string, updates: { status?: string; reviewer_notes?: string }) => Promise<void>;
  fetchPendingReviewCount: () => Promise<void>;

  // Messages
  fetchMessages: (reset?: boolean) => Promise<void>;
  markMessageAsRead: (id: string) => Promise<void>;
  markAllMessagesAsRead: (personaId?: string) => Promise<void>;
  deleteMessage: (id: string) => Promise<void>;
  fetchUnreadMessageCount: () => Promise<void>;

  // Tool Usage Analytics
  fetchToolUsage: (days?: number, personaId?: string) => Promise<void>;

  // Events
  fetchRecentEvents: (limit?: number, eventType?: string) => Promise<void>;

  // Observability
  fetchObservabilityMetrics: (days?: number, personaId?: string) => Promise<void>;
  fetchPromptVersions: (personaId: string) => Promise<void>;

  // Healing
  fetchHealingIssues: () => Promise<void>;
  triggerHealing: (personaId?: string) => Promise<void>;
  resolveHealingIssue: (id: string) => Promise<void>;

  // Teams
  fetchTeams: () => Promise<void>;
  selectTeam: (teamId: string | null) => void;
  fetchTeamDetails: (teamId: string) => Promise<void>;
  createTeam: (data: { name: string; description?: string; icon?: string; color?: string }) => Promise<any>;
  deleteTeam: (teamId: string) => Promise<void>;
  addTeamMember: (personaId: string, role?: string, posX?: number, posY?: number) => Promise<void>;
  removeTeamMember: (memberId: string) => Promise<void>;

  // Groups
  fetchGroups: () => Promise<void>;
  createGroup: (input: { name: string; color?: string }) => Promise<DbPersonaGroup | null>;
  updateGroup: (id: string, updates: { name?: string; color?: string; collapsed?: boolean }) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
  reorderGroups: (orderedIds: string[]) => Promise<void>;
  movePersonaToGroup: (personaId: string, groupId: string | null) => Promise<void>;

  // Memories
  fetchMemories: (filters?: { persona_id?: string; category?: string }) => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;

  // Design
  setDesignPhase: (phase: DesignPhase) => void;
  setActiveDesignSession: (session: ActiveDesignSession | null) => void;
  appendDesignOutputLine: (line: string) => void;

  // UI
  setSidebarSection: (section: SidebarSection) => void;
  setEditorTab: (tab: EditorTab) => void;
  setError: (error: string | null) => void;
}

type PersonaStore = PersonaState & PersonaActions;

// ============================================================================
// Helpers
// ============================================================================

function errMsg(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "error" in err) return String((err as any).error);
  return fallback;
}

// ============================================================================
// Store Implementation
// ============================================================================

export const usePersonaStore = create<PersonaStore>()(
  devtools(
    persist(
    (set, get) => ({
      // Initial state
      personas: [],
      selectedPersonaId: null,
      selectedPersona: null,
      toolDefinitions: [],
      credentials: [],
      credentialEvents: [],
      connectorDefinitions: [],
      executions: [],
      activeExecutionId: null,
      executionOutput: [],
      overviewTab: "executions" as OverviewTab,
      globalExecutions: [],
      globalExecutionsTotal: 0,
      globalExecutionsOffset: 0,
      manualReviews: [],
      manualReviewsTotal: 0,
      pendingReviewCount: 0,
      messages: [],
      messagesTotal: 0,
      unreadMessageCount: 0,
      toolUsageSummary: [],
      toolUsageOverTime: [],
      toolUsageByPersona: [],
      recentEvents: [],
      pendingEventCount: 0,
      observabilityMetrics: null,
      promptVersions: [],
      healingIssues: [],
      healingRunning: false,
      teams: [],
      selectedTeamId: null,
      teamMembers: [],
      teamConnections: [],
      personaTriggerCounts: {},
      personaLastRun: {},
      groups: [],
      memories: [],
      memoriesTotal: 0,
      designPhase: "idle" as DesignPhase,
      activeDesignSession: null,
      sidebarSection: "personas" as SidebarSection,
      editorTab: "prompt" as EditorTab,
      isLoading: false,
      isExecuting: false,
      error: null,

      // ── Personas ─────────────────────────────────────────────────
      fetchPersonas: async () => {
        set({ isLoading: true, error: null });
        try {
          const personas = await api.listPersonas();
          set({ personas, isLoading: false });
          // Fire-and-forget: load sidebar badge data
          get().fetchPersonaSummaries();
        } catch (err) {
          set({ error: errMsg(err, "Failed to fetch personas"), isLoading: false });
        }
      },

      fetchPersonaSummaries: async () => {
        const { personas } = get();
        const results = await Promise.all(
          personas.map(async (p) => {
            try {
              const [triggers, execs] = await Promise.all([
                api.listTriggers(p.id),
                api.listExecutions(p.id, 1),
              ]);
              const enabledCount = triggers.filter((t) => t.enabled).length;
              const lastRun = execs[0]?.created_at ?? null;
              return { id: p.id, triggerCount: enabledCount, lastRun };
            } catch {
              return { id: p.id, triggerCount: 0, lastRun: null };
            }
          }),
        );
        const triggerCounts: Record<string, number> = {};
        const lastRun: Record<string, string | null> = {};
        for (const r of results) {
          triggerCounts[r.id] = r.triggerCount;
          lastRun[r.id] = r.lastRun;
        }
        set({ personaTriggerCounts: triggerCounts, personaLastRun: lastRun });
      },

      fetchDetail: async (id: string) => {
        set({ isLoading: true, error: null });
        try {
          const persona = await api.getPersona(id);
          // Assemble PersonaWithDetails from multiple IPC calls
          const [allTools, triggers, subscriptions] = await Promise.all([
            api.listToolDefinitions(),
            api.listTriggers(id),
            api.listSubscriptions(id),
          ]);
          // Find tools assigned to this persona (cross-reference with persona_tools)
          // For now, use all tool definitions — actual assignment filtering can be refined
          const detail: PersonaWithDetails = {
            ...persona,
            tools: allTools,
            triggers,
            subscriptions,
          };
          set({ selectedPersona: detail, selectedPersonaId: id, isLoading: false });
        } catch (err) {
          set({ error: errMsg(err, "Failed to fetch persona"), isLoading: false });
        }
      },

      createPersona: async (input) => {
        set({ error: null });
        try {
          const persona = await api.createPersona({
            name: input.name,
            system_prompt: input.system_prompt,
            project_id: null,
            description: input.description ?? null,
            structured_prompt: null,
            icon: input.icon ?? null,
            color: input.color ?? null,
            enabled: null,
            max_concurrent: null,
            timeout_ms: null,
            model_profile: null,
            max_budget_usd: null,
            max_turns: null,
            design_context: null,
            group_id: null,
          });
          set((state) => ({ personas: [persona, ...state.personas] }));
          return persona;
        } catch (err) {
          set({ error: errMsg(err, "Failed to create persona") });
          throw err;
        }
      },

      updatePersona: async (id, input) => {
        set({ error: null });
        try {
          // Build update input with correct skip vs set-to-null semantics.
          // - Option<T> fields (name, system_prompt, etc.): null = skip, value = set
          // - Option<Option<T>> fields (description, icon, etc.): key absent = skip, null = clear, value = set
          const updateInput: Record<string, unknown> = {
            name: (input.name as string) ?? null,
            system_prompt: (input.system_prompt as string) ?? null,
            enabled: input.enabled !== undefined ? (input.enabled as boolean) : null,
            max_concurrent: (input.max_concurrent as number) ?? null,
            timeout_ms: (input.timeout_ms as number) ?? null,
            notification_channels: (input.notification_channels as string) ?? null,
          };
          // Double-option fields: only include when explicitly provided to distinguish
          // "skip" (key absent) from "set to null" (key present with null value).
          if (input.description !== undefined) updateInput.description = input.description as string | null;
          if (input.structured_prompt !== undefined) updateInput.structured_prompt = input.structured_prompt as string | null;
          if (input.icon !== undefined) updateInput.icon = input.icon as string | null;
          if (input.color !== undefined) updateInput.color = input.color as string | null;
          if (input.last_design_result !== undefined) updateInput.last_design_result = input.last_design_result as string | null;
          if (input.model_profile !== undefined) updateInput.model_profile = input.model_profile as string | null;
          if (input.max_budget_usd !== undefined) updateInput.max_budget_usd = input.max_budget_usd as number | null;
          if (input.max_turns !== undefined) updateInput.max_turns = input.max_turns as number | null;
          if (input.design_context !== undefined) updateInput.design_context = input.design_context as string | null;
          if (input.group_id !== undefined) updateInput.group_id = input.group_id as string | null;
          const persona = await api.updatePersona(id, updateInput as import("@/lib/bindings/UpdatePersonaInput").UpdatePersonaInput);
          set((state) => ({
            personas: state.personas.map((p) => (p.id === id ? persona : p)),
            selectedPersona:
              state.selectedPersona?.id === id
                ? { ...state.selectedPersona, ...persona }
                : state.selectedPersona,
          }));
        } catch (err) {
          set({ error: errMsg(err, "Failed to update persona") });
        }
      },

      deletePersona: async (id) => {
        set({ error: null });
        try {
          await api.deletePersona(id);
          set((state) => ({
            personas: state.personas.filter((p) => p.id !== id),
            selectedPersonaId: state.selectedPersonaId === id ? null : state.selectedPersonaId,
            selectedPersona: state.selectedPersona?.id === id ? null : state.selectedPersona,
          }));
        } catch (err) {
          set({ error: errMsg(err, "Failed to delete persona") });
        }
      },

      selectPersona: (id) => {
        set({ selectedPersonaId: id, editorTab: "prompt", sidebarSection: id ? "personas" : get().sidebarSection });
        if (id) get().fetchDetail(id);
        else set({ selectedPersona: null });
      },

      // ── Tools ────────────────────────────────────────────────────
      fetchToolDefinitions: async () => {
        try {
          const toolDefinitions = await api.listToolDefinitions();
          set({ toolDefinitions });
        } catch (err) {
          set({ error: errMsg(err, "Failed to fetch tools") });
        }
      },

      assignTool: async (personaId, toolId) => {
        try {
          await api.assignTool(personaId, toolId);
          get().fetchDetail(personaId);
        } catch (err) {
          set({ error: errMsg(err, "Failed to assign tool") });
        }
      },

      removeTool: async (personaId, toolId) => {
        try {
          await api.unassignTool(personaId, toolId);
          get().fetchDetail(personaId);
        } catch (err) {
          set({ error: errMsg(err, "Failed to remove tool") });
        }
      },

      // ── Triggers ─────────────────────────────────────────────────
      createTrigger: async (personaId, input) => {
        try {
          await api.createTrigger({
            persona_id: personaId,
            trigger_type: input.trigger_type,
            config: input.config ? JSON.stringify(input.config) : null,
            enabled: input.enabled ?? null,
          });
          get().fetchDetail(personaId);
        } catch (err) {
          set({ error: errMsg(err, "Failed to create trigger") });
        }
      },

      updateTrigger: async (personaId, triggerId, updates) => {
        try {
          await api.updateTrigger(triggerId, {
            trigger_type: (updates.trigger_type as string) ?? null,
            config: updates.config ? JSON.stringify(updates.config) : null,
            enabled: updates.enabled !== undefined ? (updates.enabled as boolean) : null,
            next_trigger_at: null,
          });
          get().fetchDetail(personaId);
        } catch (err) {
          set({ error: errMsg(err, "Failed to update trigger") });
        }
      },

      deleteTrigger: async (personaId, triggerId) => {
        try {
          await api.deleteTrigger(triggerId);
          get().fetchDetail(personaId);
        } catch (err) {
          set({ error: errMsg(err, "Failed to delete trigger") });
        }
      },

      // ── Executions ───────────────────────────────────────────────
      executePersona: async (personaId, inputData) => {
        set({ isExecuting: true, executionOutput: [], error: null });
        try {
          const execution = await api.executePersona(
            personaId,
            undefined,
            inputData ? JSON.stringify(inputData) : undefined,
          );
          set({ activeExecutionId: execution.id });
          return execution.id;
        } catch (err) {
          set({ error: errMsg(err, "Failed to execute persona"), isExecuting: false });
          return null;
        }
      },

      cancelExecution: async (executionId) => {
        try {
          await api.cancelExecution(executionId);
          set({ isExecuting: false, activeExecutionId: null });
        } catch (err) {
          set({ error: errMsg(err, "Failed to cancel execution") });
        }
      },

      finishExecution: (_status?: string) => {
        set({ isExecuting: false });
        const personaId = get().selectedPersona?.id;
        if (personaId) get().fetchExecutions(personaId);
      },

      fetchExecutions: async (personaId) => {
        try {
          const executions = await api.listExecutions(personaId);
          set({ executions });
        } catch (err) {
          set({ error: errMsg(err, "Failed to fetch executions") });
        }
      },

      appendExecutionOutput: (line) => {
        set((state) => ({ executionOutput: [...state.executionOutput, line] }));
      },

      clearExecutionOutput: () => {
        set({ executionOutput: [], activeExecutionId: null, isExecuting: false });
      },

      // ── Credentials ──────────────────────────────────────────────
      fetchCredentials: async () => {
        try {
          const raw = await api.listCredentials();
          const credentials = raw.map(toCredMeta);
          set({ credentials });
        } catch (err) {
          set({ error: errMsg(err, "Failed to fetch credentials") });
        }
      },

      createCredential: async (input) => {
        try {
          await api.createCredential({
            name: input.name,
            service_type: input.service_type,
            encrypted_data: JSON.stringify(input.data),
            iv: "",
            metadata: null,
          });
          get().fetchCredentials();
        } catch (err) {
          set({ error: errMsg(err, "Failed to create credential") });
        }
      },

      deleteCredential: async (id) => {
        try {
          await api.deleteCredential(id);
          set((state) => ({
            credentials: state.credentials.filter((c) => c.id !== id),
            credentialEvents: state.credentialEvents.filter((e) => e.credential_id !== id),
          }));
        } catch (err) {
          throw err;
        }
      },

      healthcheckCredential: async (credentialId) => {
        try {
          const result = await api.healthcheckCredential(credentialId);
          return result;
        } catch (err) {
          return { success: false, message: errMsg(err, "Healthcheck failed") };
        }
      },

      // ── Connector Definitions & Credential Events ────────────────
      fetchConnectorDefinitions: async () => {
        try {
          const raw = await api.listConnectors();
          const connectorDefinitions = raw.map(parseConn);
          set({ connectorDefinitions });
        } catch (err) {
          set({ error: errMsg(err, "Failed to fetch connector definitions") });
        }
      },

      createConnectorDefinition: async (input) => {
        try {
          const raw = await api.createConnector({
            name: input.name,
            label: input.label,
            icon_url: null,
            color: input.color,
            category: input.category,
            fields: input.fields,
            healthcheck_config: null,
            services: input.services,
            events: input.events,
            metadata: null,
            is_builtin: null,
          });
          const connector = parseConn(raw);
          set((state) => ({ connectorDefinitions: [...state.connectorDefinitions, connector] }));
          return connector;
        } catch (err) {
          set({ error: errMsg(err, "Failed to create connector") });
          throw err;
        }
      },

      deleteConnectorDefinition: async (id) => {
        try {
          await api.deleteConnector(id);
          set((state) => ({
            connectorDefinitions: state.connectorDefinitions.filter((c) => c.id !== id),
          }));
        } catch (err) {
          set({ error: errMsg(err, "Failed to delete connector") });
        }
      },

      fetchCredentialEvents: async () => {
        try {
          // Credential events need a credential ID — fetch for all credentials
          const { credentials } = get();
          const allEvents = await Promise.all(
            credentials.map((c) => api.listCredentialEvents(c.id).catch(() => [])),
          );
          set({ credentialEvents: allEvents.flat() });
        } catch (err) {
          set({ error: errMsg(err, "Failed to fetch credential events") });
        }
      },

      createCredentialEvent: async (input) => {
        try {
          await api.createCredentialEvent({
            credential_id: input.credential_id,
            event_template_id: input.event_template_id,
            name: input.name,
            config: input.config ? JSON.stringify(input.config) : null,
            enabled: null,
          });
          get().fetchCredentialEvents();
        } catch (err) {
          set({ error: errMsg(err, "Failed to create credential event") });
        }
      },

      updateCredentialEvent: async (id, updates) => {
        try {
          const input = {
            name: updates.name ?? null,
            config: updates.config ? JSON.stringify(updates.config) : null,
            enabled: updates.enabled ?? null,
            last_polled_at: null,
          };
          const updated = await api.updateCredentialEvent(id, input);
          set((state) => ({
            credentialEvents: state.credentialEvents.map((e) =>
              e.id === id ? updated : e,
            ),
          }));
        } catch (err) {
          set({ error: errMsg(err, 'Failed to update credential event') });
        }
      },

      deleteCredentialEvent: async (id) => {
        try {
          set((state) => ({
            credentialEvents: state.credentialEvents.filter((e) => e.id !== id),
          }));
        } catch (err) {
          set({ error: errMsg(err, "Failed to delete credential event") });
        }
      },

      // ── Overview / Global ────────────────────────────────────────
      setOverviewTab: (tab) => set({ overviewTab: tab }),

      fetchGlobalExecutions: async (reset = false) => {
        try {
          // Aggregate executions across all personas
          const { personas } = get();
          const allExecs = await Promise.all(
            personas.map(async (p) => {
              try {
                const execs = await api.listExecutions(p.id, 10);
                return enrichWithPersona(execs, [p]);
              } catch {
                return [];
              }
            }),
          );
          const merged = allExecs
            .flat()
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .slice(0, 50);
          if (reset) {
            set({
              globalExecutions: merged,
              globalExecutionsTotal: merged.length,
              globalExecutionsOffset: merged.length,
            });
          } else {
            set({
              globalExecutions: merged,
              globalExecutionsTotal: merged.length,
              globalExecutionsOffset: merged.length,
            });
          }
        } catch (err) {
          set({ error: errMsg(err, "Failed to fetch global executions") });
        }
      },

      fetchManualReviews: async (status?: string) => {
        try {
          const raw = await api.listManualReviews(undefined, status);
          const { personas } = get();
          const shaped = raw.map((r) => ({
            id: r.id,
            persona_id: r.persona_id,
            execution_id: r.execution_id,
            review_type: r.severity,
            content: r.title + (r.description ? `\n${r.description}` : ''),
            severity: r.severity,
            status: r.status,
            reviewer_notes: r.reviewer_notes,
            created_at: r.created_at,
            resolved_at: r.resolved_at,
          }));
          const items: ManualReviewItem[] = enrichWithPersona(shaped, personas);
          const pendingCount = await api.getPendingReviewCount();
          set({ manualReviews: items, manualReviewsTotal: items.length, pendingReviewCount: pendingCount });
        } catch (err) {
          set({ error: errMsg(err, "Failed to fetch manual reviews") });
        }
      },

      updateManualReview: async (id, updates) => {
        try {
          await api.updateManualReviewStatus(id, updates.status ?? 'pending', updates.reviewer_notes);
          // Re-fetch to get updated list
          await get().fetchManualReviews();
        } catch (err) {
          set({ error: errMsg(err, "Failed to update manual review") });
        }
      },

      fetchPendingReviewCount: async () => {
        try {
          const count = await api.getPendingReviewCount();
          set({ pendingReviewCount: count });
        } catch {
          set({ pendingReviewCount: 0 });
        }
      },

      // ── Messages ──────────────────────────────────────────────────
      fetchMessages: async (reset = true) => {
        try {
          const PAGE_SIZE = 50;
          const offset = reset ? 0 : get().messages.length;
          const [rawMessages, totalCount] = await Promise.all([
            api.listMessages(PAGE_SIZE, offset),
            reset ? api.getMessageCount() : Promise.resolve(get().messagesTotal),
          ]);
          // Enrich with persona info
          const { personas } = get();
          const enriched: PersonaMessage[] = enrichWithPersona(rawMessages, personas);
          const unread = enriched.filter((m) => !m.is_read).length;
          if (reset) {
            set({ messages: enriched, messagesTotal: totalCount, unreadMessageCount: unread });
          } else {
            set((state) => ({
              messages: [...state.messages, ...enriched],
              messagesTotal: totalCount,
              unreadMessageCount: unread,
            }));
          }
        } catch (err) {
          set({ error: errMsg(err, "Failed to fetch messages") });
        }
      },

      markMessageAsRead: async (id) => {
        set((state) => ({
          messages: state.messages.map((m) =>
            m.id === id ? { ...m, is_read: true, read_at: new Date().toISOString() } : m,
          ),
          unreadMessageCount: Math.max(0, state.unreadMessageCount - 1),
        }));
        try {
          await api.markMessageRead(id);
        } catch {
          get().fetchMessages();
        }
      },

      markAllMessagesAsRead: async (personaId?) => {
        try {
          await api.markAllMessagesRead(personaId);
          set((state) => ({
            messages: state.messages.map((m) => {
              if (!personaId || m.persona_id === personaId) {
                return { ...m, is_read: true, read_at: new Date().toISOString() };
              }
              return m;
            }),
            unreadMessageCount: 0,
          }));
        } catch (err) {
          set({ error: errMsg(err, "Failed to mark all as read") });
        }
      },

      deleteMessage: async (id) => {
        try {
          await api.deleteMessage(id);
          set((state) => ({
            messages: state.messages.filter((m) => m.id !== id),
            messagesTotal: Math.max(0, state.messagesTotal - 1),
          }));
        } catch (err) {
          set({ error: errMsg(err, "Failed to delete message") });
        }
      },

      fetchUnreadMessageCount: async () => {
        try {
          const unread = await api.getUnreadMessageCount();
          set({ unreadMessageCount: unread });
        } catch {
          // Silent fail
        }
      },

      // ── Tool Usage Analytics ─────────────────────────────────────
      fetchToolUsage: async (days = 30, personaId?: string) => {
        try {
          const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
          const [summary, overTime, byPersona] = await Promise.all([
            api.getToolUsageSummary(since, personaId),
            api.getToolUsageOverTime(since, personaId),
            api.getToolUsageByPersona(since),
          ]);
          set({
            toolUsageSummary: summary,
            toolUsageOverTime: overTime,
            toolUsageByPersona: byPersona,
          });
        } catch {
          set({ toolUsageSummary: [], toolUsageOverTime: [], toolUsageByPersona: [] });
        }
      },

      // ── Events ──────────────────────────────────────────────────
      fetchRecentEvents: async (limit?: number) => {
        try {
          const events = await api.listEvents(limit ?? 50);
          set({ recentEvents: events, pendingEventCount: events.filter((e) => e.status === "pending").length });
        } catch {
          // Silent fail
        }
      },

      // ── Observability ────────────────────────────────────────────
      fetchObservabilityMetrics: async (days = 30, personaId?: string) => {
        try {
          const startDate = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
          const [summary, snapshots] = await Promise.all([
            api.getMetricsSummary(days),
            api.getMetricsSnapshots(personaId, startDate),
          ]);
          set({ observabilityMetrics: { summary, timeSeries: snapshots } });
        } catch {
          // Silent fail
        }
      },

      fetchPromptVersions: async (personaId) => {
        try {
          const versions = await api.getPromptVersions(personaId);
          set({ promptVersions: versions });
        } catch {
          // Silent fail
        }
      },

      // ── Healing ──────────────────────────────────────────────────
      fetchHealingIssues: async () => {
        try {
          const issues = await api.listHealingIssues();
          set({ healingIssues: issues });
        } catch {
          // Silent fail
        }
      },

      triggerHealing: async (personaId?: string) => {
        if (!personaId) return;
        set({ healingRunning: true });
        try {
          await api.runHealingAnalysis(personaId);
          const issues = await api.listHealingIssues(personaId);
          set({ healingIssues: issues, healingRunning: false });
        } catch {
          set({ healingRunning: false });
        }
      },

      resolveHealingIssue: async (id: string) => {
        try {
          await api.updateHealingStatus(id, "resolved");
          set({ healingIssues: get().healingIssues.filter((i: any) => i.id !== id) });
        } catch {
          // Silent fail
        }
      },

      // ── Teams ──────────────────────────────────────────────────
      fetchTeams: async () => {
        try {
          const teams = await api.listTeams();
          set({ teams });
        } catch {
          // Silent fail
        }
      },

      selectTeam: (teamId) => {
        set({ selectedTeamId: teamId, teamMembers: [], teamConnections: [] });
        if (teamId) get().fetchTeamDetails(teamId);
      },

      fetchTeamDetails: async (teamId) => {
        try {
          const [members, connections] = await Promise.all([
            api.listTeamMembers(teamId),
            api.listTeamConnections(teamId),
          ]);
          set({ teamMembers: members, teamConnections: connections });
        } catch {
          // Silent fail
        }
      },

      createTeam: async (data) => {
        try {
          const team = await api.createTeam({
            name: data.name,
            project_id: null,
            description: data.description ?? null,
            canvas_data: null,
            team_config: null,
            icon: data.icon ?? null,
            color: data.color ?? null,
            enabled: null,
          });
          await get().fetchTeams();
          return team;
        } catch {
          return null;
        }
      },

      deleteTeam: async (teamId) => {
        try {
          await api.deleteTeam(teamId);
          if (get().selectedTeamId === teamId) set({ selectedTeamId: null, teamMembers: [], teamConnections: [] });
          await get().fetchTeams();
        } catch {
          // Silent fail
        }
      },

      addTeamMember: async (personaId, role, posX, posY) => {
        const teamId = get().selectedTeamId;
        if (!teamId) return;
        try {
          await api.addTeamMember(teamId, personaId, role, posX, posY);
          await get().fetchTeamDetails(teamId);
        } catch {
          // Silent fail
        }
      },

      removeTeamMember: async (memberId) => {
        const teamId = get().selectedTeamId;
        if (!teamId) return;
        try {
          await api.removeTeamMember(memberId);
          await get().fetchTeamDetails(teamId);
        } catch {
          // Silent fail
        }
      },

      // ── Groups ──────────────────────────────────────────────────
      fetchGroups: async () => {
        try {
          const groups = await api.listGroups();
          set({ groups });
        } catch {
          // Silent fail
        }
      },

      createGroup: async (input) => {
        try {
          const group = await api.createGroup({
            name: input.name,
            color: input.color ?? "#6B7280",
            sort_order: null,
          });
          set((state) => ({ groups: [...state.groups, group] }));
          return group;
        } catch (err) {
          set({ error: errMsg(err, "Failed to create group") });
          return null;
        }
      },

      updateGroup: async (id, updates) => {
        try {
          const group = await api.updateGroup(id, {
            name: updates.name ?? null,
            color: updates.color ?? null,
            sort_order: null,
            collapsed: updates.collapsed !== undefined ? updates.collapsed : null,
          });
          set((state) => ({
            groups: state.groups.map((g) => (g.id === id ? group : g)),
          }));
        } catch (err) {
          set({ error: errMsg(err, "Failed to update group") });
        }
      },

      deleteGroup: async (id) => {
        try {
          await api.deleteGroup(id);
          set((state) => ({
            groups: state.groups.filter((g) => g.id !== id),
            personas: state.personas.map((p) =>
              p.group_id === id ? { ...p, group_id: null } : p,
            ),
          }));
        } catch (err) {
          set({ error: errMsg(err, "Failed to delete group") });
        }
      },

      reorderGroups: async (orderedIds) => {
        try {
          await api.reorderGroups(orderedIds);
          set((state) => ({
            groups: state.groups
              .map((g) => ({ ...g, sort_order: orderedIds.indexOf(g.id) }))
              .sort((a, b) => a.sort_order - b.sort_order),
          }));
        } catch (err) {
          set({ error: errMsg(err, "Failed to reorder groups") });
        }
      },

      movePersonaToGroup: async (personaId, groupId) => {
        try {
          await api.updatePersona(personaId, {
            name: null, system_prompt: null, enabled: null,
            max_concurrent: null, timeout_ms: null, notification_channels: null,
            group_id: groupId,
          } as import("@/lib/bindings/UpdatePersonaInput").UpdatePersonaInput);
          set((state) => ({
            personas: state.personas.map((p) =>
              p.id === personaId ? { ...p, group_id: groupId } : p,
            ),
          }));
        } catch (err) {
          set({ error: errMsg(err, "Failed to move persona") });
        }
      },

      // ── Memories ──────────────────────────────────────────────────
      fetchMemories: async (filters?) => {
        try {
          const memories = await api.listMemories(
            filters?.persona_id,
            filters?.category,
            100,
            0,
          );
          set({ memories, memoriesTotal: memories.length });
        } catch {
          // Silent fail
        }
      },

      deleteMemory: async (id) => {
        try {
          await api.deleteMemory(id);
          set((state) => ({
            memories: state.memories.filter((m) => m.id !== id),
            memoriesTotal: Math.max(0, state.memoriesTotal - 1),
          }));
        } catch (err) {
          set({ error: errMsg(err, "Failed to delete memory") });
        }
      },

      // ── Design ─────────────────────────────────────────────────
      setDesignPhase: (phase) => set({ designPhase: phase }),
      setActiveDesignSession: (session) => set({ activeDesignSession: session }),
      appendDesignOutputLine: (line) =>
        set((state) => {
          if (!state.activeDesignSession) return {};
          return {
            activeDesignSession: {
              ...state.activeDesignSession,
              outputLines: [...state.activeDesignSession.outputLines, line],
            },
          };
        }),

      // ── UI ───────────────────────────────────────────────────────
      setSidebarSection: (section) => set({ sidebarSection: section }),
      setEditorTab: (tab) => set({ editorTab: tab }),
      setError: (error) => set({ error }),
    }),
    {
      name: "persona-ui-state",
      partialize: (state) => ({
        sidebarSection: state.sidebarSection,
        selectedPersonaId: state.selectedPersonaId,
        overviewTab: state.overviewTab,
        editorTab: state.editorTab,
      }),
    },
    ),
    { name: "persona-store" },
  ),
);

/** Listen for healing-event from Tauri backend and auto-refresh issues. */
let healingListenerAttached = false;
export function initHealingListener() {
  if (healingListenerAttached) return;
  healingListenerAttached = true;
  listen("healing-event", () => {
    usePersonaStore.getState().fetchHealingIssues();
  });
}
