/**
 * Ambient gradient mesh background used for branded hero sections.
 * Provides named presets so every screen shares the same visual language.
 */

interface Orb {
  position: string;
  size: string;
  color: string;
  blur: string;
}

interface PresetConfig {
  orbs: Orb[];
  grid?: string;
}

const PRESETS: Record<string, PresetConfig> = {
  welcome: {
    orbs: [
      { position: 'top-[-20%] left-[10%]', size: 'w-[500px] h-[500px]', color: 'bg-indigo-500/5', blur: 'blur-[150px]' },
      { position: 'top-[10%] right-[-5%]', size: 'w-[400px] h-[400px]', color: 'bg-cyan-500/5', blur: 'blur-[120px]' },
      { position: 'bottom-[-10%] left-[30%]', size: 'w-[350px] h-[350px]', color: 'bg-purple-500/4', blur: 'blur-[120px]' },
    ],
    grid: 'bg-[linear-gradient(rgba(59,130,246,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.02)_1px,transparent_1px)] bg-[size:48px_48px]',
  },
  dashboard: {
    orbs: [
      { position: 'top-[-10%] left-[-5%]', size: 'w-[40%] h-[40%]', color: 'bg-indigo-500/5', blur: 'blur-[120px]' },
      { position: 'bottom-[5%] right-[-5%]', size: 'w-[30%] h-[30%]', color: 'bg-violet-500/5', blur: 'blur-[100px]' },
    ],
  },
  detail: {
    orbs: [
      { position: 'top-[-15%] left-[5%]', size: 'w-[35%] h-[35%]', color: 'bg-indigo-500/4', blur: 'blur-[130px]' },
      { position: 'bottom-[-5%] right-[0%]', size: 'w-[25%] h-[25%]', color: 'bg-cyan-500/4', blur: 'blur-[100px]' },
    ],
  },
};

export type HeroMeshPreset = keyof typeof PRESETS;

interface HeroMeshProps {
  preset?: HeroMeshPreset;
  className?: string;
}

export function HeroMesh({ preset = 'welcome', className }: HeroMeshProps) {
  const config = PRESETS[preset]!;
  return (
    <div className={`absolute inset-0 overflow-hidden pointer-events-none ${className ?? ''}`}>
      {config.orbs.map((orb, i) => (
        <div key={i} className={`absolute ${orb.position} ${orb.size} ${orb.color} ${orb.blur} rounded-full animate-hero-orb-drift`} />
      ))}
      {config.grid && <div className={`absolute inset-0 ${config.grid}`} />}
    </div>
  );
}
