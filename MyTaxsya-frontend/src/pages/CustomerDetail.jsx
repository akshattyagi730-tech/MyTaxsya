import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Pencil, Trash2, Mail, Phone, MapPin, FileText } from 'lucide-react';
import api from '@/services/api';
import { Button } from '@/components/ui/button';
import StatusBadge from '@/components/StatusBadge';
import ConfirmDialog from '@/components/ConfirmDialog';
import EntityFormDialog from '@/components/EntityFormDialog';
import { formatINR, formatDate } from '@/utils/format';

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

export default function CustomerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const cRes = await api.get(`/entities/Customer/${id}`);
        setCustomer(cRes.data);
        const invsRes = await api.get(`/entities/Invoice`, { params: { customer_id: id, limit: 50 } });
        setInvoices(invsRes.data);
      } catch (e) { /* no related invoices or error */ }
      setLoading(false);
    };
    load();
  }, [id]);

  if (loading) return <div className="p-8"><div className="h-64 rounded-xl bg-muted animate-pulse" /></div>;
  if (!customer) return <div className="p-8 text-center text-muted-foreground">Customer not found</div>;

  const outstanding = invoices.filter(i => i.status === 'sent' || i.status === 'overdue').reduce((s, i) => s + (i.balance_due || i.total || 0), 0);
  const totalInvoiced = invoices.reduce((s, i) => s + (i.total || 0), 0);

  const handleUpdate = async (data) => {
    setSaving(true);
    try {
      const res = await api.put(`/entities/Customer/${id}`, data);
      setCustomer(res.data);
      setEditOpen(false);
    } finally { setSaving(false); }
  };

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/customers')}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="font-heading text-2xl font-bold tracking-tight">{customer.name}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{customer.email || 'No email'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-2" onClick={() => setEditOpen(true)}>
            <Pencil className="w-4 h-4" /> Edit
          </Button>
          <Button variant="outline" className="text-destructive gap-2" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="w-4 h-4" /> Delete
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-card border border-border rounded-xl p-5">
          <h2 className="font-heading font-semibold mb-4">Contact Information</h2>
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-sm"><Mail className="w-4 h-4 text-muted-foreground" /> {customer.email || '—'}</div>
            <div className="flex items-center gap-3 text-sm"><Phone className="w-4 h-4 text-muted-foreground" /> {customer.phone || '—'}</div>
            <div className="flex items-center gap-3 text-sm"><MapPin className="w-4 h-4 text-muted-foreground" /> {[customer.city, customer.state, customer.pincode].filter(Boolean).join(', ') || '—'}</div>
          </div>
          <div className="mt-4 pt-4 border-t border-border space-y-2.5 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">GSTIN</span><span className="font-medium">{customer.gstin || '—'}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Credit Limit</span><span className="font-medium">{formatINR(customer.credit_limit)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Status</span><StatusBadge status={customer.status} /></div>
          </div>
        </div>

        <div className="lg:col-span-2 bg-card border border-border rounded-xl p-5">
          <h2 className="font-heading font-semibold mb-4">Financial Summary</h2>
          <div className="grid grid-cols-3 gap-4">
            <div><p className="text-sm text-muted-foreground">Total Invoiced</p><p className="text-xl font-bold">{formatINR(totalInvoiced)}</p></div>
            <div><p className="text-sm text-muted-foreground">Outstanding</p><p className="text-xl font-bold text-accent">{formatINR(outstanding)}</p></div>
            <div><p className="text-sm text-muted-foreground">Total Invoices</p><p className="text-xl font-bold">{invoices.length}</p></div>
          </div>
          {customer.billing_address && (
            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-sm text-muted-foreground mb-1">Billing Address</p>
              <p className="text-sm">{customer.billing_address}</p>
            </div>
          )}
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="p-5 pb-4"><h2 className="font-heading font-semibold text-lg">Recent Invoices</h2></div>
        {invoices.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-y border-border bg-muted/30">
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase px-5 py-2.5">Invoice</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase px-5 py-2.5">Date</th>
                  <th className="text-right text-xs font-medium text-muted-foreground uppercase px-5 py-2.5">Amount</th>
                  <th className="text-center text-xs font-medium text-muted-foreground uppercase px-5 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => (
                  <tr key={inv.id} className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer"
                    onClick={() => navigate(`/invoices/${inv.id}`)}>
                    <td className="px-5 py-3 text-sm font-medium">{inv.invoice_number}</td>
                    <td className="px-5 py-3 text-sm text-muted-foreground">{formatDate(inv.invoice_date)}</td>
                    <td className="px-5 py-3 text-sm font-medium text-right">{formatINR(inv.total)}</td>
                    <td className="px-5 py-3 text-center"><StatusBadge status={inv.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-sm text-muted-foreground">
            <FileText className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />No invoices yet
          </div>
        )}
      </div>

      <EntityFormDialog open={editOpen} onClose={() => setEditOpen(false)}
        onSubmit={handleUpdate} title="Edit Customer" fields={fields}
        initialData={customer} loading={saving} />
      <ConfirmDialog open={deleteOpen} onClose={() => setDeleteOpen(false)}
        onConfirm={async () => { await api.delete(`/entities/Customer/${id}`); navigate('/customers'); }}
        title="Delete Customer" description={`Are you sure you want to delete ${customer.name}?`} />
    </div>
  );
}