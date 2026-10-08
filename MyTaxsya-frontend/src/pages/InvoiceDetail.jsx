import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Pencil, Trash2, Printer, Download } from 'lucide-react';
import api from '@/services/api';
import { Button } from '@/components/ui/button';
import StatusBadge from '@/components/StatusBadge';
import ConfirmDialog from '@/components/ConfirmDialog';
import InvoiceForm from '@/components/Invoices/InvoiceForm';
import { formatINR, formatDate } from '@/utils/format';
import { buildInvoicePdf } from '@/utils/invoicePdf';

export default function InvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get(`/entities/Invoice/${id}`);
        setInvoice(res.data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  // Business profile and customer are what make the bill a proper tax invoice (GSTIN, addresses, bank details).
  const buildPdf = async () => {
    let business = {};
    let customer = {};
    try {
      const [b, c] = await Promise.all([
        api.get('/entities/Business', { params: { sort: '-created_date', limit: 1 } }).catch(() => null),
        invoice.customer_id ? api.get(`/entities/Customer/${invoice.customer_id}`).catch(() => null) : null,
      ]);
      business = (Array.isArray(b?.data) ? b.data[0] : b?.data) || {};
      customer = c?.data || {};
    } catch { /* the bill is still produced without them */ }
    return buildInvoicePdf({ invoice, business, customer });
  };

  const handleDownloadPDF = async () => {
    if (!invoice || pdfBusy) return;
    setPdfBusy(true);
    try {
      const doc = await buildPdf();
      doc.save(`invoice_${String(invoice.invoice_number).replace(/[^\w.-]+/g, '_')}.pdf`);
    } finally {
      setPdfBusy(false);
    }
  };

  const handlePrint = async () => {
    if (!invoice || pdfBusy) return;
    setPdfBusy(true);
    try {
      const doc = await buildPdf();
      doc.autoPrint();
      window.open(doc.output('bloburl'), '_blank');
    } finally {
      setPdfBusy(false);
    }
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
            <h1 className="font-heading text-2xl font-bold tracking-tight">{invoice.invoice_number}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{invoice.customer_name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-2" onClick={handleDownloadPDF} disabled={pdfBusy}>
            <Download className="w-4 h-4" /> {pdfBusy ? 'Preparing…' : 'Download PDF'}
          </Button>
          <Button variant="outline" className="gap-2" onClick={handlePrint} disabled={pdfBusy}>
            <Printer className="w-4 h-4" /> Print
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => setEditOpen(true)}>
            <Pencil className="w-4 h-4" /> Edit
          </Button>
          <Button variant="outline" className="text-destructive gap-2" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="w-4 h-4" /> Delete
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-card border border-border rounded-xl p-5">
          <h2 className="font-heading font-semibold mb-4">Invoice Details</h2>
          <div className="space-y-2.5 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Status</span><StatusBadge status={invoice.status} /></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Invoice Date</span><span className="font-medium">{formatDate(invoice.invoice_date)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Due Date</span><span className="font-medium">{formatDate(invoice.due_date)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Customer</span><span className="font-medium">{invoice.customer_name}</span></div>
          </div>
        </div>

        <div className="lg:col-span-2 bg-card border border-border rounded-xl p-5">
          <h2 className="font-heading font-semibold mb-4">Payment Summary</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div><p className="text-sm text-muted-foreground">Subtotal</p><p className="text-lg font-bold">{formatINR(invoice.subtotal)}</p></div>
            <div><p className="text-sm text-muted-foreground">CGST</p><p className="text-lg font-bold">{formatINR(invoice.cgst)}</p></div>
            <div><p className="text-sm text-muted-foreground">SGST</p><p className="text-lg font-bold">{formatINR(invoice.sgst)}</p></div>
            <div><p className="text-sm text-muted-foreground">IGST</p><p className="text-lg font-bold">{formatINR(invoice.igst)}</p></div>
          </div>
          <div className="mt-4 pt-4 border-t border-border space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span className="font-bold text-lg">{formatINR(invoice.total)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Paid Amount</span><span className="font-medium text-secondary">{formatINR(invoice.paid_amount)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Balance Due</span><span className="font-bold text-accent">{formatINR(invoice.balance_due)}</span></div>
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="p-5 pb-4"><h2 className="font-heading font-semibold text-lg">Line Items</h2></div>
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
          <h2 className="font-heading font-semibold mb-2">Notes</h2>
          <p className="text-sm text-muted-foreground">{invoice.notes}</p>
        </div>
      )}

      <InvoiceForm open={editOpen} onClose={() => setEditOpen(false)}
        onSaved={() => window.location.reload()} invoice={invoice} />
      <ConfirmDialog open={deleteOpen} onClose={() => setDeleteOpen(false)}
        onConfirm={async () => { await api.delete(`/entities/Invoice/${id}`); navigate('/invoices'); }}
        title="Delete Invoice" description={`Are you sure you want to delete ${invoice.invoice_number}?`} />
    </div>
  );
}