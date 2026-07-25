import EntityDetailPage from '@/Components/EntityDetailPage';
import StatusBadge from '@/Components/StatusBadge';

const fields = [
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'gstin', label: 'GSTIN' },
  { key: 'address', label: 'Address' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'pincode', label: 'Pincode' },
  { key: 'payment_terms', label: 'Payment Terms' },
  { key: 'opening_balance', label: 'Opening Balance', type: 'currency' },
  { key: 'status', label: 'Status', render: (item) => <StatusBadge status={item.status} /> },
];

const formFields = [
  { key: 'name', label: 'Name', required: true },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'phone', label: 'Phone' },
  { key: 'gstin', label: 'GSTIN' },
  { key: 'address', label: 'Address', type: 'textarea' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'pincode', label: 'Pincode' },
  { key: 'payment_terms', label: 'Payment Terms' },
  { key: 'opening_balance', label: 'Opening Balance', type: 'number' },
  { key: 'status', label: 'Status', type: 'select', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
];

export default function SupplierDetail() {
  return <EntityDetailPage entityName="Supplier" titleKey="name" fields={fields} formFields={formFields} backPath="/suppliers" />;
}