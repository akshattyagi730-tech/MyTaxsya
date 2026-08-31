import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

// Maps the existing accent prop values onto the Taxsya design system's
// semantic tokens (primary/secondary/accent/destructive), so every card
// stays within the brand palette and adapts automatically in dark mode.
const accentStyles = {
  blue: { icon: 'text-primary', dot: 'bg-primary/5' },
  indigo: { icon: 'text-primary', dot: 'bg-primary/5' },
  green: { icon: 'text-secondary', dot: 'bg-secondary/5' },
  violet: { icon: 'text-secondary', dot: 'bg-secondary/5' },
  amber: { icon: 'text-accent', dot: 'bg-accent/5' },
  rose: { icon: 'text-destructive', dot: 'bg-destructive/5' },
};

export default function StatCard({ title, value, icon: Icon, change, trend = 'up', accent = 'blue', subtitle }) {
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  const trendColor = trend === 'up' ? 'text-secondary' : trend === 'down' ? 'text-destructive' : 'text-muted-foreground';
  const { icon: iconColor, dot: dotColor } = accentStyles[accent] || accentStyles.blue;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="relative overflow-hidden rounded-xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md group"
    >
      <div className={`absolute -right-4 -top-4 w-24 h-24 rounded-full transition-transform group-hover:scale-110 ${dotColor}`} />
      <div className="relative z-10">
        <div className={`flex items-center gap-2 mb-2.5 ${iconColor}`}>
          <Icon className="w-[18px] h-[18px]" />
          <span className="font-heading text-[12px] font-bold uppercase tracking-wider text-muted-foreground">{title}</span>
        </div>
        <p className="font-heading text-2xl font-semibold tracking-tight text-foreground mb-1">{value}</p>
        <div className="flex items-center justify-between">
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          {change !== undefined && (
            <div className={`flex items-center gap-1 text-xs font-medium ${trendColor} ml-auto`}>
              <TrendIcon className="w-3.5 h-3.5" />
              {change}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
