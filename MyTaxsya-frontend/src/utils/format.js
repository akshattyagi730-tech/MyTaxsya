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

  let str = String(dateStr).trim();
  if (!str || ["null", "undefined", "n/a"].includes(str.toLowerCase())) return '—';

  // Check DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const ddmmyyyy = /^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/.exec(str);
  if (ddmmyyyy) {
    const day = parseInt(ddmmyyyy[1], 10);
    const month = parseInt(ddmmyyyy[2], 10);
    const year = parseInt(ddmmyyyy[3], 10);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const dStr = String(day).padStart(2, '0');
      return `${dStr} ${months[month - 1]} ${year}`;
    }
  }

  const d = new Date(str);
  if (isNaN(d.getTime())) return str;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};