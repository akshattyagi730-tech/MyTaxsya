const statusConfigs = {
  draft: { label: 'Draft', class: 'bg-muted text-muted-foreground' },
  sent: { label: 'Sent', class: 'bg-primary/10 text-primary' },
  paid: { label: 'Paid', class: 'bg-secondary/10 text-secondary' },
  overdue: { label: 'Overdue', class: 'bg-destructive/10 text-destructive' },
  cancelled: { label: 'Cancelled', class: 'bg-muted text-muted-foreground/70' },
  success: { label: 'Success', class: 'bg-secondary/10 text-secondary' },
  pending: { label: 'Pending', class: 'bg-accent/10 text-accent' },
  failed: { label: 'Failed', class: 'bg-destructive/10 text-destructive' },
  approved: { label: 'Approved', class: 'bg-secondary/10 text-secondary' },
  rejected: { label: 'Rejected', class: 'bg-destructive/10 text-destructive' },
  active: { label: 'Active', class: 'bg-secondary/10 text-secondary' },
  inactive: { label: 'Inactive', class: 'bg-muted text-muted-foreground' },
  recorded: { label: 'Recorded', class: 'bg-secondary/10 text-secondary' },
  unpaid: { label: 'Unpaid', class: 'bg-destructive/10 text-destructive' },
  partial: { label: 'Partial', class: 'bg-accent/10 text-accent' },
  info: { label: 'Info', class: 'bg-primary/10 text-primary' },
  warning: { label: 'Warning', class: 'bg-accent/10 text-accent' },
  error: { label: 'Error', class: 'bg-destructive/10 text-destructive' },
};

export default function StatusBadge({ status }) {
  const config = statusConfigs[status] || { label: status, class: 'bg-muted text-muted-foreground' };
  return <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${config.class}`}>{config.label}</span>;
}
