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
import { formatINR } from '@/utils/format';

const fields = [
  { key: 'name', label: 'Name', required: true },
  { key: 'sku', label: 'SKU' },
  { key: 'barcode', label: 'Barcode' },
  { key: 'hsn_code', label: 'HSN Code' },
  { key: 'gst_rate', label: 'GST Rate (%)', type: 'select', numeric: true, options: [{ value: 5, label: '5%' }, { value: 18, label: '18%' }] },
  { key: 'category', label: 'Category' },
  { key: 'description', label: 'Description', type: 'textarea' },
  { key: 'purchase_price', label: 'Purchase Price', type: 'number' },
  { key: 'selling_price', label: 'Selling Price', type: 'number' },
  { key: 'unit', label: 'Unit' },
  { key: 'stock_quantity', label: 'Stock Quantity', type: 'number' },
  { key: 'low_stock_threshold', label: 'Low Stock Threshold', type: 'number' },
  { key: 'status', label: 'Status', type: 'select', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
];

const columns = [
  { key: 'name', label: 'Name', sortable: true },
  { key: 'sku', label: 'SKU', sortable: true },
  { key: 'category', label: 'Category', sortable: true },
  { key: 'selling_price', label: 'Price', sortable: true, render: (r) => formatINR(r.selling_price) },
  {
    key: 'stock_quantity', label: 'Stock', sortable: true, render: (r) => (
      <span className={r.stock_quantity <= (r.low_stock_threshold || 0) ? 'text-destructive font-medium' : ''}>{r.stock_quantity} {r.unit}</span>
    )
  },
  { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
];

export default function Products() {
  const navigate = useNavigate();
  const { items, loading, error, create, update, remove, saving, deleting } = useEntityCrud('Product');
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
      <PageHeader title="Products" subtitle={`${items.length} total products`}>
        <span className="cta-glow">
          <Button className="gap-2" onClick={() => { setEditItem(null); setFormOpen(true); }}>
            <Plus className="w-4 h-4" /> Add Product
          </Button>
        </span>
      </PageHeader>

      <DataTable
        data={items} columns={columns} loading={loading} error={error}
        searchKeys={['name', 'sku', 'barcode', 'hsn_code', 'category']}
        onRowClick={(row) => navigate(`/products/${row.id}`)}
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
        onSubmit={handleSubmit} title={editItem ? 'Edit Product' : 'Add Product'}
        fields={fields} initialData={editItem || {}} loading={saving} />
      <ConfirmDialog open={!!deleteItem} onClose={() => setDeleteItem(null)}
        onConfirm={async () => { await remove(deleteItem.id); setDeleteItem(null); }}
        loading={deleting} title="Delete Product"
        description={`Are you sure you want to delete ${deleteItem?.name}?`} />
    </div>
  );
}