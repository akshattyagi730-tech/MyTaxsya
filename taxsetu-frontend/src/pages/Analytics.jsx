import { useEffect, useState, useMemo } from 'react';
import api from '@/services/api';
import PageHeader from '@/components/PageHeader';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatINR, formatINRCompact } from '@/utils/format';

export default function Analytics() {
  const [data, setData] = useState({ invoices: [], expenses: [], customers: [], products: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [invoicesRes, expensesRes, customersRes, productsRes] = await Promise.all([
          api.get('/entities/Invoice', { params: { sort: '-created_date', limit: 200 } }),
          api.get('/entities/Expense', { params: { sort: '-created_date', limit: 200 } }),
          api.get('/entities/Customer', { params: { sort: '-created_date', limit: 200 } }),
          api.get('/entities/Product', { params: { sort: '-created_date', limit: 200 } }),
        ]);
        setData({
          invoices: invoicesRes.data,
          expenses: expensesRes.data,
          customers: customersRes.data,
          products: productsRes.data
        });
      } catch (e) {
        console.error("Analytics load failed:", e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const monthlyData = useMemo(() => {
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthName = d.toLocaleDateString('en-IN', { month: 'short' });
      const revenue = data.invoices.filter(inv => {
        const dt = new Date(inv.invoice_date || inv.created_date);
        return dt.getMonth() === d.getMonth() && dt.getFullYear() === d.getFullYear();
      }).reduce((s, inv) => s + (inv.total || 0), 0);
      const expenses = data.expenses.filter(e => {
        const dt = new Date(e.date || e.created_date);
        return dt.getMonth() === d.getMonth() && dt.getFullYear() === d.getFullYear();
      }).reduce((s, e) => s + (e.amount || 0), 0);
      months.push({ month: monthName, revenue, expenses });
    }
    return months;
  }, [data]);

  const topProducts = useMemo(() => {
    const map = {};
    data.invoices.forEach(inv => {
      inv.items?.forEach(item => {
        map[item.description] = (map[item.description] || 0) + (item.quantity * item.rate);
      });
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([name, value]) => ({ name: name?.slice(0, 20), value }));
  }, [data]);

  const topCustomers = useMemo(() => {
    const map = {};
    data.invoices.forEach(inv => {
      const name = inv.customer_name || 'Unknown';
      map[name] = (map[name] || 0) + (inv.total || 0);
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([name, value]) => ({ name: name?.slice(0, 15), value }));
  }, [data]);

  const trendMax = Math.max(...monthlyData.map(d => Math.max(d.revenue, d.expenses)), 1);
  const productsMax = Math.max(...topProducts.map(d => d.value), 1);
  const customersMax = Math.max(...topCustomers.map(d => d.value), 1);

  if (loading) return <div className="p-8"><div className="h-64 rounded-xl bg-muted animate-pulse" /></div>;

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      <PageHeader title="Analytics" subtitle="Deep insights into your business" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Revenue vs Expenses Trend</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={(v) => formatINRCompact(v)} domain={[0, trendMax * 1.15]} />
                <Tooltip formatter={(v) => formatINR(v)} contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }} />
                <Legend />
                <Line type="monotone" dataKey="revenue" stroke="#6366f1" strokeWidth={2} name="Revenue" />
                <Line type="monotone" dataKey="expenses" stroke="#f43f5e" strokeWidth={2} name="Expenses" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Top Products by Revenue</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={topProducts} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={(v) => formatINRCompact(v)} domain={[0, productsMax * 1.15]} />
                <YAxis type="category" dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} width={120} />
                <Tooltip formatter={(v) => formatINR(v)} contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }} />
                <Bar dataKey="value" fill="#6366f1" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Top Customers by Revenue</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={topCustomers}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={(v) => formatINRCompact(v)} domain={[0, customersMax * 1.15]} />
              <Tooltip formatter={(v) => formatINR(v)} contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }} />
              <Bar dataKey="value" fill="#22c55e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}