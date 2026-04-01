export function MethodBadge({ method }: { method: string }) {
  const colors: Record<string, string> = {
    GET: 'text-emerald-400 bg-emerald-500/15',
    POST: 'text-blue-400 bg-blue-500/15',
    PUT: 'text-amber-400 bg-amber-500/15',
    PATCH: 'text-orange-400 bg-orange-500/15',
    DELETE: 'text-red-400 bg-red-500/15',
    HEAD: 'text-purple-400 bg-purple-500/15',
    OPTIONS: 'text-gray-400 bg-gray-500/15',
  };
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider shrink-0 ${colors[method] ?? 'text-gray-400 bg-gray-500/15'}`}>
      {method}
    </span>
  );
}
