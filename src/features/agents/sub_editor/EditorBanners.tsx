import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Wand2, Cloud, LogIn, X } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { useAuthStore } from '@/stores/authStore';

interface UnsavedBannerProps {
  visible: boolean;
  changedSections: string[];
  onSaveAndSwitch: () => void;
  onDiscardAndSwitch: () => void;
  onDismiss: () => void;
}

export function UnsavedChangesBanner({
  visible, changedSections, onSaveAndSwitch, onDiscardAndSwitch, onDismiss,
}: UnsavedBannerProps) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden"
        >
          <div className="mx-6 my-2 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 flex items-center gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span className="text-sm text-amber-400/90 flex-1">
              Unsaved changes{changedSections.length > 0 ? `: ${changedSections.join(', ')}` : ''}
            </span>
            <button onClick={onSaveAndSwitch} className="px-3 py-1 rounded-lg text-sm font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 transition-colors">
              Save & Switch
            </button>
            <button onClick={onDiscardAndSwitch} className="px-3 py-1 rounded-lg text-sm font-medium bg-secondary/50 text-foreground/80 border border-primary/15 hover:bg-secondary/70 transition-colors">
              Discard
            </button>
            <button onClick={onDismiss} className="p-1 rounded hover:bg-secondary/60 text-muted-foreground/90 transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function DesignNudgeBanner() {
  const showDesignNudge = usePersonaStore((s) => s.showDesignNudge);
  const setShowDesignNudge = usePersonaStore((s) => s.setShowDesignNudge);
  const editorTab = usePersonaStore((s) => s.editorTab);
  const setEditorTab = usePersonaStore((s) => s.setEditorTab);

  return (
    <AnimatePresence>
      {showDesignNudge && editorTab !== 'design' && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="overflow-hidden"
        >
          <div className="mx-6 my-2 bg-violet-500/10 border border-violet-500/20 rounded-xl p-3 flex items-center gap-3">
            <Wand2 className="w-4 h-4 text-violet-400 flex-shrink-0" />
            <span className="text-sm text-violet-300/90 flex-1">
              Customize this template with the AI Design Wizard
            </span>
            <button
              onClick={() => { setEditorTab('design'); setShowDesignNudge(false); }}
              className="px-3 py-1 rounded-lg text-sm font-medium bg-violet-500/20 text-violet-300 border border-violet-500/30 hover:bg-violet-500/30 transition-colors"
            >
              Try Design Wizard
            </button>
            <button onClick={() => setShowDesignNudge(false)} className="p-1 rounded hover:bg-secondary/60 text-muted-foreground/90 transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function CloudNudgeBanner() {
  const showCloudNudge = usePersonaStore((s) => s.showCloudNudge);
  const setShowCloudNudge = usePersonaStore((s) => s.setShowCloudNudge);
  const setSidebarSection = usePersonaStore((s) => s.setSidebarSection);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return (
    <AnimatePresence>
      {showCloudNudge && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="overflow-hidden"
        >
          <div className="mx-6 my-2 bg-sky-500/10 border border-sky-500/20 rounded-xl p-3 flex items-center gap-3">
            <Cloud className="w-4 h-4 text-sky-400 flex-shrink-0" />
            <span className="text-sm text-sky-300/90 flex-1">
              {isAuthenticated
                ? 'Connect a cloud orchestrator to run personas remotely'
                : 'Sign in to unlock cloud features and remote execution'}
            </span>
            {!isAuthenticated && (
              <button
                onClick={() => { setSidebarSection('settings'); setShowCloudNudge(false); }}
                className="px-3 py-1 rounded-lg text-sm font-medium bg-sky-500/20 text-sky-300 border border-sky-500/30 hover:bg-sky-500/30 transition-colors flex items-center gap-1.5"
              >
                <LogIn className="w-3 h-3" />
                Sign In
              </button>
            )}
            <button
              onClick={() => { setSidebarSection('cloud'); setShowCloudNudge(false); }}
              className="px-3 py-1 rounded-lg text-sm font-medium bg-sky-500/20 text-sky-300 border border-sky-500/30 hover:bg-sky-500/30 transition-colors flex items-center gap-1.5"
            >
              <Cloud className="w-3 h-3" />
              Set up Cloud
            </button>
            <button onClick={() => setShowCloudNudge(false)} className="p-1 rounded hover:bg-secondary/60 text-muted-foreground/90 transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
