export default function PageHeader({ title, subtitle, children = null }) {
  return (
    <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}