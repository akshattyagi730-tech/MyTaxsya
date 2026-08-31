import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/services/api';
import PageHeader from '@/components/PageHeader';
import StatCard from '@/components/dashboard/StatCard';
import { Landmark, TrendingUp, TrendingDown, Wallet, Download, FileJson, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { formatINR, formatDate } from '@/utils/format';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { validateGstin } from '@/utils/gstin';

// Only these invoice statuses represent an actually-issued sale — draft and
// cancelled invoices must never contribute to output GST.
const ISSUED_STATUSES = ['sent', 'paid', 'overdue'];

export default function GstCenter() {
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [business, setBusiness] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showSalesDrilldown, setShowSalesDrilldown] = useState(false);
  const [showItcDrilldown, setShowItcDrilldown] = useState(false);

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

  const gstin = useMemo(() => validateGstin(business?.gstin), [business]);
  const gstEnabled = business?.gst_enabled !== false; // defaults true, matching the Business model
  const canExport = gstEnabled && gstin.formatValid;

  const gstData = useMemo(() => {
    // Sales side: only issued invoices count toward output GST. Draft and
    // cancelled invoices are tracked separately purely so the drill-down can
    // show the user why they were excluded.
    const issuedInvoices = invoices.filter(i => ISSUED_STATUSES.includes(i.status));
    const excludedInvoices = invoices.filter(i => !ISSUED_STATUSES.includes(i.status));

    const outputCGST = issuedInvoices.reduce((s, i) => s + (i.cgst || 0), 0);
    const outputSGST = issuedInvoices.reduce((s, i) => s + (i.sgst || 0), 0);
    const outputIGST = issuedInvoices.reduce((s, i) => s + (i.igst || 0), 0);
    const outputTax = outputCGST + outputSGST + outputIGST;

    // ITC side: existing Expense records have no supplier GSTIN, invoice
    // number, or ITC-eligibility review yet (that's a dedicated Purchase
    // Bill workflow, coming in a later phase) — so an "approved" expense
    // with a GST amount is the best available signal today, but it must be
    // labelled as legacy/unverified, not presented as fully vetted ITC.
    const eligibleExpenses = expenses.filter(e => e.status === 'approved' && (e.gst_amount || 0) > 0);
    const excludedExpenses = expenses.filter(e => !(e.status === 'approved' && (e.gst_amount || 0) > 0));
    const inputTax = eligibleExpenses.reduce((s, e) => s + (e.gst_amount || 0), 0);

    const rawNet = outputTax - inputTax;
    const netPayable = Math.max(0, rawNet);
    const itcCarriedForward = rawNet < 0 ? Math.abs(rawNet) : 0;

    return {
      outputCGST, outputSGST, outputIGST, outputTax, inputTax,
      netPayable, itcCarriedForward,
      issuedInvoices, excludedInvoices, eligibleExpenses, excludedExpenses,
    };
  }, [invoices, expenses]);

  const excludedReason = (inv) => inv.status === 'draft' ? 'Draft — not yet issued' : inv.status === 'cancelled' ? 'Cancelled' : `Status: ${inv.status}`;
  const excludedExpenseReason = (e) => {
    if (!(e.gst_amount > 0)) return 'No GST amount recorded';
    if (e.status === 'pending') return 'Awaiting approval';
    if (e.status === 'rejected') return 'Rejected';
    return `Status: ${e.status}`;
  };

  const exportGstr1Json = () => {
    if (!canExport) return;
    const period = `${String(new Date().getMonth() + 1).padStart(2, '0')}${new Date().getFullYear()}`;
    const gstr1 = {
      _disclaimer: 'GST Working Draft — CA review required. This app does not file directly on GSTN.',
      gstin: gstin.gstin,
      ret_period: period,
      form: 'GSTR1',
      outward_supplies: gstData.issuedInvoices.map((inv) => ({
        invoice_number: inv.invoice_number,
        customer_name: inv.customer_name,
        invoice_date: inv.invoice_date,
        status: inv.status,
        total: inv.total,
        cgst: inv.cgst || 0,
        sgst: inv.sgst || 0,
        igst: inv.igst || 0,
      })),
      excluded_invoices: gstData.excludedInvoices.map(inv => ({
        invoice_number: inv.invoice_number, status: inv.status, reason: excludedReason(inv),
      })),
      summary: {
        total_issued_invoices: gstData.issuedInvoices.length,
        total_excluded_invoices: gstData.excludedInvoices.length,
        total_value: gstData.issuedInvoices.reduce((s, i) => s + (i.total || 0), 0),
        total_cgst: gstData.outputCGST,
        total_sgst: gstData.outputSGST,
        total_igst: gstData.outputIGST,
      },
    };
    const blob = new Blob([JSON.stringify(gstr1, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GSTR1_WorkingDraft_${period}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadGstr3bSummary = () => {
    if (!canExport) return;
    const period = new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    const rows = [
      ['GST Working Draft — CA review required. This app does not file directly on GSTN.'],
      ['GSTR-3B Summary', period],
      ['GSTIN', gstin.gstin],
      [''],
      ['Output Tax (CGST)', gstData.outputCGST],
      ['Output Tax (SGST)', gstData.outputSGST],
      ['Output Tax (IGST)', gstData.outputIGST],
      ['Total Output Tax', gstData.outputTax],
      ['Input Tax Credit (legacy/unverified — approved expenses only)', gstData.inputTax],
      ['Net Tax Payable', gstData.netPayable],
      ['ITC Credit Carried Forward', gstData.itcCarriedForward],
      [''],
      ['Source invoices used', gstData.issuedInvoices.length],
      ['Source invoices excluded (draft/cancelled)', gstData.excludedInvoices.length],
      ['Approved expense bills used for ITC', gstData.eligibleExpenses.length],
    ];
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GSTR3B_WorkingDraft_${period.replace(/\s/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className="p-8"><div className="h-64 rounded-xl bg-muted animate-pulse" /></div>;
  if (error) return <div className="p-8 text-center text-muted-foreground">{error}</div>;

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      <PageHeader title="GST Center" subtitle="Manage GST returns and compliance — estimates for CA review, not a filed return" />

      {!gstEnabled ? (
        <div className="bg-muted border border-border rounded-xl p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-muted-foreground shrink-0" />
          <p className="text-sm text-muted-foreground">GST is not enabled for this business, so GST filing/export actions are hidden. Turn it on in Business Settings if this business is GST-registered.</p>
        </div>
      ) : !gstin.formatValid && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
            <p className="text-sm text-destructive font-medium">Add a valid GSTIN in Business Settings before exporting GST data.</p>
          </div>
          <Button size="sm" variant="outline" className="border-destructive/30 text-destructive hover:bg-destructive/10" onClick={() => navigate('/settings')}>
            Go to Settings
          </Button>
        </div>
      )}

      {/* Hero: Net GST Payable — the single number a CA cares about most */}
      <div className="bg-primary text-primary-foreground rounded-xl p-6 shadow-sm flex items-center justify-between flex-wrap gap-4">
        <div>
          <p className="font-heading text-[12px] font-bold uppercase tracking-wider text-primary-foreground/70 mb-1">
            {gstData.itcCarriedForward > 0 ? 'ITC Credit Carried Forward' : 'Net GST Payable (Estimate)'} — {new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
          </p>
          <p className="font-heading text-3xl font-bold">{formatINR(gstData.itcCarriedForward > 0 ? gstData.itcCarriedForward : gstData.netPayable)}</p>
          <p className="text-sm text-primary-foreground/70 mt-1">
            {gstData.itcCarriedForward > 0
              ? 'Your eligible ITC exceeds output tax — this carries forward to next period (not an automatic refund).'
              : 'Estimated, based on issued invoices and approved bills below — confirm with your CA before paying.'}
          </p>
        </div>
        <Wallet className="w-10 h-10 text-primary-foreground/40" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Output Tax (Sales)" value={formatINR(gstData.outputTax)} icon={TrendingUp} accent="blue" subtitle={`From ${gstData.issuedInvoices.length} issued invoices`} />
        <StatCard title="Input Tax (Purchases)" value={formatINR(gstData.inputTax)} icon={TrendingDown} accent="amber" subtitle={`From ${gstData.eligibleExpenses.length} approved bills`} />
        <StatCard title="Net GST Payable" value={formatINR(gstData.itcCarriedForward > 0 ? 0 : gstData.netPayable)} icon={Wallet} accent={gstData.netPayable > 0 ? 'rose' : 'green'} subtitle={gstData.itcCarriedForward > 0 ? 'ITC carried forward instead' : 'Estimate — to be paid'} />
        <StatCard title="Total Invoices" value={invoices.length} icon={Landmark} accent="violet" subtitle={`${gstData.issuedInvoices.length} issued, ${gstData.excludedInvoices.length} excluded`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="font-heading">GSTR-1 Summary (Outward Supplies)</CardTitle></CardHeader>
          <CardContent className="space-y-2.5 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">CGST Collected</span><span className="font-medium">{formatINR(gstData.outputCGST)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">SGST Collected</span><span className="font-medium">{formatINR(gstData.outputSGST)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">IGST Collected</span><span className="font-medium">{formatINR(gstData.outputIGST)}</span></div>
            <div className="flex justify-between border-t border-border pt-2.5"><span className="font-medium">Total Output Tax</span><span className="font-bold">{formatINR(gstData.outputTax)}</span></div>

            <button type="button" onClick={() => setShowSalesDrilldown(v => !v)}
              className="flex items-center gap-1 text-xs text-primary font-medium pt-1">
              {showSalesDrilldown ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {gstData.issuedInvoices.length} invoices included, {gstData.excludedInvoices.length} excluded — show source list
            </button>
            {showSalesDrilldown && (
              <div className="border border-border rounded-lg divide-y divide-border max-h-56 overflow-y-auto text-xs">
                {gstData.issuedInvoices.map(inv => (
                  <div key={inv.id} className="flex justify-between px-3 py-1.5">
                    <span>{inv.invoice_number} <span className="text-secondary">(included — {inv.status})</span></span>
                    <span className="font-medium">{formatINR(inv.total)}</span>
                  </div>
                ))}
                {gstData.excludedInvoices.map(inv => (
                  <div key={inv.id} className="flex justify-between px-3 py-1.5 text-muted-foreground">
                    <span>{inv.invoice_number} <span className="text-destructive">(excluded — {excludedReason(inv)})</span></span>
                    <span>{formatINR(inv.total)}</span>
                  </div>
                ))}
                {invoices.length === 0 && <div className="px-3 py-4 text-center text-muted-foreground">No invoices yet.</div>}
              </div>
            )}

            <Button onClick={exportGstr1Json} variant="outline" className="w-full gap-2 mt-3" disabled={!canExport}>
              <FileJson className="w-4 h-4" /> Export GSTR-1 Working Draft (JSON)
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="font-heading">GSTR-3B Summary (Monthly Return)</CardTitle></CardHeader>
          <CardContent className="space-y-2.5 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Output Tax</span><span className="font-medium">{formatINR(gstData.outputTax)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Input Tax Credit <span className="text-[10px] text-muted-foreground/70">(legacy, unverified)</span></span><span className="font-medium">{formatINR(gstData.inputTax)}</span></div>
            <div className="flex justify-between border-t border-border pt-2.5"><span className="font-medium">Net Tax Payable</span><span className="font-bold text-lg">{formatINR(gstData.netPayable)}</span></div>
            {gstData.itcCarriedForward > 0 && (
              <div className="flex justify-between"><span className="text-muted-foreground">ITC Carried Forward</span><span className="font-medium text-secondary">{formatINR(gstData.itcCarriedForward)}</span></div>
            )}

            <button type="button" onClick={() => setShowItcDrilldown(v => !v)}
              className="flex items-center gap-1 text-xs text-primary font-medium pt-1">
              {showItcDrilldown ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {gstData.eligibleExpenses.length} bills counted as ITC, {gstData.excludedExpenses.length} excluded — show source list
            </button>
            {showItcDrilldown && (
              <div className="border border-border rounded-lg divide-y divide-border max-h-56 overflow-y-auto text-xs">
                {gstData.eligibleExpenses.map(e => (
                  <div key={e.id} className="flex justify-between px-3 py-1.5">
                    <span>{e.title} <span className="text-secondary">(counted — approved)</span></span>
                    <span className="font-medium">{formatINR(e.gst_amount)}</span>
                  </div>
                ))}
                {gstData.excludedExpenses.map(e => (
                  <div key={e.id} className="flex justify-between px-3 py-1.5 text-muted-foreground">
                    <span>{e.title} <span className="text-destructive">(excluded — {excludedExpenseReason(e)})</span></span>
                    <span>{formatINR(e.gst_amount || 0)}</span>
                  </div>
                ))}
                {expenses.length === 0 && <div className="px-3 py-4 text-center text-muted-foreground">No expenses yet.</div>}
              </div>
            )}

            <Button onClick={downloadGstr3bSummary} variant="outline" className="w-full gap-2 mt-3" disabled={!canExport}>
              <Download className="w-4 h-4" /> Download GSTR-3B Working Draft
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
