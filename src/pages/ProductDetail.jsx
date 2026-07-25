import EntityDetailPage from '@/components/EntityDetailPage';
import StatusBadge from '@/components/StatusBadge';

const fields = [
  { key: 'name', label: 'Name' },
  { key: 'sku', label: 'SKU' },
  { key: 'barcode', label: 'Barcode' },
  { key: 'hsn_code', label: 'HSN Code' },
  { key: 'gst_rate', label: 'GST Rate', render: (item) => `${item.gst_rate}%` },
  { key: 'category', label: 'Category' },
  { key: 'description', label: 'Description' },
  { key: 'purchase_price', label: 'Purchase Price', type: 'currency' },
  { key: 'selling_price', label: 'Selling Price', type: 'currency' },
  { key: 'unit', label: 'Unit' },
  { key: 'stock_quantity', label: 'Stock Quantity' },
  { key: 'low_stock_threshold', label: 'Low Stock Threshold' },
  { key: 'status', label: 'Status', render: (item) => <StatusBadge status={item.status} /> },
];

const formFields = [
  { key: 'name', label: 'Name', required: true },
  { key: 'sku', label: 'SKU' },
  { key: 'barcode', label: 'Barcode' },
  { key: 'hsn_code', label: 'HSN Code' },
  { key: 'gst_rate', label: 'GST Rate (%)', type: 'number' },
  { key: 'category', label: 'Category' },
  { key: 'description', label: 'Description', type: 'textarea' },
  { key: 'purchase_price', label: 'Purchase Price', type: 'number' },
  { key: 'selling_price', label: 'Selling Price', type: 'number' },
  { key: 'unit', label: 'Unit' },
  { key: 'stock_quantity', label: 'Stock Quantity', type: 'number' },
  { key: 'low_stock_threshold', label: 'Low Stock Threshold', type: 'number' },
  { key: 'status', label: 'Status', type: 'select', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
];

export default function ProductDetail() {
  return <EntityDetailPage entityName="Product" titleKey="name" fields={fields} formFields={formFields} backPath="/products" />;
}