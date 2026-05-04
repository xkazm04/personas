import { BrainViewer } from '../BrainViewer';

/**
 * Memory tab — same brain viewer the chat panel uses, rendered inline
 * (no overlay, no close button) inside the plugin page's ContentBody.
 *
 * Shares state with the chat brain viewer via the `companionStore`'s
 * `brainView` slot, so navigating one surface to a memory item leaves
 * the other surface pointed at the same item. Acceptable for v1 — they
 * almost never get used concurrently.
 */
export default function MemoryPanel() {
  return (
    <div className="h-full -mx-4 -mb-6 sm:-mx-6 lg:-mx-8 rounded-card overflow-hidden border border-foreground/10 bg-secondary/40">
      <BrainViewer />
    </div>
  );
}
