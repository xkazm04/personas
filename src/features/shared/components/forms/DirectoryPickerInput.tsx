import { useState } from 'react';
import { FolderOpen, Loader2 } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';

interface DirectoryPickerInputProps {
  value: string;
  onChange: (path: string) => void;
  placeholder?: string;
  className?: string;
}

export function DirectoryPickerInput({
  value,
  onChange,
  placeholder = 'Select a directory...',
  className,
}: DirectoryPickerInputProps) {
  const [browsing, setBrowsing] = useState(false);

  const handleBrowse = async () => {
    setBrowsing(true);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select output directory',
      });
      if (selected && typeof selected === 'string') {
        onChange(selected);
      }
    } catch {
      // User cancelled or dialog failed
    } finally {
      setBrowsing(false);
    }
  };

  return (
    <div className={`flex items-center gap-2 max-w-lg ${className ?? ''}`}>
      <div className="relative flex-1">
        <FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/40 pointer-events-none" />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-9 pr-3 py-1.5 text-sm rounded-lg border border-white/[0.08] bg-white/[0.03] text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/30 focus:bg-white/[0.05] transition-all"
        />
      </div>
      <button
        type="button"
        onClick={handleBrowse}
        disabled={browsing}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-primary/15 bg-background/80 text-foreground/70 hover:border-primary/25 hover:text-foreground transition-all disabled:opacity-50"
      >
        {browsing ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <FolderOpen className="w-3.5 h-3.5" />
        )}
        Browse
      </button>
    </div>
  );
}
