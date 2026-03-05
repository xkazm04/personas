import { motion } from 'framer-motion';
import { Globe, Shield, ArrowRight, ExternalLink } from 'lucide-react';
import type { CredentialDesignResult } from '@/hooks/design/useCredentialDesign';
import { MarkdownRenderer } from '@/features/shared/components/MarkdownRenderer';
import { buildConnectorContext } from './types';

interface AutoCredConsentProps {
  designResult: CredentialDesignResult;
  onConsent: () => void;
  onCancel: () => void;
}

export function AutoCredConsent({ designResult, onConsent, onCancel }: AutoCredConsentProps) {
  const ctx = buildConnectorContext(designResult);
  const fieldCount = ctx.fields.length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-5"
    >
      {/* Header */}
      <div className="flex items-start gap-4 p-4 rounded-xl border border-cyan-500/20 bg-cyan-500/5">
        <div
          className="w-12 h-12 rounded-xl border flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${designResult.connector.color}15`, borderColor: `${designResult.connector.color}30` }}
        >
          <Globe className="w-6 h-6" style={{ color: designResult.connector.color }} />
        </div>
        <div>
          <h3 className="text-base font-semibold text-foreground">
            Auto-Setup: {designResult.connector.label}
          </h3>
          <p className="text-sm text-muted-foreground/80 mt-1">
            Claude designed the credential schema. Now Playwright will open a browser
            to create the actual credential on your behalf.
          </p>
        </div>
      </div>

      {/* What will happen */}
      <div className="space-y-2.5">
        <p className="text-sm font-medium text-foreground/90">What will happen:</p>
        <div className="space-y-2">
          <Step number={1} text={`Open ${ctx.docsUrl ? 'credential page' : designResult.connector.label + ' dashboard'} in browser`} />
          <Step number={2} text="Navigate to token/key creation form" />
          <Step number={3} text={`Fill required fields (${fieldCount} field${fieldCount !== 1 ? 's' : ''})`} />
          <Step number={4} text="Extract generated credential values" />
          <Step number={5} text="Return here for your review before saving" />
        </div>
      </div>

      {/* Setup instructions summary */}
      {designResult.setup_instructions && (
        <div className="p-3 rounded-lg border border-primary/10 bg-secondary/20">
          <p className="text-sm font-medium text-muted-foreground/60 mb-1.5">Setup context from design analysis:</p>
          <MarkdownRenderer
            content={designResult.setup_instructions}
            className="[&_p]:text-sm [&_p]:text-muted-foreground/80 [&_p]:mb-1.5 [&_ul]:text-sm [&_ol]:text-sm [&_li]:text-muted-foreground/80 [&_code]:text-sm"
          />
        </div>
      )}

      {/* Security notice */}
      <div className="flex items-start gap-2.5 p-3 rounded-lg border border-amber-500/20 bg-amber-500/5">
        <Shield className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
        <div className="text-sm text-muted-foreground/80">
          <span className="font-medium text-amber-400/90">Your consent is required.</span>{' '}
          Nothing is saved without your explicit approval. If a login page or CAPTCHA appears,
          the browser will pause for you to handle manually.
        </div>
      </div>

      {/* Docs link */}
      {ctx.docsUrl && (
        <a
          href={ctx.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-cyan-400 hover:text-cyan-300 transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          View credential docs
        </a>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-1">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-muted-foreground/70 hover:text-foreground rounded-lg hover:bg-secondary/40 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onConsent}
          className="flex items-center gap-2 px-5 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-sm font-medium transition-all shadow-lg shadow-cyan-600/20"
        >
          <Globe className="w-4 h-4" />
          Start Browser Session
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </motion.div>
  );
}

function Step({ number, text }: { number: number; text: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-5 h-5 rounded-full bg-cyan-500/15 text-cyan-400 text-sm font-medium flex items-center justify-center shrink-0">
        {number}
      </span>
      <span className="text-sm text-foreground/80">{text}</span>
    </div>
  );
}
