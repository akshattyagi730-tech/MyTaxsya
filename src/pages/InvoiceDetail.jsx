import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Pencil, Trash2, Printer, Download } from 'lucide-react';
import apiClient from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import StatusBadge from '@/components/StatusBadge';
import ConfirmDialog from '@/components/ConfirmDialog';
import InvoiceForm from '@/components/invoices/InvoiceForm';
import { formatINR, formatDate } from '@/lib/format';
import { jsPDF } from 'jspdf';

export default function InvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await apiClient.get(`/entities/Invoice/${id}`);
        setInvoice(res.data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  const handleDownloadPDF = () => {
    if (!invoice) return;
    const doc = new jsPDF();
    
    // Header - Title
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text("TAX INVOICE", 14, 25);
    
    // Line under title
    doc.setDrawColor(200, 200, 200);
    doc.line(14, 28, 196, 28);
    
    // Invoice details
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("Invoice Number:", 120, 36);
    doc.setFont("helvetica", "normal");
    doc.text(invoice.invoice_number, 160, 36);
    
    doc.setFont("helvetica", "bold");
    doc.text("Invoice Date:", 120, 42);
    doc.setFont("helvetica", "normal");
    doc.text(formatDate(invoice.invoice_date), 160, 42);
    
    doc.setFont("helvetica", "bold");
    doc.text("Due Date:", 120, 48);
    doc.setFont("helvetica", "normal");
    doc.text(formatDate(invoice.due_date), 160, 48);

    doc.setFont("helvetica", "bold");
    doc.text("Payment Status:", 120, 54);
    doc.setFont("helvetica", "bold");
    doc.text(invoice.status.toUpperCase(), 160, 54);
    
    // Customer details
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("BILL TO:", 14, 36);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(invoice.customer_name || "—", 14, 42);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text("Registered Customer", 14, 48);

    // Line items header
    let y = 68;
    doc.setFont("helvetica", "bold");
    doc.text("Description", 14, y);
    doc.text("Qty", 100, y);
    doc.text("Rate", 125, y);
    doc.text("GST %", 150, y);
    doc.text("Amount", 175, y);
    
    y += 4;
    doc.line(14, y, 196, y);
    y += 6;
    
    // Line items list
    doc.setFont("helvetica", "normal");
    invoice.items?.forEach(item => {
      if (y > 250) {
        doc.addPage();
        y = 20;
        doc.setFont("helvetica", "bold");
        doc.text("Description", 14, y);
        doc.text("Qty", 100, y);
        doc.text("Rate", 125, y);
        doc.text("GST %", 150, y);
        doc.text("Amount", 175, y);
        y += 4;
        doc.line(14, y, 196, y);
        y += 6;
        doc.setFont("helvetica", "normal");
      }
      
      doc.text(String(item.description || '—'), 14, y);
      doc.text(String(item.quantity || 0), 100, y);
      doc.text(formatINR(item.rate), 125, y);
      doc.text(`${item.gst_rate}%`, 150, y);
      doc.text(formatINR(item.quantity * item.rate), 175, y);
      y += 7;
    });
    
    y += 2;
    doc.line(14, y, 196, y);
    y += 8;
    
    // Totals breakdown
    const labelX = 120;
    const valueX = 175;
    
    doc.text("Subtotal:", labelX, y);
    doc.text(formatINR(invoice.subtotal), valueX, y);
    y += 6;
    
    if (invoice.cgst > 0) {
      doc.text("CGST:", labelX, y);
      doc.text(formatINR(invoice.cgst), valueX, y);
      y += 6;
    }
    if (invoice.sgst > 0) {
      doc.text("SGST:", labelX, y);
      doc.text(formatINR(invoice.sgst), valueX, y);
      y += 6;
    }
    if (invoice.igst > 0) {
      doc.text("IGST:", labelX, y);
      doc.text(formatINR(invoice.igst), valueX, y);
      y += 6;
    }
    
    doc.setFont("helvetica", "bold");
    doc.text("Grand Total:", labelX, y);
    doc.text(formatINR(invoice.total), valueX, y);
    y += 6;
    doc.text("Paid Amount:", labelX, y);
    doc.text(formatINR(invoice.paid_amount), valueX, y);
    y += 6;
    doc.text("Balance Due:", labelX, y);
    doc.text(formatINR(invoice.balance_due), valueX, y);
    
    // Notes
    if (invoice.notes) {
      y += 15;
      doc.setFont("helvetica", "bold");
      doc.text("Notes:", 14, y);
      y += 6;
      doc.setFont("helvetica", "normal");
      doc.text(invoice.notes, 14, y);
    }
    
    doc.save(`invoice_${invoice.invoice_number}.pdf`);
  };

  if (loading) return <div className="p-8"><div className="h-64 rounded-xl bg-muted animate-pulse" /></div>;
  if (error) return <div className="p-8 text-center text-muted-foreground">{error}</div>;
  if (!invoice) return <div className="p-8 text-center text-muted-foreground">Invoice not found</div>;

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/invoices')}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{invoice.invoice_number}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{invoice.customer_name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-2" onClick={handleDownloadPDF}>
            <Download className="w-4 h-4" /> Download PDF
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => window.print()}>
            <Printer className="w-4 h-4" /> Print
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => setEditOpen(true)}>
            <Pencil className="w-4 h-4" /> Edit
          </Button>
          <Button variant="outline" className="text-red-600 gap-2" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="w-4 h-4" /> Delete
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-card border border-border rounded-xl p-5">
          <h2 className="font-semibold mb-4">Invoice Details</h2>
          <div className="space-y-2.5 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Status</span><StatusBadge status={invoice.status} /></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Invoice Date</span><span className="font-medium">{formatDate(invoice.invoice_date)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Due Date</span><span className="font-medium">{formatDate(invoice.due_date)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Customer</span><span className="font-medium">{invoice.customer_name}</span></div>
          </div>
        </div>

        <div className="lg:col-span-2 bg-card border border-border rounded-xl p-5">
          <h2 className="font-semibold mb-4">Payment Summary</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div><p className="text-sm text-muted-foreground">Subtotal</p><p className="text-lg font-bold">{formatINR(invoice.subtotal)}</p></div>
            <div><p className="text-sm text-muted-foreground">CGST</p><p className="text-lg font-bold">{formatINR(invoice.cgst)}</p></div>
            <div><p className="text-sm text-muted-foreground">SGST</p><p className="text-lg font-bold">{formatINR(invoice.sgst)}</p></div>
            <div><p className="text-sm text-muted-foreground">IGST</p><p className="text-lg font-bold">{formatINR(invoice.igst)}</p></div>
          </div>
          <div className="mt-4 pt-4 border-t border-border space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span className="font-bold text-lg">{formatINR(invoice.total)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Paid Amount</span><span className="font-medium text-emerald-600">{formatINR(invoice.paid_amount)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Balance Due</span><span className="font-bold text-amber-600">{formatINR(invoice.balance_due)}</span></div>
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="p-5 pb-4"><h2 className="font-semibold text-lg">Line Items</h2></div>
        {invoice.items?.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-y border-border bg-muted/30">
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase px-5 py-2.5">Description</th>
                  <th className="text-right text-xs font-medium text-muted-foreground uppercase px-5 py-2.5">Qty</th>
                  <th className="text-right text-xs font-medium text-muted-foreground uppercase px-5 py-2.5">Rate</th>
                  <th className="text-right text-xs font-medium text-muted-foreground uppercase px-5 py-2.5">GST%</th>
                  <th className="text-right text-xs font-medium text-muted-foreground uppercase px-5 py-2.5">Amount</th>
                </tr>
              </thead>
              <tbody>
                {invoice.items.map((item, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="px-5 py-3 text-sm font-medium">{item.description}</td>
                    <td className="px-5 py-3 text-sm text-right">{item.quantity}</td>
                    <td className="px-5 py-3 text-sm text-right">{formatINR(item.rate)}</td>
                    <td className="px-5 py-3 text-sm text-right">{item.gst_rate}%</td>
                    <td className="px-5 py-3 text-sm font-medium text-right">{formatINR(item.quantity * item.rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-sm text-muted-foreground">No line items</div>
        )}
      </div>

      {invoice.notes && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h2 className="font-semibold mb-2">Notes</h2>
          <p className="text-sm text-muted-foreground">{invoice.notes}</p>
        </div>
      )}

      <InvoiceForm open={editOpen} onClose={() => setEditOpen(false)}
        onSaved={() => window.location.reload()} invoice={invoice} />
      <ConfirmDialog open={deleteOpen} onClose={() => setDeleteOpen(false)}
        onConfirm={async () => { await apiClient.delete(`/entities/Invoice/${id}`); navigate('/invoices'); }}
        title="Delete Invoice" description={`Are you sure you want to delete ${invoice.invoice_number}?`} />
    </div>
  );
}