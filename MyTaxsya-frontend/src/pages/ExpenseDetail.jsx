import EntityDetailPage from '@/components/EntityDetailPage';
import StatusBadge from '@/components/StatusBadge';

const fields = [
  { key: 'title', label: 'Title' },
  { key: 'category', label: 'Category', render: (item) => <span className="capitalize">{item.category?.replace('_', ' ')}</span> },
  { key: 'amount', label: 'Amount', type: 'currency' },
  { key: 'payment_mode', label: 'Payment Mode', render: (item) => <span className="capitalize">{item.payment_mode}</span> },
  { key: 'date', label: 'Date', type: 'date' },
  { key: 'vendor', label: 'Vendor' },
  { key: 'gst_amount', label: 'GST Amount', type: 'currency' },
  { key: 'status', label: 'Status', render: (item) => <StatusBadge status={item.status} /> },
  { key: 'notes', label: 'Notes' },
];

const formFields = [
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

export default function ExpenseDetail() {
  return <EntityDetailPage entityName="Expense" titleKey="title" fields={fields} formFields={formFields} backPath="/expenses" />;
}