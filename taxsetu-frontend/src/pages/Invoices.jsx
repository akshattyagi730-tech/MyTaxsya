import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Pencil, Trash2, UploadCloud, AlertTriangle, CheckCircle2 } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import DataTable from '@/components/DataTable';
import ConfirmDialog from '@/components/ConfirmDialog';
import StatusBadge from '@/components/StatusBadge';
import InvoiceForm from '@/components/Invoices/InvoiceForm';
import BulkUploadDialog from '@/components/Invoices/BulkUploadDialog';
import { useEntityCrud } from '@/hooks/useEntityCrud';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatINR, formatDate } from '@/utils/format';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/use-toast';
import { invoiceService } from '@/services/invoiceService';

const columns = [
  { key: 'invoice_number', label: 'Invoice #', sortable: true },
  { key: 'customer_name', label: 'Customer', sortable: true },
  { key: 'invoice_date', label: 'Date', sortable: true, render: (r) => formatDate(r.invoice_date) },
  { key: 'total', label: 'Amount', sortable: true, render: (r) => <span className="font-medium">{formatINR(r.total)}</span> },
  { key: 'balance_due', label: 'Balance', render: (r) => formatINR(r.balance_due) },
  {
    key: 'ai_confidence', label: 'AI Review', render: (r) => {
      if (r.ai_confidence == null) return <span className="text-xs text-muted-foreground">—</span>;
      if (r.ai_confidence < 0.8) {
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-400 border border-amber-300 dark:border-amber-800 whitespace-nowrap">
            <AlertTriangle className="w-3 h-3" />
            Score: {r.ai_confidence.toFixed(2)} - Needs Review
          </span>
        );
      }
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">
          <CheckCircle2 className="w-3 h-3" />
          {r.ai_confidence.toFixed(2)}
        </span>
      );
    }
  },
  { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
];

export default function Invoices() {
  const navigate = useNavigate();
  const { items, loading, error, remove, deleting, reload } = useEntityCrud('Invoice');
  const [formOpen, setFormOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [deleteItem, setDeleteItem] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [confirmInput, setConfirmInput] = useState('');
  const [deletingAll, setDeletingAll] = useState(false);

  const filtered = useMemo(() =>
    statusFilter === 'all' ? items : items.filter(i => i.status === statusFilter),
    [items, statusFilter]
  );

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
            className="gap-2 bg-red-600 hover:bg-red-700"
            onClick={() => setDeleteAllOpen(true)}
            disabled={items.length === 0}
          >
            <Trash2 className="w-4 h-4" /> Delete All
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => setBulkOpen(true)}>
            <UploadCloud className="w-4 h-4" /> Upload CSV
          </Button>
          <Button className="gap-2" onClick={() => { setEditItem(null); setFormOpen(true); }}>
            <Plus className="w-4 h-4" /> Create Invoice
          </Button>
        </div>
      </PageHeader>

      <DataTable
        data={filtered}
        columns={columns}
        loading={loading}
        error={error}
        searchKeys={['invoice_number', 'customer_name']}
        onRowClick={(row) => navigate(`/invoices/${row.id}`)}
        toolbar={
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40 h-10"><SelectValue placeholder="All Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        }
        actions={(row) => (
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="icon" onClick={() => { setEditItem(row); setFormOpen(true); }}>
              <Pencil className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" className="text-red-600" onClick={() => setDeleteItem(row)}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        )}
      />

      <InvoiceForm open={formOpen} onClose={() => setFormOpen(false)}
        onSaved={() => { window.location.reload(); }}
        invoice={editItem} />
      <ConfirmDialog open={!!deleteItem} onClose={() => setDeleteItem(null)}
        onConfirm={handleDelete} loading={deleting}
        title="Delete Invoice"
        description={`Are you sure you want to delete ${deleteItem?.invoice_number}?`} />
      <BulkUploadDialog open={bulkOpen} onClose={() => setBulkOpen(false)}
        onDone={() => { setBulkOpen(false); window.location.reload(); }} />

      <Dialog open={deleteAllOpen} onOpenChange={(open) => { if (!deletingAll) { setDeleteAllOpen(open); setConfirmInput(''); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete All Invoices</DialogTitle>
            <DialogDescription className="space-y-2">
              <p>This action will permanently delete all invoices from the system.</p>
              <p className="font-semibold text-red-600">This cannot be undone.</p>
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
              className="bg-red-600 hover:bg-red-700"
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