import { useState, useEffect, useRef } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';

interface InlineConfirmProps {
  message: string;
  onConfirm: () => void;
  children: (props: { requestConfirm: () => void }) => React.ReactNode;
}

export function InlineConfirm({ message, onConfirm, children }: InlineConfirmProps) {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();
  const st = t.sharing;

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
        <div className="absolute right-0 bottom-full mb-1 z-50 rounded-card border border-border bg-background shadow-elevation-3 p-2.5 min-w-[180px]">
          <p className="typo-caption text-foreground mb-2">{message}</p>
          <div className="flex gap-1.5 justify-end">
            <Button
              type="button"
              onClick={() => setOpen(false)}
              variant="secondary"
              size="xs"
            >
              {st.cancel}
            </Button>
            <Button
              type="button"
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
              variant="ghost"
              size="xs"
            >
              {st.confirm}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
