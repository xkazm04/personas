import { motion } from 'framer-motion';
import { CheckCircle2, RefreshCw, AlertTriangle, XCircle } from 'lucide-react';
import type { ConfirmResult } from './n8nConfirmTypes';

interface SuccessBannerProps {
  personaName: string | null;
  confirmResult: ConfirmResult | null;
  onReset: () => void;
}

export function SuccessBanner({ personaName, confirmResult, onReset }: SuccessBannerProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', damping: 15, stiffness: 300 }}
      className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center"
    >
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.1, type: 'spring', damping: 10, stiffness: 200 }}
        className="w-14 h-14 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto mb-3"
      >
        <CheckCircle2 className="w-8 h-8 text-emerald-400" />
      </motion.div>
      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="text-sm font-semibold text-emerald-400 mb-1"
      >
        Persona Created Successfully
      </motion.p>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="text-sm text-emerald-400/60 mb-2"
      >
        {personaName ?? 'Your persona'} is ready to use. Find it in the sidebar.
      </motion.p>
      {confirmResult && (confirmResult.triggersCreated > 0 || confirmResult.toolsCreated > 0) && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.35 }}
          className="text-sm text-emerald-400/50 mb-2"
        >
          Created {confirmResult.triggersCreated > 0 ? `${confirmResult.triggersCreated} trigger${confirmResult.triggersCreated !== 1 ? 's' : ''}` : ''}
          {confirmResult.triggersCreated > 0 && confirmResult.toolsCreated > 0 ? ' + ' : ''}
          {confirmResult.toolsCreated > 0 ? `${confirmResult.toolsCreated} tool${confirmResult.toolsCreated !== 1 ? 's' : ''}` : ''}
        </motion.p>
      )}
      {confirmResult && confirmResult.entityErrors.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.38 }}
          className="text-sm text-red-400/70 mb-2 space-y-1"
        >
          <div className="flex items-center gap-1.5 justify-center">
            <XCircle className="w-3 h-3" />
            <span>
              {confirmResult.entityErrors.length} {confirmResult.entityErrors.length === 1 ? 'entity' : 'entities'} failed
            </span>
          </div>
          <div className="text-sm text-red-400/50 max-h-24 overflow-y-auto">
            {confirmResult.entityErrors.map((e, i) => (
              <div key={i}>{e.entity_type} &lsquo;{e.entity_name}&rsquo;: {e.error}</div>
            ))}
          </div>
        </motion.div>
      )}
      {confirmResult && confirmResult.connectorsNeedingSetup.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="flex items-center gap-2 justify-center text-sm text-amber-400/60 mb-2"
        >
          <AlertTriangle className="w-3 h-3" />
          Configure connector{confirmResult.connectorsNeedingSetup.length !== 1 ? 's' : ''}: {confirmResult.connectorsNeedingSetup.join(', ')}
        </motion.div>
      )}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="flex items-center justify-center gap-3"
      >
        <button
          onClick={onReset}
          className="flex items-center gap-2 px-4 py-2 text-sm rounded-xl border border-emerald-500/25 text-emerald-300 hover:bg-emerald-500/15 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Import Another
        </button>
      </motion.div>
    </motion.div>
  );
}
