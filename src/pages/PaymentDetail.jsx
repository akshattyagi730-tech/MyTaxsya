import EntityDetailPage from '@/Components/EntityDetailPage';
import StatusBadge from '@/Components/StatusBadge';

const fields = [
  { key: 'payment_number', label: 'Payment Number' },
  { key: 'customer_name', label: 'Customer' },
  { key: 'amount', label: 'Amount', type: 'currency' },
  { key: 'payment_mode', label: 'Payment Mode', render: (item) => <span className="capitalize">{item.payment_mode}</span> },
  { key: 'date', label: 'Date', type: 'date' },
  { key: 'reference_number', label: 'Reference Number' },
  { key: 'status', label: 'Status', render: (item) => <StatusBadge status={item.status} /> },
  { key: 'notes', label: 'Notes' },
];

const formFields = [
  { key: 'payment_number', label: 'Payment Number', required: true },
  { key: 'customer_name', label: 'Customer Name' },
  { key: 'amount', label: 'Amount', type: 'number', required: true },
  {
    key: 'payment_mode', label: 'Payment Mode', type: 'select', options: [
      { value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' },
      { value: 'bank', label: 'Bank Transfer' }, { value: 'card', label: 'Card' },
      { value: 'cheque', label: 'Cheque' }, { value: 'online', label: 'Online' },
    ]
  },
  { key: 'date', label: 'Date', type: 'date', required: true },
  { key: 'reference_number', label: 'Reference Number' },
  {
    key: 'status', label: 'Status', type: 'select', options: [
      { value: 'success', label: 'Success' }, { value: 'pending', label: 'Pending' }, { value: 'failed', label: 'Failed' },
    ]
  },
  { key: 'notes', label: 'Notes' },
];

export default function PaymentDetail() {
  return <EntityDetailPage entityName="Payment" titleKey="payment_number" fields={fields} formFields={formFields} backPath="/payments" />;
}