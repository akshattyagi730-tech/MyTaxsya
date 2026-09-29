import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import DataTable from '@/components/DataTable';
import EntityFormDialog from '@/components/EntityFormDialog';
import ConfirmDialog from '@/components/ConfirmDialog';
import StatusBadge from '@/components/StatusBadge';
import { useEntityCrud } from '@/hooks/useEntityCrud';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatINR, formatDate } from '@/utils/format';

const fields = [
  { key: 'title', label: 'Title', required: true },
  {
    key: 'category', label: 'Category', type: 'select', options: [
      { value: 'rent', label: 'Rent' }, { value: 'salaries', label: 'Salaries' },
      { value: 'utilities', label: 'Utilities' }, { value: 'marketing', label: 'Marketing' },
      { value: 'travel', label: 'Travel' }, { value: 'office_supplies', label: 'Office Supplies' },
      { value: 'software', label: 'Software' }, { value: 'professional_fees', label: 'Professional Fees' },
      { value: 'raw_materials', label: 'Raw Materials' }, { value: 'logistics', label: 'Logistics' },
      { value: 'other', label: 'Other' },
    ]
  },
  { key: 'amount', label: 'Amount', type: 'number', required: true },
  {
    key: 'payment_mode', label: 'Payment Mode', type: 'select', options: [
      { value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' },
      { value: 'bank', label: 'Bank Transfer' }, { value: 'card', label: 'Card' },
      { value: 'cheque', label: 'Cheque' },
    ]
  },
  { key: 'date', label: 'Date', type: 'date', required: true },
  { key: 'vendor', label: 'Vendor' },
  { key: 'gst_amount', label: 'GST Amount', type: 'number' },
  {
    key: 'status', label: 'Status', type: 'select', options: [
      { value: 'pending', label: 'Pending' }, { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' },
    ]
  },
  { key: 'notes', label: 'Notes' },
];

const columns = [
  { key: 'title', label: 'Title', sortable: true },
  { key: 'category', label: 'Category', sortable: true, render: (r) => <span className="capitalize">{r.category?.replace('_', ' ')}</span> },
  { key: 'amount', label: 'Amount', sortable: true, render: (r) => <span className="font-medium">{formatINR(r.amount)}</span> },
  { key: 'date', label: 'Date', sortable: true, render: (r) => formatDate(r.date) },
  { key: 'vendor', label: 'Vendor' },
  { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
];

export default function Expenses() {
  const navigate = useNavigate();
  const { items, loading, error, create, update, remove, saving, deleting } = useEntityCrud('Expense');
  const [formOpen, setFormOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [deleteItem, setDeleteItem] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState('all');

  const filtered = useMemo(() =>
    categoryFilter === 'all' ? items : items.filter(i => i.category === categoryFilter),
    [items, categoryFilter]
  );

  const handleSubmit = async (data) => {
    if (editItem) await update(editItem.id, data);
    else await create(data);
    setFormOpen(false);
  };

  return (
    <div className="max-w-[1400px] mx-auto">
      <PageHeader title="Expenses" subtitle={`${items.length} total expenses`}>
        <span className="cta-glow">
          <Button className="gap-2" onClick={() => { setEditItem(null); setFormOpen(true); }}>
            <Plus className="w-4 h-4" /> Add Expense
          </Button>
        </span>
      </PageHeader>

      <DataTable
        data={filtered} columns={columns} loading={loading} error={error}
        searchKeys={['title', 'vendor', 'notes']}
        onRowClick={(row) => navigate(`/expenses/${row.id}`)}
        toolbar={
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-40 h-10"><SelectValue placeholder="All Categories" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              <SelectItem value="rent">Rent</SelectItem>
              <SelectItem value="salaries">Salaries</SelectItem>
              <SelectItem value="utilities">Utilities</SelectItem>
              <SelectItem value="marketing">Marketing</SelectItem>
              <SelectItem value="travel">Travel</SelectItem>
              <SelectItem value="office_supplies">Office Supplies</SelectItem>
              <SelectItem value="software">Software</SelectItem>
              <SelectItem value="professional_fees">Professional Fees</SelectItem>
              <SelectItem value="raw_materials">Raw Materials</SelectItem>
              <SelectItem value="logistics">Logistics</SelectItem>
              <SelectItem value="other">Other</SelectItem>
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

      <EntityFormDialog open={formOpen} onClose={() => setFormOpen(false)}
        onSubmit={handleSubmit} title={editItem ? 'Edit Expense' : 'Add Expense'}
        fields={fields} initialData={editItem || {}} loading={saving} />
      <ConfirmDialog open={!!deleteItem} onClose={() => setDeleteItem(null)}
        onConfirm={async () => { await remove(deleteItem.id); setDeleteItem(null); }}
        loading={deleting} title="Delete Expense"
        description={`Are you sure you want to delete ${deleteItem?.title}?`} />
    </div>
  );
}