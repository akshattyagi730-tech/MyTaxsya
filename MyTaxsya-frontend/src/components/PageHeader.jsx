export default function PageHeader({ title, subtitle, children = null }) {
  return (
    <div
      className="relative overflow-hidden rounded-3xl border border-border p-6 sm:p-8 flex items-center justify-between flex-wrap gap-4 mb-6"
      style={{ background: 'linear-gradient(120deg, hsl(var(--accent) / 0.14), hsl(var(--background)))' }}
    >
      <div aria-hidden className="pointer-events-none absolute -right-10 -top-16 w-48 h-48 rounded-full bg-accent/10" />
      <div aria-hidden className="pointer-events-none absolute right-20 -bottom-16 w-36 h-36 rounded-full bg-secondary/10" />

      <div className="relative z-10">
        <h1 className="font-heading text-2xl font-extrabold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      {children && <div className="relative z-10 flex items-center gap-2">{children}</div>}
    </div>
  );
}
