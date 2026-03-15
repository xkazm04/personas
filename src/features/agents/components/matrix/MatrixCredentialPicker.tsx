/**
 * Simplified inline credential picker for the matrix cell context.
 *
 * Shows ranked credentials (best match first) in a compact dropdown.
 * Designed to fit within the constrained space of a matrix cell.
 */
import { Star } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface CredentialItem {
  id: string;
  name: string;
  service_type: string;
}

interface MatrixCredentialPickerProps {
  matchingCreds: CredentialItem[];
  otherCreds: CredentialItem[];
  onSelect: (credentialId: string) => void;
}

export function MatrixCredentialPicker({
  matchingCreds,
  otherCreds,
  onSelect,
}: MatrixCredentialPickerProps) {
  const allEmpty = matchingCreds.length === 0 && otherCreds.length === 0;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: "auto", opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="overflow-hidden"
      >
        <div className="mt-1 max-h-32 overflow-y-auto rounded-lg border border-primary/10 bg-background/40 backdrop-blur-sm">
          {allEmpty && (
            <div className="px-2.5 py-2 text-[11px] text-muted-foreground/60 text-center">
              No stored credentials
            </div>
          )}

          {matchingCreds.length > 0 && (
            <div>
              <div className="px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
                Best match
              </div>
              {matchingCreds.map((cred) => (
                <button
                  key={cred.id}
                  type="button"
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-secondary/40 transition-colors"
                  onClick={() => onSelect(cred.id)}
                >
                  <Star className="w-3 h-3 text-amber-400/60 flex-shrink-0" />
                  <span className="text-[11px] text-foreground/80 truncate">{cred.name}</span>
                  <span className="text-[10px] text-muted-foreground/50 ml-auto flex-shrink-0">
                    {cred.service_type}
                  </span>
                </button>
              ))}
            </div>
          )}

          {otherCreds.length > 0 && (
            <div>
              {matchingCreds.length > 0 && (
                <div className="px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
                  Other
                </div>
              )}
              {otherCreds.map((cred) => (
                <button
                  key={cred.id}
                  type="button"
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-secondary/40 transition-colors"
                  onClick={() => onSelect(cred.id)}
                >
                  <div className="w-3 h-3 flex-shrink-0" />
                  <span className="text-[11px] text-foreground/80 truncate">{cred.name}</span>
                  <span className="text-[10px] text-muted-foreground/50 ml-auto flex-shrink-0">
                    {cred.service_type}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
