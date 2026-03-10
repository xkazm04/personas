import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ExternalLink, MessageSquare, Hand, Check } from 'lucide-react';
import type { BrowserLogEntry } from './types';
import { openExternalUrl } from '@/api/system/system';

/** Prominent amber card for WAITING: messages */
export function WaitingCard({ entry, isLatest }: { entry: BrowserLogEntry; isLatest: boolean }) {
  const [confirmed, setConfirmed] = useState(false);
  const message = entry.message.replace(/^WAITING:\s*/i, '');

  const url = entry.url ?? (() => {
    const match = message.match(/https?:\/\/[^\s)>\]"'`*_]+/);
    return match ? match[0] : null;
  })();

  const handleOpenUrl = useCallback(() => {
    if (url) openExternalUrl(url).catch(console.error);
  }, [url]);

  if (confirmed && !isLatest) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-emerald-500/15 bg-emerald-500/5 text-sm text-emerald-400/60">
        <Check className="w-3 h-3" />
        <span className="truncate">{message}</span>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`flex items-start gap-3 p-3 rounded-xl border-2 ${
        confirmed ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/8'
      }`}
    >
      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
        confirmed ? 'bg-emerald-500/15' : 'bg-amber-500/15'
      }`}>
        {confirmed ? <Check className="w-4 h-4 text-emerald-400" /> : <Hand className="w-4 h-4 text-amber-400" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold ${confirmed ? 'text-emerald-400' : 'text-amber-400'}`}>
          {confirmed ? 'Step confirmed — waiting for detection' : 'Action Required'}
        </p>
        <p className="text-sm text-foreground/80 mt-1 leading-relaxed">{message}</p>
        {!confirmed && (
          <div className="flex items-center gap-2 mt-2.5">
            {url && (
              <button
                onClick={handleOpenUrl}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-blue-500/25 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                Open in Browser
              </button>
            )}
            <button
              onClick={() => setConfirmed(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-emerald-500/25 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
            >
              <Check className="w-3 h-3" />
              I've completed this
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

/** Violet card for input requests */
export function InputRequestCard({ entry }: { entry: BrowserLogEntry }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex items-start gap-3 p-3 rounded-xl border-2 border-violet-500/30 bg-violet-500/8"
    >
      <div className="w-8 h-8 rounded-full bg-violet-500/15 flex items-center justify-center shrink-0 mt-0.5">
        <MessageSquare className="w-4 h-4 text-violet-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-violet-400">Input Requested</p>
        <p className="text-sm text-foreground/80 mt-1 leading-relaxed">{entry.message}</p>
      </div>
    </motion.div>
  );
}
