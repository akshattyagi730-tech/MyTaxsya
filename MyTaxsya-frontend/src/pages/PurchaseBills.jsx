import { useState, useMemo } from 'react';
import { Plus, Pencil, Trash2, ShieldCheck, ShieldOff, UploadCloud } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import DataTable from '@/components/DataTable';
import PurchaseBillForm from '@/components/PurchaseBills/PurchaseBillForm';
import PurchaseBillUploadDialog from '@/components/PurchaseBills/PurchaseBillUploadDialog';
import ConfirmDialog from '@/components/ConfirmDialog';
import StatusBadge from '@/components/StatusBadge';
import { useEntityCrud } from '@/hooks/useEntityCrud';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatINR, formatDate } from '@/utils/format';

export default function PurchaseBills() {
  const { items, loading, error, remove, deleting, reload } = useEntityCrud('PurchaseBill');
  const [formOpen, setFormOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [deleteItem, setDeleteItem] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');

  const filtered = useMemo(() =>
    statusFilter === 'all' ? items : items.filter(i => i.status === statusFilter),
    [items, statusFilter]
  );

  const columns = [
    { key: 'bill_number', label: 'Bill #', sortable: true },
    { key: 'supplier_name', label: 'Supplier', sortable: true },
    { key: 'bill_date', label: 'Date', sortable: true, render: (r) => formatDate(r.bill_date) },
    { key: 'total', label: 'Total', sortable: true, render: (r) => <span className="font-medium">{formatINR(r.total)}</span> },
    {
      key: 'itc_eligible', label: 'ITC', render: (r) => r.itc_eligible
        ? <span className="inline-flex items-center gap-1 text-xs text-secondary font-medium"><ShieldCheck className="w-3.5 h-3.5" /> Eligible</span>
        : <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><ShieldOff className="w-3.5 h-3.5" /> Blocked</span>
    },
    { key: 'payment_status', label: 'Payment', render: (r) => <StatusBadge status={r.payment_status} /> },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <div className="max-w-[1400px] mx-auto">
      <PageHeader title="Purchase Bills" subtitle={`${items.length} total bills · source of Input Tax Credit in GST Center`}>
        <Button variant="outline" className="gap-2" onClick={() => setUploadOpen(true)}>
          <UploadCloud className="w-4 h-4" /> Upload Bill
        </Button>
        <Button className="gap-2" onClick={() => { setEditItem(null); setFormOpen(true); }}>
          <Plus className="w-4 h-4" /> Add Purchase Bill
        </Button>
      </PageHeader>

      <DataTable
        data={filtered} columns={columns} loading={loading} error={error}
        searchKeys={['bill_number', 'supplier_name', 'notes']}
        toolbar={
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40 h-10"><SelectValue placeholder="All Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="recorded">Recorded</SelectItem>
            </SelectContent>
          </Select>
        }
        actions={(row) => (
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="icon" onClick={() => { setEditItem(row); setFormOpen(true); }}>
              <Pencil className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setDeleteItem(row)}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        )}
      />

      <PurchaseBillForm open={formOpen} onClose={() => setFormOpen(false)}
        onSaved={reload} bill={editItem} />
      <PurchaseBillUploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)}
        onDone={() => { setUploadOpen(false); reload(); }} />
      <ConfirmDialog open={!!deleteItem} onClose={() => setDeleteItem(null)}
        onConfirm={async () => { await remove(deleteItem.id); setDeleteItem(null); }}
        loading={deleting} title="Delete Purchase Bill"
        description={`Are you sure you want to delete bill "${deleteItem?.bill_number}"?`} />
    </div>
  );
}
