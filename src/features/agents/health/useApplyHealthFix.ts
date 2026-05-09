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

  const handleApplyFix = useCallback(async (issue: DryRunIssue): Promise<boolean> => {
    if (!selectedPersona || !issue.proposal) return false;

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
            // Refuse to auto-match when ANY service_type has more than one
            // credential — silently picking by array order decides "which
            // identity does this agent act as" by iteration order, which is
            // a real trust-boundary issue. Force the user to pick instead.
            const byType = new Map<string, Array<{ id: string; service_type: string }>>();
            for (const cred of credentials) {
              const list = byType.get(cred.service_type) ?? [];
              list.push(cred);
              byType.set(cred.service_type, list);
            }
            const ambiguous: string[] = [];
            for (const [type, creds] of byType) {
              if (creds.length > 1 && !updated.credentialLinks?.[type]) ambiguous.push(type);
            }
            if (ambiguous.length > 0) {
              throw new Error(
                `Auto-match blocked: ${ambiguous.length === 1 ? 'credential service' : 'credential services'} ` +
                  `${ambiguous.join(', ')} have multiple credentials. Pick the right one manually before applying.`,
              );
            }
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
      return true;
    } catch (err) {
      addToast(`Failed to apply fix: ${err instanceof Error ? err.message : String(err)}`, 'error');
      return false;
    }
  }, [selectedPersona, applyPersonaOp, addToast]);

  return handleApplyFix;
}
