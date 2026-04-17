import { Star } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { PersonaCredential } from '@/lib/types/types';

// ============================================================================
// Types
// ============================================================================

export interface CredentialPickerProps {
  isOpen: boolean;
  matchingCreds: PersonaCredential[];
  otherCreds: PersonaCredential[];
  totalCredentials: number;
  onLinkCredential: (credentialId: string, credentialName: string) => void;
}

// ============================================================================
// Component
// ============================================================================

export function CredentialPicker({
  isOpen,
  matchingCreds,
  otherCreds,
  totalCredentials,
  onLinkCredential,
}: CredentialPickerProps) {
  const { t } = useTranslation();
  return (
    <>
      {isOpen && (
        <div
          className="animate-fade-slide-in overflow-hidden"
        >
          <div className="mt-3 border border-primary/10 rounded-card bg-background/40 max-h-48 overflow-y-auto">
            {matchingCreds.length > 0 && (
              <>
                <p className="px-3 py-1.5 typo-heading font-semibold text-foreground uppercase tracking-wider border-b border-primary/5">
                  {t.templates.n8n.best_match}
                </p>
                {matchingCreds.map((cred) => (
                  <button
                    key={cred.id}
                    onClick={() => onLinkCredential(cred.id, cred.name)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-secondary/40 transition-colors border-b border-primary/5 last:border-0"
                  >
                    <Star className="w-3 h-3 text-amber-400/60 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="typo-body text-foreground truncate">{cred.name}</p>
                      <p className="typo-body text-foreground">{cred.service_type}</p>
                    </div>
                  </button>
                ))}
              </>
            )}
            {otherCreds.length > 0 && (
              <>
                {matchingCreds.length > 0 && (
                  <p className="px-3 py-1.5 typo-heading font-semibold text-foreground uppercase tracking-wider border-b border-primary/5">
                    {t.templates.n8n.other_credentials}
                  </p>
                )}
                {otherCreds.map((cred) => (
                  <button
                    key={cred.id}
                    onClick={() => onLinkCredential(cred.id, cred.name)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-secondary/40 transition-colors border-b border-primary/5 last:border-0"
                  >
                    <div className="w-3 h-3 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="typo-body text-foreground truncate">{cred.name}</p>
                      <p className="typo-body text-foreground">{cred.service_type}</p>
                    </div>
                  </button>
                ))}
              </>
            )}
            {totalCredentials === 0 && (
              <p className="px-3 py-4 typo-body text-foreground text-center">
                {t.templates.n8n.no_stored_credentials}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
