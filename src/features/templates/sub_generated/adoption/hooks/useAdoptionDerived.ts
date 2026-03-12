/**
 * useAdoptionDerived -- computes derived data from wizard state: use case flows,
 * connector readiness, adoption requirements, required connectors, and completed steps.
 *
 * Extracted from AdoptionWizardContext to isolate derivation concerns.
 */
import { useEffect, useMemo, type MutableRefObject } from 'react';
import type { ConnectorReadinessStatus } from '@/lib/types/designTypes';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';
import { parseJsonSafe } from '@/lib/utils/parseJson';
import { deriveConnectorReadiness } from '../../shared/ConnectorReadiness';
import { getAdoptionRequirements } from '../templateVariables';
import { getArchitectureComponent } from '@/lib/credentials/connectorRoles';
import { deriveRequirementsFromFlows } from '../steps/choose/ChooseStep';
import type { RequiredConnector } from '../steps/connect/ConnectStep';
import { getRoleForConnector } from '@/lib/credentials/connectorRoles';
import {
  ADOPT_STEPS,
  ADOPT_STEP_META,
  type AdoptWizardStep,
  type AdoptState,
} from './useAdoptReducer';
import type { useAdoptReducer } from './useAdoptReducer';

interface UseAdoptionDerivedOptions {
  review: PersonaDesignReview | null;
  state: AdoptState;
  wizard: ReturnType<typeof useAdoptReducer>;
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
  highWaterMarkRef: MutableRefObject<number>;
}

export function useAdoptionDerived({
  review,
  state,
  wizard,
  credentials,
  connectorDefinitions,
  highWaterMarkRef,
}: UseAdoptionDerivedOptions) {
  // -- Use case flows --

  const useCaseFlows = useMemo<UseCaseFlow[]>(() => {
    if (!review) return [];
    const flows = parseJsonSafe<UseCaseFlow[]>(review.use_case_flows, []);
    if (flows.length > 0) return flows;
    const raw = state.designResult as unknown as Record<string, unknown> | null;
    return raw?.use_case_flows
      ? parseJsonSafe<UseCaseFlow[]>(JSON.stringify(raw.use_case_flows), [])
      : [];
  }, [review, state.designResult]);

  // Pre-select all use case IDs on init
  useEffect(() => {
    if (useCaseFlows.length > 0 && state.selectedUseCaseIds.size === 0 && state.step === 'choose') {
      wizard.selectAllUseCases(useCaseFlows.map((f) => f.id));
    }
  }, [useCaseFlows, state.selectedUseCaseIds.size, state.step, wizard.selectAllUseCases]);

  // -- Derived data --

  const designResult = state.designResult;

  const hasDatabaseConnector = useMemo(() => {
    const connectors = designResult?.suggested_connectors ?? [];
    return connectors.some((c) => {
      const role = getRoleForConnector(c.name);
      return role?.role === 'database';
    });
  }, [designResult]);

  const readinessStatuses = useMemo<ConnectorReadinessStatus[]>(() => {
    if (!designResult?.suggested_connectors) return [];
    const installedNames = new Set(connectorDefinitions.map((c) => c.name));
    const credTypes = new Set(credentials.map((c) => c.service_type));
    return deriveConnectorReadiness(designResult.suggested_connectors, installedNames, credTypes);
  }, [designResult, connectorDefinitions, credentials]);

  const adoptionRequirements = useMemo(
    () => (designResult ? getAdoptionRequirements(designResult) : []),
    [designResult],
  );

  const requiredConnectors = useMemo<RequiredConnector[]>(() => {
    if (!designResult) return [];
    const allConnectors = designResult.suggested_connectors ?? [];

    let neededOriginalNames: Set<string>;
    if (useCaseFlows.length > 0 && state.selectedUseCaseIds.size > 0) {
      const { connectorNames } = deriveRequirementsFromFlows(useCaseFlows, state.selectedUseCaseIds);
      neededOriginalNames = connectorNames;
    } else {
      neededOriginalNames = new Set(
        allConnectors
          .filter(
            (c) =>
              state.selectedConnectorNames.has(c.name) ||
              state.selectedConnectorNames.has(state.connectorSwaps[c.name] || ''),
          )
          .map((c) => c.name),
      );
    }

    return allConnectors
      .filter((c) => neededOriginalNames.has(c.name))
      .map((c) => {
        const component = getArchitectureComponent(c.name);
        const activeName = state.connectorSwaps[c.name] || c.name;
        return {
          name: c.name,
          activeName,
          role: c.role || component?.role,
          roleLabel: component?.label,
          roleMembers: component?.members,
          setup_url: c.setup_url,
          setup_instructions: c.setup_instructions,
          credential_fields: c.credential_fields,
        };
      });
  }, [designResult, useCaseFlows, state.selectedUseCaseIds, state.selectedConnectorNames, state.connectorSwaps]);

  // Track highest step reached so completed steps stay "locked" when navigating back
  const currentIndex = ADOPT_STEP_META[state.step].index;
  if (currentIndex > highWaterMarkRef.current) {
    highWaterMarkRef.current = currentIndex;
  }

  const completedSteps = useMemo<Set<AdoptWizardStep>>(() => {
    const completed = new Set<AdoptWizardStep>();
    const hwm = highWaterMarkRef.current;
    for (const step of ADOPT_STEPS) {
      const stepIdx = ADOPT_STEP_META[step].index;
      if (stepIdx < hwm || stepIdx < currentIndex) completed.add(step);
    }
    if (state.created) completed.add('create');
    return completed;
  }, [state.step, state.created]);

  return {
    useCaseFlows,
    designResult,
    hasDatabaseConnector,
    readinessStatuses,
    adoptionRequirements,
    requiredConnectors,
    completedSteps,
  };
}
