import { motion } from 'framer-motion';
import { Bot } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';

export default function PersonaOverviewPage() {
  const personas = usePersonaStore(s => s.personas);
  const selectPersona = usePersonaStore(s => s.selectPersona);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">All Agents</h1>
        <p className="text-sm text-muted-foreground/50 mt-1">{personas.length} agents configured</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {personas.map((persona, i) => (
          <motion.button
            key={persona.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 25, delay: i * 0.05 }}
            whileHover={{ y: -2, transition: { duration: 0.15 } }}
            onClick={() => selectPersona(persona.id)}
            className="text-left p-4 rounded-xl border border-primary/10 bg-secondary/30 hover:bg-secondary/50 hover:border-primary/20 transition-all group"
          >
            <div className="flex items-center gap-3 mb-2">
              {persona.icon ? (
                persona.icon.startsWith('http') ? (
                  <img src={persona.icon} alt="" className="w-8 h-8" />
                ) : (
                  <span className="text-2xl">{persona.icon}</span>
                )
              ) : (
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: (persona.color || '#8b5cf6') + '20' }}>
                  <Bot className="w-4 h-4" style={{ color: persona.color || '#8b5cf6' }} />
                </div>
              )}
              <div className={`w-2 h-2 rounded-full ${persona.enabled ? 'bg-emerald-400' : 'bg-muted-foreground/20'}`} />
            </div>
            <h3 className="text-sm font-medium text-foreground/90 truncate">{persona.name}</h3>
            {persona.description && (
              <p className="text-xs text-muted-foreground/50 mt-1 line-clamp-2">{persona.description}</p>
            )}
          </motion.button>
        ))}
      </div>
    </div>
  );
}
