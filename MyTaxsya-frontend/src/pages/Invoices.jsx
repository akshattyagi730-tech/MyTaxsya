import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Pencil, Trash2, UploadCloud, AlertTriangle, CheckCircle2,
  Search, Inbox, FileClock, FileX, Send, FileEdit,
} from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import ConfirmDialog from '@/components/ConfirmDialog';
import InvoiceForm from '@/components/Invoices/InvoiceForm';
import BulkUploadDialog from '@/components/Invoices/BulkUploadDialog';
import ErrorBoundary from '@/components/ErrorBoundary';
import { useEntityCrud } from '@/hooks/useEntityCrud';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatINR, formatDate } from '@/utils/format';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { invoiceService } from '@/services/invoiceService';

// Status -> visual treatment for the invoice cards (icon, colors, label).
const statusMeta = {
  draft: { label: 'Draft', icon: FileEdit, badge: 'bg-muted text-muted-foreground' },
  sent: { label: 'Sent', icon: Send, badge: 'bg-primary/15 text-primary' },
  paid: { label: 'Paid', icon: CheckCircle2, badge: 'bg-secondary/15 text-secondary' },
  overdue: { label: 'Overdue', icon: AlertTriangle, badge: 'bg-destructive/15 text-destructive' },
  cancelled: { label: 'Cancelled', icon: FileX, badge: 'bg-muted text-muted-foreground/70' },
};

export default function Invoices() {
  const navigate = useNavigate();
  const { items, loading, error, remove, deleting, reload } = useEntityCrud('Invoice');
  const [formOpen, setFormOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [deleteItem, setDeleteItem] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [confirmInput, setConfirmInput] = useState('');
  const [deletingAll, setDeletingAll] = useState(false);

  // Same matching behaviour DataTable used to provide (invoice_number / customer_name),
  // now handled locally since this page no longer goes through DataTable.
  const filtered = useMemo(() => {
    let result = statusFilter === 'all' ? items : items.filter(i => i.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(i =>
        String(i.invoice_number || '').toLowerCase().includes(q) ||
        String(i.customer_name || '').toLowerCase().includes(q)
      );
    }
    return [...result].sort((a, b) => new Date(b.invoice_date || b.created_date) - new Date(a.invoice_date || a.created_date));
  }, [items, statusFilter, search]);

  const handleDelete = async () => {
    await remove(deleteItem.id);
    setDeleteItem(null);
  };

  const handleDeleteAll = async () => {
    if (confirmInput !== 'DELETE') return;
    setDeletingAll(true);
    try {
      await invoiceService.deleteAllInvoices();
      toast({
        title: "✅ All invoices deleted successfully.",
        variant: "default",
      });
      setDeleteAllOpen(false);
      setConfirmInput('');
      reload();
    } catch (err) {
      toast({
        title: "Failed to delete invoices.",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setDeletingAll(false);
    }
  };

  return (
    <div className="max-w-[1400px] mx-auto">
      <PageHeader title="Invoices" subtitle={`${items.length} total invoices`}>
        <div className="flex items-center gap-2">
          <Button
            variant="destructive"
            className="gap-2 bg-destructive hover:bg-destructive/90"
            onClick={() => setDeleteAllOpen(true)}
            disabled={items.length === 0}
          >
            <Trash2 className="w-4 h-4" /> Delete All
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => setBulkOpen(true)}>
            <UploadCloud className="w-4 h-4" /> Upload CSV
          </Button>
          <span className="cta-glow">
            <Button className="gap-2" onClick={() => { setEditItem(null); setFormOpen(true); }}>
              <Plus className="w-4 h-4" /> Create Invoice
            </Button>
          </span>
        </div>
      </PageHeader>

      {/* Search + status filter */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search invoice # or customer..." className="pl-9 h-10" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44 h-10"><SelectValue placeholder="All Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Invoice cards */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="h-32 rounded-xl bg-muted animate-pulse" />)}
        </div>
      ) : error ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-6 h-6 text-destructive" />
          </div>
          <p className="text-sm font-medium mb-1">Something went wrong</p>
          <p className="text-sm text-muted-foreground mb-4">{error}</p>
          <Button variant="outline" onClick={() => window.location.reload()}>Retry</Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-card border border-border rounded-xl py-16 text-center">
          <Inbox className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No invoices found.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(inv => {
            const meta = statusMeta[inv.status] || statusMeta.draft;
            const StatusIcon = meta.icon;
            const needsReview = inv.ai_confidence != null && inv.ai_confidence < 0.8;
            return (
              <div
                key={inv.id}
                onClick={() => navigate(`/invoices/${inv.id}`)}
                className="bg-card border border-border rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow cursor-pointer flex flex-col"
              >
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="min-w-0">
                    <span className="font-heading text-[11px] font-bold uppercase tracking-wider text-muted-foreground block mb-0.5">
                      {inv.invoice_number}
                    </span>
                    <h3 className="font-heading font-semibold text-[16px] text-foreground truncate">
                      {inv.customer_name || 'Unnamed Customer'}
                    </h3>
                  </div>
                  <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider ${meta.badge}`}>
                    <StatusIcon className="w-3 h-3" />
                    {meta.label}
                  </span>
                </div>

                {needsReview && (
                  <span className="inline-flex items-center gap-1 self-start px-2 py-0.5 rounded-full text-[11px] font-medium bg-accent/15 text-accent mb-3">
                    <AlertTriangle className="w-3 h-3" />
                    AI Review: {inv.ai_confidence.toFixed(2)}
                  </span>
                )}

                <div className="mt-auto flex items-center justify-between pt-3 border-t border-border">
                  <div>
                    <p className="text-[13px] text-muted-foreground">{formatDate(inv.invoice_date)}</p>
                    {inv.balance_due > 0 && (
                      <p className="text-[11px] text-destructive font-medium">Balance: {formatINR(inv.balance_due)}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="font-heading font-semibold text-[16px] text-foreground">{formatINR(inv.total)}</span>
                    <div onClick={e => e.stopPropagation()} className="flex items-center ml-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditItem(inv); setFormOpen(true); }}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteItem(inv)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <InvoiceForm open={formOpen} onClose={() => setFormOpen(false)}
        onSaved={() => { setFormOpen(false); reload(); }}
        invoice={editItem} />
      <ConfirmDialog open={!!deleteItem} onClose={() => setDeleteItem(null)}
        onConfirm={handleDelete} loading={deleting}
        title="Delete Invoice"
        description={`Are you sure you want to delete ${deleteItem?.invoice_number}?`} />
      <ErrorBoundary onReset={() => setBulkOpen(false)}>
        <BulkUploadDialog open={bulkOpen} onClose={() => setBulkOpen(false)}
          onDone={() => { setBulkOpen(false); reload(); }} />
      </ErrorBoundary>

      <Dialog open={deleteAllOpen} onOpenChange={(open) => { if (!deletingAll) { setDeleteAllOpen(open); setConfirmInput(''); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete All Invoices</DialogTitle>
            <DialogDescription className="space-y-2">
              <p>This action will permanently delete all invoices from the system.</p>
              <p className="font-semibold text-destructive">This cannot be undone.</p>
              <p>Type <span className="font-bold">DELETE</span> to continue.</p>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <Input
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              placeholder="Type DELETE"
              disabled={deletingAll}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setDeleteAllOpen(false); setConfirmInput(''); }}
              disabled={deletingAll}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="bg-destructive hover:bg-destructive/90"
              onClick={handleDeleteAll}
              disabled={confirmInput !== 'DELETE' || deletingAll}
            >
              {deletingAll ? 'Deleting...' : 'Delete All'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
