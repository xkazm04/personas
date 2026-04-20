// PROTOTYPE — Variant 1 "Mosaic" (Home Base style)
// Spatial mosaic with typographic hero — approachable, magazine-like.
// Combines Direction A (persona overview) + Direction C (setup/management).
import { motion, type Variants } from 'framer-motion';
import {
  Sparkles, ChevronRight, Check, AlertCircle, Plus, Mail, Hash, GitBranch, Calendar,
  ShieldCheck, MessageSquare, FileOutput, Wrench,
} from 'lucide-react';
import { summary } from './mockData';

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } },
};

const stagger: Variants = {
  visible: { transition: { staggerChildren: 0.05 } },
};

export function SimpleModeVariantMosaic() {
  return (
    <motion.div
      variants={stagger}
      initial="hidden"
      animate="visible"
      className="h-full flex flex-col bg-gradient-to-br from-amber-500/[0.04] via-background to-violet-500/[0.04] text-foreground overflow-hidden"
    >
      {/* ─────── HERO: greeting + summary ─────── */}
      <motion.div
        variants={fadeUp}
        className="px-8 pt-6 pb-4 flex items-end justify-between gap-6 shrink-0"
      >
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-[10px] text-violet-200 mb-2">
            <Sparkles className="w-3 h-3" />
            <span>Thursday, April 20</span>
          </div>
          <h1 className="text-[28px] leading-none font-serif tracking-tight text-foreground">
            Good morning, <span className="italic text-amber-200/90">Klára</span>.
          </h1>
          <p className="text-sm text-foreground/60 mt-1.5">
            Your {summary.activeCount + summary.needsSetupCount} assistants have been working.{' '}
            <span className="text-amber-300">{summary.inboxNeedsMeCount} things</span> want your eye.
          </p>
        </div>
        <div className="flex items-center gap-4 text-right">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-foreground/40">Today</div>
            <div className="text-2xl font-serif text-foreground">{summary.runsToday}<span className="text-foreground/40 text-lg"> runs</span></div>
          </div>
          <div className="w-px h-10 bg-primary/10" />
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-foreground/40">Time saved</div>
            <div className="text-2xl font-serif text-emerald-300">{summary.savedToday}</div>
          </div>
        </div>
      </motion.div>

      {/* ─────── MOSAIC: varied-size tiles mixing outputs + personas ─────── */}
      <motion.div
        variants={stagger}
        className="flex-1 min-h-0 px-8 pb-4 grid grid-cols-6 grid-rows-3 gap-3 overflow-hidden"
      >
        {/* HERO APPROVAL — col 1-3, row 1-2 */}
        <motion.div
          variants={fadeUp}
          whileHover={{ y: -2 }}
          className="col-span-3 row-span-2 rounded-3xl border border-amber-500/25 bg-gradient-to-br from-amber-500/15 via-amber-500/[0.06] to-transparent p-6 flex flex-col justify-between"
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5 text-amber-200" />
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-amber-300/80">Needs you · 5 min ago</div>
                <div className="text-sm text-foreground/70">Invoice Watcher flagged this</div>
              </div>
            </div>
            <span className="text-3xl">🧾</span>
          </div>

          <div className="space-y-1">
            <div className="text-[11px] uppercase tracking-wider text-foreground/50">Approve payment</div>
            <div className="font-serif text-3xl text-foreground leading-tight">$2,340<span className="text-foreground/50 text-xl"> to Figma</span></div>
            <p className="text-sm text-foreground/60 leading-relaxed">
              Matches your recurring subscription rule. Quick look before it files itself.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button className="flex-1 h-10 rounded-xl bg-amber-500 text-amber-950 font-medium text-sm hover:bg-amber-400 transition-colors">
              Approve
            </button>
            <button className="h-10 px-4 rounded-xl border border-primary/15 text-sm text-foreground/80 hover:bg-foreground/5">
              Details
            </button>
          </div>
        </motion.div>

        {/* MORNING BRIEF OUTPUT — col 4-6, row 1 */}
        <motion.div
          variants={fadeUp}
          whileHover={{ y: -2 }}
          className="col-span-3 row-span-1 rounded-3xl border border-emerald-500/15 bg-gradient-to-br from-emerald-500/8 to-transparent p-5 flex items-center gap-4"
        >
          <span className="text-3xl">☀</span>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-emerald-300/80">Morning brief · 7:02am</div>
            <div className="font-serif text-lg text-foreground leading-tight truncate">3 meetings today, 2 urgent emails</div>
            <div className="text-[11px] text-foreground/50 mt-0.5">from Morning Briefer · read digest →</div>
          </div>
          <FileOutput className="w-4 h-4 text-emerald-300/60" />
        </motion.div>

        {/* SLACK MENTION — col 4-5, row 2 */}
        <motion.div
          variants={fadeUp}
          whileHover={{ y: -2 }}
          className="col-span-2 row-span-1 rounded-3xl border border-violet-500/20 bg-gradient-to-br from-violet-500/10 to-transparent p-4 flex flex-col justify-between"
        >
          <div className="flex items-center justify-between">
            <MessageSquare className="w-4 h-4 text-violet-300" />
            <span className="text-[10px] text-foreground/40">12m</span>
          </div>
          <div>
            <div className="font-serif text-sm text-foreground leading-snug">Alex mentioned you in <span className="text-violet-200">#product-review</span></div>
            <div className="text-[11px] text-foreground/50 mt-1">Slack Listener</div>
          </div>
        </motion.div>

        {/* WEEKLY DRAFT — col 6, row 2 */}
        <motion.div
          variants={fadeUp}
          whileHover={{ y: -2 }}
          className="col-span-1 row-span-1 rounded-3xl border border-emerald-500/15 bg-emerald-500/5 p-4 flex flex-col justify-between"
        >
          <span className="text-2xl">✍</span>
          <div>
            <div className="text-[11px] font-medium text-foreground">Draft ready</div>
            <div className="text-[10px] text-foreground/50">Weekly Writer</div>
          </div>
        </motion.div>

        {/* PR REVIEWER NEEDS SETUP — col 1-2, row 3 */}
        <motion.div
          variants={fadeUp}
          whileHover={{ y: -2 }}
          className="col-span-2 row-span-1 rounded-3xl border border-rose-500/20 bg-gradient-to-br from-rose-500/10 to-transparent p-4 flex items-center gap-3"
        >
          <div className="w-10 h-10 rounded-2xl bg-rose-500/15 border border-rose-500/25 flex items-center justify-center">
            <Wrench className="w-4 h-4 text-rose-200" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-rose-300/80">Needs setup</div>
            <div className="font-serif text-sm text-foreground leading-tight">PR Reviewer · reconnect GitHub</div>
          </div>
          <ChevronRight className="w-4 h-4 text-rose-300/70" />
        </motion.div>

        {/* SLACK LISTENER QUICK TILE — col 3, row 3 */}
        <motion.div
          variants={fadeUp}
          whileHover={{ y: -2 }}
          className="col-span-1 row-span-1 rounded-3xl border border-primary/10 bg-foreground/[0.03] p-4 flex flex-col justify-between"
        >
          <span className="text-2xl">💬</span>
          <div>
            <div className="text-[11px] font-medium text-foreground leading-tight">Slack Listener</div>
            <div className="text-[10px] text-foreground/50 mt-0.5">active · 1 mention</div>
          </div>
        </motion.div>

        {/* INVOICE WATCHER QUICK TILE — col 4, row 3 */}
        <motion.div
          variants={fadeUp}
          whileHover={{ y: -2 }}
          className="col-span-1 row-span-1 rounded-3xl border border-primary/10 bg-foreground/[0.03] p-4 flex flex-col justify-between"
        >
          <span className="text-2xl">🧾</span>
          <div>
            <div className="text-[11px] font-medium text-foreground leading-tight">Invoice Watcher</div>
            <div className="text-[10px] text-foreground/50 mt-0.5">active · 1 flag</div>
          </div>
        </motion.div>

        {/* SEE ALL + NEW ASSISTANT — col 5-6, row 3 */}
        <motion.div
          variants={fadeUp}
          whileHover={{ y: -2 }}
          className="col-span-2 row-span-1 rounded-3xl border border-dashed border-primary/20 bg-foreground/[0.02] p-4 flex items-center justify-between group cursor-pointer hover:border-primary/40"
        >
          <div>
            <div className="font-serif text-base text-foreground">Create a new assistant</div>
            <div className="text-[11px] text-foreground/50">Pick a template or start from scratch</div>
          </div>
          <div className="w-10 h-10 rounded-2xl border border-primary/20 group-hover:border-primary/40 flex items-center justify-center text-foreground/60 group-hover:text-foreground">
            <Plus className="w-5 h-5" />
          </div>
        </motion.div>
      </motion.div>

      {/* ─────── BOTTOM: connections strip ─────── */}
      <motion.div
        variants={fadeUp}
        className="px-8 py-3 border-t border-primary/10 bg-background/60 flex items-center gap-4 shrink-0"
      >
        <span className="text-[10px] uppercase tracking-wider text-foreground/40">Connected</span>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {[
            { icon: <Mail className="w-3.5 h-3.5" />,      name: 'Gmail',    ok: true },
            { icon: <Calendar className="w-3.5 h-3.5" />,  name: 'Calendar', ok: true },
            { icon: <Hash className="w-3.5 h-3.5" />,      name: 'Slack',    ok: true },
            { icon: <GitBranch className="w-3.5 h-3.5" />, name: 'GitHub',   ok: false },
          ].map((c, i) => (
            <div
              key={i}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] ${
                c.ok
                  ? 'bg-foreground/5 border border-primary/10 text-foreground/80'
                  : 'bg-rose-500/10 border border-rose-500/20 text-rose-200'
              }`}
            >
              {c.icon}
              <span>{c.name}</span>
              {c.ok ? <Check className="w-3 h-3 text-emerald-400/80" /> : <AlertCircle className="w-3 h-3" />}
            </div>
          ))}
          <button className="flex items-center gap-1 px-2.5 py-1 rounded-full border border-dashed border-primary/20 text-[11px] text-foreground/50 hover:text-foreground/80 hover:border-primary/40">
            <Plus className="w-3 h-3" />
            <span>add</span>
          </button>
        </div>
        <span className="text-[11px] text-foreground/50 italic">Settings →</span>
      </motion.div>
    </motion.div>
  );
}
