import { useState, useEffect, useRef } from 'react';

interface InlineConfirmProps {
  message: string;
  onConfirm: () => void;
  children: (props: { requestConfirm: () => void }) => React.ReactNode;
}

export function InlineConfirm({ message, onConfirm, children }: InlineConfirmProps) {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    // Auto-dismiss after 3 seconds
    timerRef.current = setTimeout(() => setOpen(false), 3000);

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      clearTimeout(timerRef.current);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      {children({ requestConfirm: () => setOpen(true) })}
      {open && (
        <div className="absolute right-0 bottom-full mb-1 z-50 rounded-lg border border-border bg-background shadow-elevation-3 p-2.5 min-w-[180px]">
          <p className="text-xs text-foreground mb-2">{message}</p>
          <div className="flex gap-1.5 justify-end">
            <button
              onClick={() => setOpen(false)}
              className="px-2 py-1 text-[11px] rounded-md border border-border hover:bg-secondary/50 text-muted-foreground"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
              className="px-2 py-1 text-[11px] rounded-md bg-red-500/90 text-white hover:bg-red-500"
            >
              Confirm
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
