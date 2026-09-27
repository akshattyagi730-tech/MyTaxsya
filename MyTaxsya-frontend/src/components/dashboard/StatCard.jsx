import { motion, useMotionValue, useTransform, useMotionTemplate } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

// Maps the existing accent prop values onto the Taxsya design system's
// semantic tokens (primary/secondary/accent/destructive), so every card
// stays within the brand palette and adapts automatically in dark mode.
// `glow` is the same token as a raw CSS var reference, for the cursor
// spotlight below (which needs a real color, not a Tailwind class).
const accentStyles = {
  blue: { text: 'text-primary', stroke: 'stroke-primary', track: 'stroke-primary/15', glow: '--primary' },
  indigo: { text: 'text-primary', stroke: 'stroke-primary', track: 'stroke-primary/15', glow: '--primary' },
  green: { text: 'text-secondary', stroke: 'stroke-secondary', track: 'stroke-secondary/15', glow: '--secondary' },
  violet: { text: 'text-secondary', stroke: 'stroke-secondary', track: 'stroke-secondary/15', glow: '--secondary' },
  amber: { text: 'text-accent', stroke: 'stroke-accent', track: 'stroke-accent/15', glow: '--accent' },
  rose: { text: 'text-destructive', stroke: 'stroke-destructive', track: 'stroke-destructive/15', glow: '--destructive' },
};

export default function StatCard({ title, value, icon: Icon, change, trend = 'up', accent = 'blue', subtitle }) {
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  const trendColor = trend === 'up' ? 'text-secondary' : trend === 'down' ? 'text-destructive' : 'text-muted-foreground';
  const { text: iconColor, stroke, track, glow } = accentStyles[accent] || accentStyles.blue;

  // Pointer position inside the card, normalized to -0.5..0.5, drives a
  // subtle 3D tilt and a spotlight that follows the cursor.
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const rotateX = useTransform(mouseY, [-0.5, 0.5], [8, -8]);
  const rotateY = useTransform(mouseX, [-0.5, 0.5], [-8, 8]);
  const spotX = useTransform(mouseX, (v) => `${(v + 0.5) * 100}%`);
  const spotY = useTransform(mouseY, (v) => `${(v + 0.5) * 100}%`);
  const spotlight = useMotionTemplate`radial-gradient(180px circle at ${spotX} ${spotY}, hsl(var(${glow}) / 0.16), transparent 70%)`;

  const handleMouseMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    mouseX.set((e.clientX - rect.left) / rect.width - 0.5);
    mouseY.set((e.clientY - rect.top) / rect.height - 0.5);
  };
  const handleMouseLeave = () => {
    mouseX.set(0);
    mouseY.set(0);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      whileHover={{ scale: 1.025, y: -6, boxShadow: '0 16px 30px -10px hsl(var(--foreground) / 0.2)' }}
      whileTap={{ scale: 0.98 }}
      style={{ rotateX, rotateY, transformPerspective: 700 }}
      className="group relative flex items-center gap-3.5 rounded-xl border border-border bg-card p-4 shadow-sm overflow-hidden cursor-default [transform-style:preserve-3d]"
    >
      <motion.div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: spotlight }} />

      <motion.div
        whileHover={{ scale: 1.1, rotate: 6 }}
        transition={{ type: 'spring', stiffness: 300, damping: 14 }}
        className="relative z-10 w-[52px] h-[52px] shrink-0"
        style={{ transform: 'translateZ(24px)' }}
      >
        <svg viewBox="0 0 52 52" className="w-full h-full -rotate-90">
          <circle cx="26" cy="26" r="22" fill="none" strokeWidth="4" className={track} />
          <motion.circle
            cx="26" cy="26" r="22" fill="none" strokeWidth="4" strokeLinecap="round"
            className={stroke}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 0.78 }}
            whileHover={{ pathLength: 1 }}
            transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
          />
        </svg>
        <div className={`absolute inset-0 flex items-center justify-center ${iconColor}`}>
          <Icon className="w-[18px] h-[18px]" />
        </div>
      </motion.div>

      <div className="relative z-10 min-w-0 flex-1" style={{ transform: 'translateZ(14px)' }}>
        <p className="font-heading text-[11px] font-bold uppercase tracking-wider text-muted-foreground truncate">{title}</p>
        <p className="font-heading text-xl font-extrabold tracking-tight text-foreground mt-0.5">{value}</p>
        <div className="flex items-center justify-between mt-0.5 gap-2">
          {subtitle && <p className="text-xs text-muted-foreground truncate">{subtitle}</p>}
          {change !== undefined && (
            <div className={`flex items-center gap-1 text-xs font-medium ${trendColor} ml-auto shrink-0`}>
              <TrendIcon className="w-3.5 h-3.5" />
              {change}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
