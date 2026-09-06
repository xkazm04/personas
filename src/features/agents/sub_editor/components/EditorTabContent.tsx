import type { ReactNode } from 'react';

/**
 * Prose-width wrapper for form-heavy editor tabs (Settings today; Use Cases
 * and Prompt moved into the Design hub and Chat was retired).
 * Constrains content to a comfortable reading width on wide monitors.
 * Tabs that benefit from full width (Activity, Lab, Design) should NOT use this wrapper.
 */
export function EditorTabContent({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`max-w-[900px] mx-auto ${className}`.trim()}>
      {children}
    </div>
  );
}
