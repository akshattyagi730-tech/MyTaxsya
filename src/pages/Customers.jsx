import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import DataTable from '@/components/DataTable';
import EntityFormDialog from '@/components/EntityFormDialog';
import ConfirmDialog from '@/components/ConfirmDialog';
import StatusBadge from '@/components/StatusBadge';
import { useEntityCrud } from '@/hooks/useEntityCrud';
import { Button } from '@/components/ui/button';
import { formatINR } from '@/lib/format';

const fields = [
  { key: 'name', label: 'Name', required: true },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'phone', label: 'Phone' },
  { key: 'gstin', label: 'GSTIN' },
  { key: 'billing_address', label: 'Billing Address', type: 'textarea' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'pincode', label: 'Pincode' },
  { key: 'credit_limit', label: 'Credit Limit', type: 'number' },
  { key: 'status', label: 'Status', type: 'select', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
];

const columns = [
  { key: 'name', label: 'Name', sortable: true },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'city', label: 'City', sortable: true },
  { key: 'outstanding_amount', label: 'Outstanding', sortable: true, render: (r) => <span className="font-semibold text-rose-600">{formatINR(r.outstanding_amount)}</span> },
  { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
];

export default function Customers() {
  const navigate = useNavigate();
  const { items, loading, error, create, update, remove, saving, deleting } = useEntityCrud('Customer');
  const [formOpen, setFormOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [deleteItem, setDeleteItem] = useState(null);

  const handleSubmit = async (data) => {
    if (editItem) await update(editItem.id, data);
    else await create(data);
    setFormOpen(false);
  };

  return (
    <div className="max-w-[1400px] mx-auto">
      <PageHeader title="Customers" subtitle={`${items.length} total customers`}>
        <Button className="gap-2" onClick={() => { setEditItem(null); setFormOpen(true); }}>
          <Plus className="w-4 h-4" /> Add Customer
        </Button>
      </PageHeader>

      <DataTable
        data={items} columns={columns} loading={loading} error={error}
        searchKeys={['name', 'email', 'phone', 'gstin', 'city']}
        onRowClick={(row) => navigate(`/customers/${row.id}`)}
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

      <EntityFormDialog open={formOpen} onClose={() => setFormOpen(false)}
        onSubmit={handleSubmit} title={editItem ? 'Edit Customer' : 'Add Customer'}
        fields={fields} initialData={editItem || {}} loading={saving} />
      <ConfirmDialog open={!!deleteItem} onClose={() => setDeleteItem(null)}
        onConfirm={async () => { await remove(deleteItem.id); setDeleteItem(null); }}
        loading={deleting} title="Delete Customer"
        description={`Are you sure you want to delete ${deleteItem?.name}?`} />
    </div>
  );
}