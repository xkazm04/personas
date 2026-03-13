import { useCallback } from 'react';
import { useAgentStore } from "@/stores/agentStore";
import { useToastStore } from '@/stores/toastStore';
import { parseJsonOrDefault } from '@/lib/utils/parseJson';
import type { DryRunIssue } from './types';
import type { DesignContextData } from '@/lib/types/frontendTypes';

export function useApplyHealthFix() {
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const applyPersonaOp = useAgentStore((s) => s.applyPersonaOp);
  const addToast = useToastStore((s) => s.addToast);

  const handleApplyFix = useCallback(async (issue: DryRunIssue) => {
    if (!selectedPersona || !issue.proposal) return;

    try {
      const ctx = parseJsonOrDefault<DesignContextData | null>(selectedPersona.design_context, null) ?? {};
      let updated = { ...ctx };

      for (const action of issue.proposal.actions) {
        switch (action.type) {
          case 'UPDATE_COMPONENT_CREDENTIAL': {
            const { componentId, credentialId } = action.payload as { componentId: string; credentialId: string };
            updated = {
              ...updated,
              credentialLinks: { ...updated.credentialLinks, [componentId]: credentialId },
            };
            break;
          }
          case 'AUTO_MATCH_CREDENTIALS': {
            const { credentials } = action.payload as { credentials: Array<{ id: string; service_type: string }> };
            const links = { ...updated.credentialLinks };
            for (const cred of credentials) {
              if (!links[cred.service_type]) {
                links[cred.service_type] = cred.id;
              }
            }
            updated = { ...updated, credentialLinks: links };
            break;
          }
          case 'ADD_USE_CASE_WITH_DATA': {
            const { title, description, category } = action.payload as { title: string; description: string; category: string };
            const useCases = updated.useCases ?? [];
            updated = {
              ...updated,
              useCases: [...useCases, {
                id: `hc_uc_${Date.now()}`,
                title,
                description,
                category,
              }],
            };
            break;
          }
          default:
            break;
        }
      }

      await applyPersonaOp(selectedPersona.id, {
        kind: 'UpdateDesignContext',
        design_context: JSON.stringify(updated),
      });

      addToast(`Applied fix: ${issue.proposal.label}`, 'success');
    } catch (err) {
      addToast(`Failed to apply fix: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [selectedPersona, applyPersonaOp, addToast]);

  return handleApplyFix;
}
