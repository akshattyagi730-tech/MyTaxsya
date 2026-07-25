export const formatINR = (amount) => {
  return '₹' + (Number(amount) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
};

export const formatINRCompact = (amount) => {
  const n = Number(amount) || 0;
  if (n >= 10000000) return '₹' + (n / 10000000).toFixed(2).replace(/\.?0+$/, '') + ' Cr';
  if (n >= 100000) return '₹' + (n / 100000).toFixed(2).replace(/\.?0+$/, '') + ' L';
  if (n >= 1000) return '₹' + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return '₹' + n.toLocaleString('en-IN');
};

export const formatDate = (dateStr) => {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};