import { useEffect, useState, useMemo } from 'react';
import api from '@/services/api';
import PageHeader from '@/components/PageHeader';
import StatCard from '@/components/dashboard/StatCard';
import { jsPDF } from 'jspdf';
import {
  TrendingUp, TrendingDown, Wallet, FileText, Download,
  BarChart3, Receipt, Users, Truck, Boxes, Landmark, RefreshCw
} from 'lucide-react';
import { formatINR, formatDate } from '@/utils/format';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function Reports() {
  const [data, setData] = useState({
    invoices: [],
    expenses: [],
    payments: [],
    customers: [],
    suppliers: [],
    products: []
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeReport, setActiveReport] = useState('pnl');

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [invoicesRes, expensesRes, paymentsRes, customersRes, suppliersRes, productsRes] = await Promise.all([
        api.get('/entities/Invoice', { params: { sort: '-created_date', limit: 200 } }),
        api.get('/entities/Expense', { params: { sort: '-created_date', limit: 200 } }),
        api.get('/entities/Payment', { params: { sort: '-created_date', limit: 200 } }),
        api.get('/entities/Customer', { params: { limit: 200 } }),
        api.get('/entities/Supplier', { params: { limit: 200 } }),
        api.get('/entities/Product', { params: { limit: 200 } }),
      ]);
      setData({
        invoices: invoicesRes.data,
        expenses: expensesRes.data,
        payments: paymentsRes.data,
        customers: customersRes.data,
        suppliers: suppliersRes.data,
        products: productsRes.data
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const reportTabs = [
    { id: 'pnl', label: 'Profit & Loss', icon: TrendingUp },
    { id: 'cashflow', label: 'Cash Flow', icon: Wallet },
    { id: 'gst', label: 'GST Report', icon: Landmark },
    { id: 'sales', label: 'Sales Report', icon: FileText },
    { id: 'purchase', label: 'Purchase Report', icon: Truck },
    { id: 'expense', label: 'Expense Report', icon: Receipt },
    { id: 'customer', label: 'Customer Balances', icon: Users },
    { id: 'supplier', label: 'Supplier Balances', icon: Truck },
    { id: 'inventory', label: 'Inventory Valuation', icon: Boxes },
    { id: 'ledger', label: 'General Ledger', icon: BarChart3 },
  ];

  // Helper to compile report data
  const reportPayload = useMemo(() => {
    const { invoices, expenses, payments, customers, suppliers, products } = data;

    // 1. Profit & Loss
    const salesTotal = invoices.filter(i => i.status !== 'cancelled' && i.status !== 'draft').reduce((s, i) => s + (i.subtotal || 0), 0);
    const purchaseCost = expenses.filter(e => e.category === 'raw_materials').reduce((s, e) => s + (e.amount - e.gst_amount || 0), 0);
    const grossProfit = salesTotal - purchaseCost;

    // Operating expenses categories
    const categories = ["rent", "salaries", "utilities", "marketing", "travel", "office_supplies", "software", "professional_fees", "logistics", "other"];
    const opExpensesList = categories.map(cat => {
      // Exclude raw_materials since it is in cost of sales
      const amt = expenses.filter(e => e.category === cat).reduce((s, e) => s + (e.amount - e.gst_amount || 0), 0);
      return { category: cat.replace('_', ' '), amount: amt };
    });
    const totalOpExpenses = opExpensesList.reduce((s, o) => s + o.amount, 0);
    const netProfit = grossProfit - totalOpExpenses;

    const pnlRows = [
      ['Sales Revenue (A)', formatINR(salesTotal)],
      ['Cost of Goods Sold (Purchases) (B)', formatINR(purchaseCost)],
      ['Gross Profit (A - B)', formatINR(grossProfit)],
      ...opExpensesList.map(o => [`Operating Expense: ${o.category}`, formatINR(o.amount)]),
      ['Total Operating Expenses (C)', formatINR(totalOpExpenses)],
      ['Net Profit / Loss', formatINR(netProfit)]
    ];

    // 2. Cash Flow
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthLabel = d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
      const inflow = payments.filter(p => {
        const dt = new Date(p.date || p.created_date);
        return p.status === 'success' && dt.getMonth() === d.getMonth() && dt.getFullYear() === d.getFullYear();
      }).reduce((s, p) => s + p.amount, 0);

      const outflow = expenses.filter(e => {
        const dt = new Date(e.date || e.created_date);
        return dt.getMonth() === d.getMonth() && dt.getFullYear() === d.getFullYear();
      }).reduce((s, e) => s + e.amount, 0);

      months.push({
        month: monthLabel,
        inflow,
        outflow,
        net: inflow - outflow
      });
    }

    const cashFlowRows = months.map(m => [m.month, formatINR(m.inflow), formatINR(m.outflow), formatINR(m.net)]);

    // 3. GST Report
    const outputCGST = invoices.filter(i => i.status !== 'cancelled' && i.status !== 'draft').reduce((s, i) => s + (i.cgst || 0), 0);
    const outputSGST = invoices.filter(i => i.status !== 'cancelled' && i.status !== 'draft').reduce((s, i) => s + (i.sgst || 0), 0);
    const outputIGST = invoices.filter(i => i.status !== 'cancelled' && i.status !== 'draft').reduce((s, i) => s + (i.igst || 0), 0);
    const totalOutput = outputCGST + outputSGST + outputIGST;
    const totalITC = expenses.reduce((s, e) => s + (e.gst_amount || 0), 0);
    const netGstPayable = totalOutput - totalITC;

    const gstRows = [
      ['CGST (Central Tax)', formatINR(outputCGST), formatINR(outputCGST / 2), formatINR(outputCGST - (outputCGST / 2))],
      ['SGST (State Tax)', formatINR(outputSGST), formatINR(outputSGST / 2), formatINR(outputSGST - (outputSGST / 2))],
      ['IGST (Integrated Tax)', formatINR(outputIGST), formatINR(totalITC), formatINR(outputIGST - totalITC)],
      ['Total GST compliance', formatINR(totalOutput), formatINR(totalITC), formatINR(netGstPayable)]
    ];

    // 4. Sales Report
    const activeInvoices = invoices.filter(i => i.status !== 'cancelled' && i.status !== 'draft');
    const salesRows = activeInvoices.map(i => [
      i.invoice_number,
      i.customer_name || '—',
      formatDate(i.invoice_date || i.created_date),
      formatINR(i.subtotal),
      formatINR((i.cgst || 0) + (i.sgst || 0) + (i.igst || 0)),
      formatINR(i.total),
      i.status.toUpperCase()
    ]);

    // 5. Purchase Report
    const purchaseExpenses = expenses.filter(e => e.category === 'raw_materials' || e.category === 'office_supplies');
    const purchaseRows = purchaseExpenses.map(e => [
      e.vendor || '—',
      e.category.replace('_', ' ').toUpperCase(),
      formatDate(e.date || e.created_date),
      formatINR(e.amount - e.gst_amount),
      formatINR(e.gst_amount),
      formatINR(e.amount),
      e.status.toUpperCase()
    ]);

    // 6. Expense Report
    const expenseRows = expenses.map(e => [
      e.title,
      e.category.replace('_', ' ').toUpperCase(),
      formatDate(e.date || e.created_date),
      e.vendor || '—',
      formatINR(e.gst_amount),
      formatINR(e.amount),
      e.status.toUpperCase()
    ]);

    // 7. Customer Balances
    const customerInvoicesMap = {};
    invoices.forEach(inv => {
      if (inv.status !== 'cancelled' && inv.status !== 'draft') {
        const outstanding = inv.balance_due !== undefined ? inv.balance_due : inv.total;
        customerInvoicesMap[inv.customer_id] = {
          total: (customerInvoicesMap[inv.customer_id]?.total || 0) + inv.total,
          outstanding: (customerInvoicesMap[inv.customer_id]?.outstanding || 0) + outstanding,
        };
      }
    });
    const customerRows = customers.map(c => [
      c.name,
      c.email || '—',
      c.gstin || '—',
      formatINR(customerInvoicesMap[c.id]?.total || 0),
      formatINR(customerInvoicesMap[c.id]?.outstanding || 0)
    ]);

    // 8. Supplier Balances
    const supplierExpensesMap = {};
    expenses.forEach(e => {
      if (e.vendor) {
        const isPending = e.status === 'pending';
        supplierExpensesMap[e.vendor.toLowerCase()] = {
          total: (supplierExpensesMap[e.vendor.toLowerCase()]?.total || 0) + e.amount,
          outstanding: (supplierExpensesMap[e.vendor.toLowerCase()]?.outstanding || 0) + (isPending ? e.amount : 0)
        };
      }
    });
    const supplierRows = suppliers.map(s => [
      s.name,
      s.email || '—',
      s.payment_terms || '—',
      formatINR(supplierExpensesMap[s.name.toLowerCase()]?.total || 0),
      formatINR(supplierExpensesMap[s.name.toLowerCase()]?.outstanding || 0)
    ]);

    // 9. Inventory Valuation
    const inventoryRows = products.map(p => [
      p.name,
      p.sku || '—',
      p.category || '—',
      `${p.stock_quantity} ${p.unit}`,
      formatINR(p.purchase_price),
      formatINR(p.stock_quantity * p.purchase_price),
      p.stock_quantity <= (p.low_stock_threshold || 0) ? 'LOW' : 'NORMAL'
    ]);

    // 10. General Ledger
    const all = [
      ...invoices.map(i => ({ date: i.invoice_date || i.created_date, desc: `Invoice ${i.invoice_number}`, party: i.customer_name, type: 'invoice', debit: i.total, credit: 0 })),
      ...payments.map(p => ({ date: p.date || p.created_date, desc: `Payment ${p.payment_number}`, party: p.customer_name, type: 'payment', debit: 0, credit: p.amount })),
      ...expenses.map(e => ({ date: e.date || e.created_date, desc: e.title, party: e.vendor, type: 'expense', debit: 0, credit: e.amount }))
    ];
    all.sort((a, b) => new Date(a.date) - new Date(b.date));
    let balance = 0;
    const ledgerRows = all.map(t => {
      balance += t.debit - t.credit;
      return [
        formatDate(t.date),
        t.desc,
        t.party || '—',
        t.type.toUpperCase(),
        t.debit ? formatINR(t.debit) : '—',
        t.credit ? formatINR(t.credit) : '—',
        formatINR(balance)
      ];
    }).reverse();

    return {
      pnl: { headers: ['Particulars', 'Total Amount'], rows: pnlRows },
      cashflow: { headers: ['Month', 'Collections (Inflow)', 'Expenses (Outflow)', 'Net Cash Flow'], rows: cashFlowRows },
      gst: { headers: ['Tax Component', 'Output GST Collected', 'Input GST (ITC)', 'Net Payable / Refund'], rows: gstRows },
      sales: { headers: ['Invoice #', 'Customer', 'Date', 'Taxable Value', 'GST Amt', 'Grand Total', 'Status'], rows: salesRows },
      purchase: { headers: ['Supplier (Vendor)', 'Category', 'Date', 'Taxable Value', 'GST Paid', 'Grand Total', 'Status'], rows: purchaseRows },
      expense: { headers: ['Title', 'Category', 'Date', 'Vendor', 'GST Paid', 'Amount', 'Status'], rows: expenseRows },
      customer: { headers: ['Customer Name', 'Email', 'GSTIN', 'Total Billing', 'Outstanding Balance'], rows: customerRows },
      supplier: { headers: ['Supplier Name', 'Email', 'Terms', 'Total Purchases', 'Outstanding Balance'], rows: supplierRows },
      inventory: { headers: ['Product Name', 'SKU', 'Category', 'In Stock', 'Unit Cost', 'Stock Valuation', 'Status'], rows: inventoryRows },
      ledger: { headers: ['Date', 'Description', 'Party', 'Type', 'Debit (In)', 'Credit (Out)', 'Balance'], rows: ledgerRows }
    };
  }, [data]);

  // Client-side CSV Exporter
  const handleExportCSV = () => {
    const activeData = reportPayload[activeReport];
    if (!activeData) return;

    const tabName = reportTabs.find(t => t.id === activeReport)?.label || 'Report';
    const csvContent = [
      [tabName],
      [`Generated on: ${new Date().toLocaleDateString('en-IN')}`],
      [],
      activeData.headers,
      ...activeData.rows.map(r => r.map(val => {
        const strVal = String(val);
        if (strVal.includes(',') || strVal.includes('\n') || strVal.includes('₹')) {
          return `"${strVal.replace(/"/g, '""')}"`;
        }
        return strVal;
      }))
    ].map(e => e.join(",")).join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${activeReport}_report_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Client-side PDF Exporter
  const handleExportPDF = () => {
    const activeData = reportPayload[activeReport];
    if (!activeData) return;

    const titleName = reportTabs.find(t => t.id === activeReport)?.label || 'Business Report';
    const doc = new jsPDF();

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(titleName, 14, 20);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Generated on: ${new Date().toLocaleDateString('en-IN')}`, 14, 28);

    let y = 38;
    doc.setFont("helvetica", "bold");
    let x = 14;
    const colWidth = 180 / activeData.headers.length;

    activeData.headers.forEach((h, idx) => {
      doc.text(h, x + (idx * colWidth), y);
    });

    y += 4;
    doc.line(14, y, 194, y);
    y += 6;

    doc.setFont("helvetica", "normal");
    activeData.rows.forEach(row => {
      if (y > 270) {
        doc.addPage();
        y = 20;
        doc.setFont("helvetica", "bold");
        activeData.headers.forEach((h, idx) => {
          doc.text(h, x + (idx * colWidth), y);
        });
        y += 4;
        doc.line(14, y, 194, y);
        y += 6;
        doc.setFont("helvetica", "normal");
      }

      row.forEach((val, idx) => {
        const text = String(val !== undefined && val !== null ? val : '—').slice(0, Math.floor(colWidth / 2.2));
        doc.text(text, x + (idx * colWidth), y);
      });
      y += 7;
    });

    doc.save(`${activeReport}_report_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  if (loading) return <div className="p-8"><div className="h-64 rounded-xl bg-muted animate-pulse" /></div>;
  if (error) return <div className="p-8 text-center text-red-500 font-semibold">{error}</div>;

  const currentReport = reportPayload[activeReport];

  return (
    <div className="max-w-[1400px] mx-auto space-y-6 pb-12">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <PageHeader title="Reports Center" subtitle="Comprehensive financial records and exports" />
        <Button variant="outline" size="icon" onClick={loadData} title="Reload records">
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Navigation Sidebar */}
        <div className="space-y-1">
          {reportTabs.map(tab => {
            const Icon = tab.icon;
            const isActive = tab.id === activeReport;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveReport(tab.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${isActive
                    ? 'bg-primary text-primary-foreground shadow'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Report Display and Exports */}
        <div className="lg:col-span-3 space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between border-b border-border pb-4 flex-wrap gap-4">
              <div>
                <CardTitle className="text-lg">
                  {reportTabs.find(t => t.id === activeReport)?.label}
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">Real-time ledger matching live database records</p>
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={handleExportCSV} variant="outline" size="sm" className="gap-1.5 h-9">
                  <Download className="w-4 h-4" /> Export CSV / Excel
                </Button>
                <Button onClick={handleExportPDF} variant="outline" size="sm" className="gap-1.5 h-9">
                  <Download className="w-4 h-4" /> Export PDF
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {currentReport && currentReport.rows.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/30 border-b border-border text-muted-foreground text-xs font-semibold uppercase">
                        {currentReport.headers.map((h, idx) => (
                          <th key={idx} className={`px-5 py-3 ${idx === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {currentReport.rows.map((row, rowIdx) => {
                        const isTotalRow = row[0]?.includes('Total') || row[0]?.includes('Net Profit') || row[0]?.includes('Gross Profit');
                        return (
                          <tr
                            key={rowIdx}
                            className={`border-b border-border last:border-0 hover:bg-muted/30 transition-colors ${isTotalRow ? 'bg-muted/20 font-bold text-foreground border-t border-border' : ''
                              }`}
                          >
                            {row.map((val, cellIdx) => (
                              <td
                                key={cellIdx}
                                className={`px-5 py-3.5 ${cellIdx === 0 ? 'text-left font-medium' : 'text-right'
                                  } ${val?.includes('-') && cellIdx > 0 ? 'text-rose-600' : ''
                                  }`}
                              >
                                {val}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-12 text-center text-muted-foreground">
                  <FileText className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
                  <p className="font-medium text-sm">No transaction records found for this report.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}