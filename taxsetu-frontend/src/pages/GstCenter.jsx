import { useEffect, useState, useMemo } from 'react';
import api from '@/services/api';
import PageHeader from '@/components/PageHeader';
import StatCard from '@/components/dashboard/StatCard';
import { Landmark, TrendingUp, TrendingDown, Wallet, Download, FileJson } from 'lucide-react';
import { formatINR } from '@/utils/format';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function GstCenter() {
  const [invoices, setInvoices] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [business, setBusiness] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [invRes, expRes, bizRes] = await Promise.all([
          api.get('/entities/Invoice', { params: { sort: '-created_date', limit: 200 } }),
          api.get('/entities/Expense', { params: { sort: '-created_date', limit: 200 } }),
          api.get('/entities/Business', { params: { sort: '-created_date', limit: 10 } }),
        ]);
        setInvoices(invRes.data);
        setExpenses(expRes.data);
        if (bizRes.data && bizRes.data.length > 0) {
          setBusiness(bizRes.data[0]);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const gstData = useMemo(() => {
    const outputCGST = invoices.reduce((s, i) => s + (i.cgst || 0), 0);
    const outputSGST = invoices.reduce((s, i) => s + (i.sgst || 0), 0);
    const outputIGST = invoices.reduce((s, i) => s + (i.igst || 0), 0);
    const outputTax = outputCGST + outputSGST + outputIGST;
    const inputTax = expenses.reduce((s, e) => s + (e.gst_amount || 0), 0);
    const netPayable = outputTax - inputTax;
    return { outputCGST, outputSGST, outputIGST, outputTax, inputTax, netPayable };
  }, [invoices, expenses]);

  const exportGstr1Json = () => {
    const period = `${String(new Date().getMonth() + 1).padStart(2, '0')}${new Date().getFullYear()}`;
    const gstr1 = {
      gstin: business?.gstin || '27ABCDE1234F1Z5',
      ret_period: period,
      form: 'GSTR1',
      outward_supplies: invoices.map((inv) => ({
        invoice_number: inv.invoice_number,
        customer_name: inv.customer_name,
        invoice_date: inv.invoice_date,
        total: inv.total,
        cgst: inv.cgst || 0,
        sgst: inv.sgst || 0,
        igst: inv.igst || 0,
        status: inv.status,
      })),
      summary: {
        total_invoices: invoices.length,
        total_value: invoices.reduce((s, i) => s + (i.total || 0), 0),
        total_cgst: gstData.outputCGST,
        total_sgst: gstData.outputSGST,
        total_igst: gstData.outputIGST,
      },
    };
    const blob = new Blob([JSON.stringify(gstr1, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GSTR1_${period}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadGstr3bSummary = () => {
    const period = new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    const rows = [
      ['GSTR-3B Summary', period],
      [''],
      ['Output Tax (CGST)', gstData.outputCGST],
      ['Output Tax (SGST)', gstData.outputSGST],
      ['Output Tax (IGST)', gstData.outputIGST],
      ['Total Output Tax', gstData.outputTax],
      ['Input Tax Credit', gstData.inputTax],
      ['Net Tax Payable', gstData.netPayable],
    ];
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GSTR3B_Summary_${period.replace(/\s/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className="p-8"><div className="h-64 rounded-xl bg-muted animate-pulse" /></div>;
  if (error) return <div className="p-8 text-center text-muted-foreground">{error}</div>;

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      <PageHeader title="GST Center" subtitle="Manage GST returns and compliance" />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Output Tax (Sales)" value={formatINR(gstData.outputTax)} icon={TrendingUp} accent="blue" subtitle="GST collected from invoices" />
        <StatCard title="Input Tax (Purchases)" value={formatINR(gstData.inputTax)} icon={TrendingDown} accent="amber" subtitle="GST paid on expenses" />
        <StatCard title="Net GST Payable" value={formatINR(gstData.netPayable)} icon={Wallet} accent={gstData.netPayable > 0 ? 'rose' : 'green'} subtitle={gstData.netPayable > 0 ? 'To be paid' : 'Refund due'} />
        <StatCard title="Total Invoices" value={invoices.length} icon={Landmark} accent="violet" subtitle="GSTR-1 entries" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>GSTR-1 Summary (Outward Supplies)</CardTitle></CardHeader>
          <CardContent className="space-y-2.5 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">CGST Collected</span><span className="font-medium">{formatINR(gstData.outputCGST)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">SGST Collected</span><span className="font-medium">{formatINR(gstData.outputSGST)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">IGST Collected</span><span className="font-medium">{formatINR(gstData.outputIGST)}</span></div>
            <div className="flex justify-between border-t border-border pt-2.5"><span className="font-medium">Total Output Tax</span><span className="font-bold">{formatINR(gstData.outputTax)}</span></div>
            <Button onClick={exportGstr1Json} variant="outline" className="w-full gap-2 mt-3">
              <FileJson className="w-4 h-4" /> Export GSTR-1 (JSON)
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>GSTR-3B Summary (Monthly Return)</CardTitle></CardHeader>
          <CardContent className="space-y-2.5 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Output Tax</span><span className="font-medium">{formatINR(gstData.outputTax)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Input Tax Credit</span><span className="font-medium">{formatINR(gstData.inputTax)}</span></div>
            <div className="flex justify-between border-t border-border pt-2.5"><span className="font-medium">Net Tax Payable</span><span className="font-bold text-lg">{formatINR(gstData.netPayable)}</span></div>
            <Button onClick={downloadGstr3bSummary} variant="outline" className="w-full gap-2 mt-3">
              <Download className="w-4 h-4" /> Download GSTR-3B Summary
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}