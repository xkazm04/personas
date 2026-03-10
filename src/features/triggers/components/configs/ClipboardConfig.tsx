export interface ClipboardConfigProps {
  clipboardContentType: string;
  setClipboardContentType: (v: string) => void;
  clipboardPattern: string;
  setClipboardPattern: (v: string) => void;
  clipboardInterval: string;
  setClipboardInterval: (v: string) => void;
}

export function ClipboardConfig({
  clipboardContentType, setClipboardContentType,
  clipboardPattern, setClipboardPattern,
  clipboardInterval, setClipboardInterval,
}: ClipboardConfigProps) {
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-foreground/80 mb-1.5">Content Type</label>
        <div className="flex gap-1.5">
          {(['text', 'image', 'any'] as const).map((ct) => (
            <button
              key={ct}
              type="button"
              onClick={() => setClipboardContentType(ct)}
              className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-all border capitalize ${
                clipboardContentType === ct
                  ? 'bg-pink-500/15 text-pink-400 border-pink-500/30'
                  : 'bg-secondary/30 text-muted-foreground/80 border-border/30 hover:bg-secondary/50'
              }`}
            >
              {ct}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-foreground/80 mb-1.5">
          Text Pattern <span className="text-muted-foreground/50">(optional regex)</span>
        </label>
        <input
          type="text"
          value={clipboardPattern}
          onChange={(e) => setClipboardPattern(e.target.value)}
          placeholder="e.g. https?://.* or error|exception"
          className="w-full px-3 py-2 bg-background/50 border border-primary/15 rounded-xl text-foreground font-mono text-sm placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-pink-400/40 transition-all"
        />
        <p className="text-sm text-muted-foreground/80 mt-1">Only fires when clipboard text matches this pattern</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-foreground/80 mb-1.5">
          Poll Interval (seconds)
        </label>
        <input
          type="number"
          value={clipboardInterval}
          onChange={(e) => setClipboardInterval(e.target.value)}
          min="2"
          className="w-24 px-3 py-2 bg-background/50 border border-primary/15 rounded-xl text-foreground font-mono text-sm focus:outline-none focus:ring-2 focus:ring-pink-400/40 transition-all"
        />
      </div>
    </div>
  );
}
