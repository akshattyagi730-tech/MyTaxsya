import { useEffect, useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import api from '@/services/api';
import {
  Wallet, AlertCircle, Landmark, TrendingDown, Plus, FileText,
  ShoppingBag, Boxes, TrendingUp,
  ClipboardList, Package, RefreshCw
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import StatCard from '@/components/dashboard/StatCard';
import { formatINR, formatINRCompact, formatDate } from '@/utils/format';
import { Button } from '@/components/ui/button';

const statusStyles = {
  draft: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  sent: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
  paid: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  overdue: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400',
  cancelled: 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500',
  success: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  pending: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  failed: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400',
  approved: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  rejected: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400',
};

// Period-over-period change: current calendar month vs previous calendar month,
// applied the same way to every dashboard card's trend badge.
const computeTrend = (current, previous) => {
  if (previous === 0 && current === 0) return { change: '—', trend: 'neutral' };
  if (previous === 0 && current > 0) return { change: '+100%', trend: 'up' };
  if (previous > 0 && current === 0) return { change: '-100%', trend: 'down' };
  const pct = ((current - previous) / previous) * 100;
  if (pct > 0) return { change: `+${pct.toFixed(1)}%`, trend: 'up' };
  if (pct < 0) return { change: `${pct.toFixed(1)}%`, trend: 'down' };
  return { change: '0%', trend: 'neutral' };
};

export default function Dashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState({ invoices: [], customers: [], products: [], expenses: [], payments: [] });
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    try {
      const [invoicesRes, customersRes, productsRes, expensesRes, paymentsRes] = await Promise.all([
        api.get('/entities/Invoice', { params: { sort: '-created_date', limit: 200 } }),
        api.get('/entities/Customer', { params: { sort: '-created_date', limit: 200 } }),
        api.get('/entities/Product', { params: { sort: '-created_date', limit: 200 } }),
        api.get('/entities/Expense', { params: { sort: '-created_date', limit: 200 } }),
        api.get('/entities/Payment', { params: { sort: '-created_date', limit: 200 } }),
      ]);
      setData({
        invoices: invoicesRes.data,
        customers: customersRes.data,
        products: productsRes.data,
        expenses: expensesRes.data,
        payments: paymentsRes.data
      });
    } catch (e) {
      console.error("Dashboard data load failed:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const metrics = useMemo(() => {
    const invoices = data.invoices || [];
    const expenses = data.expenses || [];
    const payments = data.payments || [];
    const products = data.products || [];

    // Active billing (Accrual Sales)
    const sales = invoices
      .filter((i) => i.status !== 'cancelled' && i.status !== 'draft')
      .reduce((s, i) => s + (i.total || 0), 0);

    // Revenue (Actual cash collections from successful payments)
    const revenue = payments
      .filter((p) => p.status === 'success')
      .reduce((s, p) => s + (p.amount || 0), 0);

    // Purchases (Raw materials costs or utility purchases)
    const purchases = expenses
      .filter((e) => e.category === 'raw_materials' || e.category === 'office_supplies')
      .reduce((s, e) => s + (e.amount || 0), 0);

    const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);

    const gstCollected = invoices
      .filter((i) => i.status !== 'cancelled' && i.status !== 'draft')
      .reduce((s, i) => s + (i.cgst || 0) + (i.sgst || 0) + (i.igst || 0), 0);

    const gstPaid = expenses.reduce((s, e) => s + (e.gst_amount || 0), 0);
    const gstPayable = Math.max(0, gstCollected - gstPaid);

    const pendingPayments = invoices
      .filter((i) => i.status === 'sent' || i.status === 'overdue')
      .reduce((s, i) => s + (i.balance_due || i.total || 0), 0);

    const inventoryValue = products.reduce((s, p) => s + (p.stock_quantity * p.purchase_price), 0);

    // Profit & Loss calculation
    const netEarnings = sales - totalExpenses;
    const profit = netEarnings > 0 ? netEarnings : 0;
    const loss = netEarnings < 0 ? Math.abs(netEarnings) : 0;

    // Today's, Monthly, Yearly Sales
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();

    const todaySales = invoices
      .filter((i) => i.status !== 'cancelled' && i.status !== 'draft' && formatDate(i.invoice_date || i.created_date) === formatDate(todayStr))
      .reduce((s, i) => s + (i.total || 0), 0);

    const monthlySales = invoices
      .filter((i) => {
        const d = new Date(i.invoice_date || i.created_date);
        return i.status !== 'cancelled' && i.status !== 'draft' && d.getMonth() === thisMonth && d.getFullYear() === thisYear;
      })
      .reduce((s, i) => s + (i.total || 0), 0);

    const yearlySales = invoices
      .filter((i) => {
        const d = new Date(i.invoice_date || i.created_date);
        return i.status !== 'cancelled' && i.status !== 'draft' && d.getFullYear() === thisYear;
      })
      .reduce((s, i) => s + (i.total || 0), 0);

    return {
      sales, revenue, purchases, expenses: totalExpenses, gstCollected, gstPayable, pendingPayments,
      inventoryValue, profit, loss, todaySales, monthlySales, yearlySales
    };
  }, [data]);

  // Calculate Growth percentages
  const growth = useMemo(() => {
    const invoices = data.invoices || [];
    const expenses = data.expenses || [];
    const payments = data.payments || [];
    const now = new Date();
    const thisM = now.getMonth(), thisY = now.getFullYear();
    const prevD = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevM = prevD.getMonth(), prevY = prevD.getFullYear();

    const inMonth = (dateStr, m, y) => {
      const d = new Date(dateStr);
      return d.getMonth() === m && d.getFullYear() === y;
    };

    const getSales = (m, y) => invoices.filter(i => i.status !== 'cancelled' && i.status !== 'draft' && inMonth(i.invoice_date || i.created_date, m, y)).reduce((s, i) => s + (i.total || 0), 0);
    const getExpenses = (m, y) => expenses.filter(e => inMonth(e.date || e.created_date, m, y)).reduce((s, e) => s + (e.amount || 0), 0);
    const getRevenue = (m, y) => payments.filter(p => p.status === 'success' && inMonth(p.date || p.created_date, m, y)).reduce((s, p) => s + (p.amount || 0), 0);
    const getGstCollected = (m, y) => invoices.filter(i => i.status !== 'cancelled' && i.status !== 'draft' && inMonth(i.invoice_date || i.created_date, m, y)).reduce((s, i) => s + (i.cgst || 0) + (i.sgst || 0) + (i.igst || 0), 0);
    const getGstPaid = (m, y) => expenses.filter(e => inMonth(e.date || e.created_date, m, y)).reduce((s, e) => s + (e.gst_amount || 0), 0);
    const getGstPayable = (m, y) => Math.max(0, getGstCollected(m, y) - getGstPaid(m, y));
    // Pending Collections is a running balance (currently-outstanding invoices), which
    // has no natural "period" of its own — scope it to invoices that became due/pending
    // within each month, so the trend reflects new receivables created that month.
    const getPending = (m, y) => invoices.filter(i => (i.status === 'sent' || i.status === 'overdue') && inMonth(i.invoice_date || i.created_date, m, y)).reduce((s, i) => s + (i.balance_due || i.total || 0), 0);
    const getProfit = (m, y) => Math.max(0, getSales(m, y) - getExpenses(m, y));
    const getLoss = (m, y) => Math.max(0, getExpenses(m, y) - getSales(m, y));

    const currentSales = getSales(thisM, thisY);
    const previousSales = getSales(prevM, prevY);

    const currentExp = getExpenses(thisM, thisY);
    const previousExp = getExpenses(prevM, prevY);

    return {
      salesTrend: computeTrend(currentSales, previousSales),
      expensesTrend: computeTrend(currentExp, previousExp),
      revenueTrend: computeTrend(getRevenue(thisM, thisY), getRevenue(prevM, prevY)),
      profitTrend: computeTrend(getProfit(thisM, thisY), getProfit(prevM, prevY)),
      lossTrend: computeTrend(getLoss(thisM, thisY), getLoss(prevM, prevY)),
      pendingTrend: computeTrend(getPending(thisM, thisY), getPending(prevM, prevY)),
      gstCollectedTrend: computeTrend(getGstCollected(thisM, thisY), getGstCollected(prevM, prevY)),
      gstPayableTrend: computeTrend(getGstPayable(thisM, thisY), getGstPayable(prevM, prevY)),
      salesDiff: { current: currentSales, previous: previousSales },
      expensesDiff: { current: currentExp, previous: previousExp }
    };
  }, [data]);

  const monthlyRevenue = useMemo(() => {
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthName = d.toLocaleDateString('en-IN', { month: 'short' });
      const salesVal = (data.invoices || [])
        .filter((inv) => {
          const invDate = new Date(inv.invoice_date || inv.created_date);
          return inv.status !== 'cancelled' && inv.status !== 'draft' && invDate.getMonth() === d.getMonth() && invDate.getFullYear() === d.getFullYear();
        })
        .reduce((sum, inv) => sum + (inv.total || 0), 0);
      const expensesVal = (data.expenses || [])
        .filter((e) => {
          const eDate = new Date(e.date || e.created_date);
          return eDate.getMonth() === d.getMonth() && eDate.getFullYear() === d.getFullYear();
        })
        .reduce((sum, e) => sum + (e.amount || 0), 0);
      months.push({ month: monthName, sales: salesVal, expenses: expensesVal });
    }
    return months;
  }, [data]);

  const gstBreakdown = useMemo(() => {
    const invoices = data.invoices || [];
    const cgst = invoices.reduce((s, i) => s + (i.cgst || 0), 0);
    const sgst = invoices.reduce((s, i) => s + (i.sgst || 0), 0);
    const igst = invoices.reduce((s, i) => s + (i.igst || 0), 0);
    return [
      { name: 'CGST', value: cgst, color: '#6366f1' },
      { name: 'SGST', value: sgst, color: '#22c55e' },
      { name: 'IGST', value: igst, color: '#f59e0b' },
    ].filter((d) => d.value > 0);
  }, [data]);

  const recentTransactions = useMemo(() => {
    const txs = [
      ...(data.invoices || []).map(i => ({ id: i.id, date: i.invoice_date || i.created_date, desc: `Invoice ${i.invoice_number}`, type: 'sales', amount: i.total, status: i.status, route: `/invoices/${i.id}` })),
      ...(data.payments || []).map(p => ({ id: p.id, date: p.date || p.created_date, desc: `Payment ${p.payment_number}`, type: 'payment', amount: p.amount, status: p.status, route: `/payments/${p.id}` })),
      ...(data.expenses || []).map(e => ({ id: e.id, date: e.date || e.created_date, desc: `Expense: ${e.title}`, type: 'expense', amount: e.amount, status: e.status, route: `/expenses/${e.id}` }))
    ];
    txs.sort((a, b) => new Date(b.date) - new Date(a.date));
    return txs.slice(0, 6);
  }, [data]);

  const topCustomers = useMemo(() => {
    const map = {};
    (data.invoices || []).forEach((inv) => {
      if (inv.status !== 'cancelled' && inv.status !== 'draft') {
        const name = inv.customer_name || 'Unknown';
        map[name] = (map[name] || 0) + (inv.total || 0);
      }
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [data]);

  const topProducts = useMemo(() => {
    const map = {};
    (data.invoices || []).forEach((inv) => {
      if (inv.status !== 'cancelled' && inv.status !== 'draft') {
        inv.items?.forEach((item) => {
          const name = item.description || 'Unknown Product';
          map[name] = (map[name] || 0) + (item.quantity * item.rate);
        });
      }
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [data]);

  if (loading) {
    return (
      <div className="space-y-6 max-w-[1400px] mx-auto">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => <div key={i} className="h-28 rounded-xl bg-muted animate-pulse" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 h-80 rounded-xl bg-muted animate-pulse" />
          <div className="h-80 rounded-xl bg-muted animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto pb-10">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={loadData} title="Refresh dashboard">
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Button className="gap-2" onClick={() => navigate('/invoices')}>
            <Plus className="w-4 h-4" /> Create Invoice
          </Button>
        </div>
      </div>

      {/* Grid Row 1: Sales / Expenses Overview */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Sales" value={formatINR(metrics.sales)} icon={ShoppingBag} change={growth.salesTrend.change} trend={growth.salesTrend.trend} accent="blue" subtitle="Accrual turnover" />
        <StatCard title="Total Expenses" value={formatINR(metrics.expenses)} icon={TrendingDown} change={growth.expensesTrend.change} trend={growth.expensesTrend.trend} accent="rose" subtitle="Operational expenses" />
        <StatCard title="Net Profit" value={formatINR(metrics.profit)} icon={TrendingUp} change={growth.profitTrend.change} trend={growth.profitTrend.trend} accent="green" subtitle="Sales minus expenses" />
        <StatCard title="Net Loss" value={formatINR(metrics.loss)} icon={AlertCircle} change={growth.lossTrend.change} trend={growth.lossTrend.trend} accent="rose" subtitle="Expenses minus sales" />
      </div>

      {/* Grid Row 2: Cash Collection & Tax */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Cash Revenue" value={formatINR(metrics.revenue)} icon={Wallet} change={growth.revenueTrend.change} trend={growth.revenueTrend.trend} accent="green" subtitle="Successful payments" />
        <StatCard title="Pending Collections" value={formatINR(metrics.pendingPayments)} icon={AlertCircle} change={growth.pendingTrend.change} trend={growth.pendingTrend.trend} accent="amber" subtitle="Awaiting payments" />
        <StatCard title="GST Collected" value={formatINR(metrics.gstCollected)} icon={Landmark} change={growth.gstCollectedTrend.change} trend={growth.gstCollectedTrend.trend} accent="violet" subtitle="Tax from bills" />
        <StatCard title="GST Payable" value={formatINR(metrics.gstPayable)} icon={ClipboardList} change={growth.gstPayableTrend.change} trend={growth.gstPayableTrend.trend} accent="indigo" subtitle="Output tax minus ITC" />
      </div>

      {/* Grid Row 3: Live Sales Windows & Stock */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Today's Sales" value={formatINR(metrics.todaySales)} icon={ShoppingBag} change="24 Hours" trend="neutral" accent="blue" />
        <StatCard title="Monthly Sales" value={formatINR(metrics.monthlySales)} icon={ShoppingBag} change="This Month" trend="up" accent="indigo" />
        <StatCard title="Yearly Sales" value={formatINR(metrics.yearlySales)} icon={ShoppingBag} change="This Year" trend="up" accent="violet" />
        <StatCard title="Inventory Value" value={formatINR(metrics.inventoryValue)} icon={Boxes} change="Asset Value" trend="neutral" accent="green" subtitle="Stock valuation" />
      </div>

      {/* Chart Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="lg:col-span-2 bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold text-lg">Sales vs Expenses Trend</h2>
              <p className="text-sm text-muted-foreground">Monthly analytics</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={monthlyRevenue}>
              <defs>
                <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="expGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#f43f5e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => formatINRCompact(v)} />
              <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 13 }} formatter={(v) => formatINR(v)} />
              <Area type="monotone" dataKey="sales" stroke="#6366f1" strokeWidth={2} fill="url(#salesGrad)" name="Sales Billing" />
              <Area type="monotone" dataKey="expenses" stroke="#f43f5e" strokeWidth={2} fill="url(#expGrad)" name="Expenses" />
            </AreaChart>
          </ResponsiveContainer>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="bg-card border border-border rounded-xl p-5">
          <h2 className="font-semibold text-lg mb-1">GST Breakdown</h2>
          <p className="text-sm text-muted-foreground mb-4">Tax collected by type</p>
          {gstBreakdown.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={gstBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={3}>
                  {gstBreakdown.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip formatter={(v) => formatINR(v)} contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 13 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">No GST data yet</div>
          )}
          <div className="space-y-2 mt-2">
            {gstBreakdown.map((d) => (
              <div key={d.name} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />
                  {d.name}
                </span>
                <span className="font-medium">{formatINR(d.value)}</span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Grid Row 4: Recent Transactions vs Rankings */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Transactions */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
          className="lg:col-span-2 bg-card border border-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between p-5 pb-4">
            <h2 className="font-semibold text-lg">Recent Transactions</h2>
            <Button variant="ghost" size="sm" className="text-sm" onClick={() => navigate('/ledger')}>View ledger</Button>
          </div>
          {recentTransactions.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-y border-border bg-muted/30">
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-5 py-2.5">Date</th>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-5 py-2.5">Description</th>
                    <th className="text-center text-xs font-medium text-muted-foreground uppercase tracking-wider px-5 py-2.5">Type</th>
                    <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wider px-5 py-2.5">Amount</th>
                    <th className="text-center text-xs font-medium text-muted-foreground uppercase tracking-wider px-5 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentTransactions.map((tx, idx) => (
                    <tr key={idx} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => navigate(tx.route)}>
                      <td className="px-5 py-3 text-sm text-muted-foreground">{formatDate(tx.date)}</td>
                      <td className="px-5 py-3 text-sm font-medium">{tx.desc}</td>
                      <td className="px-5 py-3 text-sm text-center capitalize">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${tx.type === 'sales' ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/20' :
                            tx.type === 'payment' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20' :
                              'bg-rose-50 text-rose-700 dark:bg-rose-950/20'
                          }`}>
                          {tx.type}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-sm font-medium text-right">{formatINR(tx.amount)}</td>
                      <td className="px-5 py-3 text-center">
                        <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${statusStyles[tx.status] || statusStyles.draft}`}>
                          {tx.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-12 text-center">
              <FileText className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No transactions yet.</p>
            </div>
          )}
        </motion.div>

        {/* Top Rankings */}
        <div className="space-y-6">
          {/* Top Customers */}
          {topCustomers.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
              className="bg-card border border-border rounded-xl p-5">
              <h2 className="font-semibold text-lg mb-4">Top Customers</h2>
              <div className="space-y-3">
                {topCustomers.map(([name, amount], i) => (
                  <div key={name} className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white text-xs font-medium">
                      {name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{name}</p>
                      <p className="text-xs text-muted-foreground">{formatINR(amount)}</p>
                    </div>
                    <span className="text-xs text-muted-foreground">#{i + 1}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Top Products */}
          {topProducts.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
              className="bg-card border border-border rounded-xl p-5">
              <h2 className="font-semibold text-lg mb-4">Top Products</h2>
              <div className="space-y-3">
                {topProducts.map(([name, amount], i) => (
                  <div key={name} className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white text-xs font-medium">
                      <Package className="w-4 h-4 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{name}</p>
                      <p className="text-xs text-muted-foreground">{formatINR(amount)}</p>
                    </div>
                    <span className="text-xs text-muted-foreground">#{i + 1}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}