export function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground/80">
      <img
        src="/illustrations/empty-template-gallery.png"
        alt=""
        aria-hidden="true"
        width={200}
        height={160}
        style={{ objectFit: 'contain' }}
      />
      <p className="text-sm font-medium">No generated templates yet</p>
      <p className="text-sm text-muted-foreground/80 text-center max-w-xs">
        Use the <span className="text-cyan-300">Synthesize Team</span> button in the header or the Claude Code skill to generate templates.
      </p>
    </div>
  );
}
