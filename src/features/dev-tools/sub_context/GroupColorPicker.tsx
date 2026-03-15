// ---------------------------------------------------------------------------
// Color palette constants and GroupColorPicker component
// ---------------------------------------------------------------------------

export const COLOR_PALETTE = [
  { id: 'red', bg: 'bg-red-400', ring: 'ring-red-400/30' },
  { id: 'orange', bg: 'bg-orange-400', ring: 'ring-orange-400/30' },
  { id: 'amber', bg: 'bg-amber-400', ring: 'ring-amber-400/30' },
  { id: 'emerald', bg: 'bg-emerald-400', ring: 'ring-emerald-400/30' },
  { id: 'blue', bg: 'bg-blue-400', ring: 'ring-blue-400/30' },
  { id: 'indigo', bg: 'bg-indigo-400', ring: 'ring-indigo-400/30' },
  { id: 'violet', bg: 'bg-violet-400', ring: 'ring-violet-400/30' },
  { id: 'pink', bg: 'bg-pink-400', ring: 'ring-pink-400/30' },
];

export function colorDot(colorId: string) {
  return COLOR_PALETTE.find((p) => p.id === colorId) ?? COLOR_PALETTE[0]!;
}

export default function GroupColorPicker({
  selectedColor,
  onChange,
}: {
  selectedColor: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="flex gap-1.5">
      {COLOR_PALETTE.map((c) => (
        <button
          key={c.id}
          onClick={() => onChange(c.id)}
          className={`w-5 h-5 rounded-full ${c.bg} transition-all ${
            selectedColor === c.id ? `ring-2 ${c.ring} scale-110` : 'opacity-60 hover:opacity-100'
          }`}
        />
      ))}
    </div>
  );
}
