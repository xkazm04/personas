import type { ReactNode } from 'react';

/**
 * Prose-width wrapper for form-heavy editor tabs (Settings, Use Cases, Prompt, etc.).
 * Constrains content to a comfortable reading width on wide monitors.
 * Tabs that benefit from full width (Activity, Chat) should NOT use this wrapper.
 */
export function EditorTabContent({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`max-w-[900px] mx-auto ${className}`.trim()}>
      {children}
    </div>
  );
}
