const statusConfigs = {
  draft: { label: 'Draft', class: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' },
  sent: { label: 'Sent', class: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400' },
  paid: { label: 'Paid', class: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400' },
  overdue: { label: 'Overdue', class: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400' },
  cancelled: { label: 'Cancelled', class: 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500' },
  success: { label: 'Success', class: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400' },
  pending: { label: 'Pending', class: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400' },
  failed: { label: 'Failed', class: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400' },
  approved: { label: 'Approved', class: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400' },
  rejected: { label: 'Rejected', class: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400' },
  active: { label: 'Active', class: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400' },
  inactive: { label: 'Inactive', class: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' },
  info: { label: 'Info', class: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400' },
  warning: { label: 'Warning', class: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400' },
  error: { label: 'Error', class: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400' },
};

export default function StatusBadge({ status }) {
  const config = statusConfigs[status] || { label: status, class: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' };
  return <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${config.class}`}>{config.label}</span>;
}