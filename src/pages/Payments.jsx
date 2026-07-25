import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import PageHeader from '@/Components/PageHeader';
import DataTable from '@/Components/DataTable';
import ConfirmDialog from '@/Components/ConfirmDialog';
import StatusBadge from '@/Components/StatusBadge';
import { useEntityCrud } from '@/hooks/useEntityCrud';
import { Button } from '@/Components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/Components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/Components/ui/dialog';
import { Input } from '@/Components/ui/input';
import { Label } from '@/Components/ui/label';
import apiClient from '@/api/apiClient';
import { formatINR, formatDate } from '@/lib/format';

const columns = [
  { key: 'payment_number', label: 'Payment #', sortable: true },
  { key: 'customer_name', label: 'Customer', sortable: true },
  { key: 'amount', label: 'Amount', sortable: true, render: (r) => <span className="font-medium">{formatINR(r.amount)}</span> },
  { key: 'payment_mode', label: 'Mode', render: (r) => <span className="capitalize">{r.payment_mode}</span> },
  { key: 'date', label: 'Date', sortable: true, render: (r) => formatDate(r.date) },
  { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
];

export default function Payments() {
  const navigate = useNavigate();
  const { items, loading, error, create, update, remove, saving, deleting } = useEntityCrud('Payment');
  const [formOpen, setFormOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [deleteItem, setDeleteItem] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');

  const [customers, setCustomers] = useState([]);
  const [unpaidInvoices, setUnpaidInvoices] = useState([]);

  const [formState, setFormState] = useState({
    payment_number: '',
    customer_id: '',
    invoice_id: '',
    amount: '',
    payment_mode: 'upi',
    date: new Date().toISOString().split('T')[0],
    reference_number: '',
    status: 'success',
    notes: ''
  });
  const [saveError, setSaveError] = useState('');

  // Load customers
  useEffect(() => {
    const loadCustomers = async () => {
      try {
        const res = await apiClient.get('/entities/Customer', { params: { sort: 'name', limit: 200 } });
        setCustomers(res.data);
      } catch (err) {
        console.error("Failed to load customers for payment form:", err);
      }
    };
    loadCustomers();
  }, []);

  // Load unpaid invoices when customer changes
  useEffect(() => {
    const loadInvoices = async () => {
      if (!formState.customer_id) {
        setUnpaidInvoices([]);
        return;
      }
      try {
        const res = await apiClient.get('/entities/Invoice', {
          params: { customer_id: formState.customer_id, limit: 100 }
        });
        // Show unpaid invoices (sent, overdue)
        // If we are editing, we should also include the invoice currently linked to the payment even if paid
        setUnpaidInvoices(res.data.filter(inv => {
          if (inv.status === 'sent' || inv.status === 'overdue') return true;
          if (editItem && inv.id === editItem.invoice_id) return true;
          return false;
        }));
      } catch (err) {
        console.error("Failed to load customer invoices:", err);
      }
    };
    loadInvoices();
  }, [formState.customer_id, editItem]);

  // Pre-fill form when editItem or formOpen changes
  useEffect(() => {
    if (editItem) {
      setFormState({
        payment_number: editItem.payment_number || '',
        customer_id: editItem.customer_id || '',
        invoice_id: editItem.invoice_id || '',
        amount: editItem.amount || '',
        payment_mode: editItem.payment_mode || 'upi',
        date: editItem.date ? editItem.date.split('T')[0] : new Date().toISOString().split('T')[0],
        reference_number: editItem.reference_number || '',
        status: editItem.status || 'success',
        notes: editItem.notes || ''
      });
    } else {
      setFormState({
        payment_number: `PAY-${Date.now().toString().slice(-6)}`,
        customer_id: '',
        invoice_id: '',
        amount: '',
        payment_mode: 'upi',
        date: new Date().toISOString().split('T')[0],
        reference_number: '',
        status: 'success',
        notes: ''
      });
    }
    setSaveError('');
  }, [editItem, formOpen]);

  const filtered = useMemo(() =>
    statusFilter === 'all' ? items : items.filter(i => i.status === statusFilter),
    [items, statusFilter]
  );

  const handleInvoiceChange = (invoiceId) => {
    if (invoiceId === 'none') {
      setFormState(prev => ({ ...prev, invoice_id: '', amount: '' }));
      return;
    }
    const inv = unpaidInvoices.find(i => i.id === invoiceId);
    setFormState(prev => ({
      ...prev,
      invoice_id: invoiceId,
      amount: inv ? String(inv.balance_due !== undefined ? inv.balance_due : inv.total) : prev.amount
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formState.customer_id) {
      setSaveError('Please select a customer.');
      return;
    }
    if (!formState.amount || Number(formState.amount) <= 0) {
      setSaveError('Please enter a valid amount.');
      return;
    }

    setSaveError('');
    try {
      const selectedCust = customers.find(c => c.id === formState.customer_id);
      const payload = {
        ...formState,
        amount: Number(formState.amount),
        customer_name: selectedCust ? selectedCust.name : ''
      };
      if (editItem) {
        await update(editItem.id, payload);
      } else {
        await create(payload);
      }
      setFormOpen(false);
    } catch (err) {
      setSaveError(err.message || 'Error saving payment.');
    }
  };

  return (
    <div className="max-w-[1400px] mx-auto">
      <PageHeader title="Payments" subtitle={`${items.length} total payments`}>
        <Button className="gap-2" onClick={() => { setEditItem(null); setFormOpen(true); }}>
          <Plus className="w-4 h-4" /> Record Payment
        </Button>
      </PageHeader>

      <DataTable
        data={filtered} columns={columns} loading={loading} error={error}
        searchKeys={['payment_number', 'customer_name', 'reference_number']}
        onRowClick={(row) => navigate(`/payments/${row.id}`)}
        toolbar={
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36 h-10"><SelectValue placeholder="All Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
        }
        actions={(row) => (
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); setEditItem(row); setFormOpen(true); }}>
              <Pencil className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" className="text-red-600" onClick={(e) => { e.stopPropagation(); setDeleteItem(row); }}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        )}
      />

      {/* Record Payment Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editItem ? 'Edit Payment' : 'Record Payment'}</DialogTitle>
          </DialogHeader>
          {saveError && (
            <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-lg p-3 text-sm text-red-600 dark:text-red-400 font-medium">
              {saveError}
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Customer *</Label>
              <Select value={formState.customer_id} onValueChange={(val) => setFormState(prev => ({ ...prev, customer_id: val, invoice_id: '', amount: '' }))}>
                <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                <SelectContent>
                  {customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Link to Invoice</Label>
              <Select value={formState.invoice_id || 'none'} onValueChange={handleInvoiceChange} disabled={!formState.customer_id}>
                <SelectTrigger><SelectValue placeholder="No Invoice (Advance Payment)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Invoice (Advance Payment)</SelectItem>
                  {unpaidInvoices.map(inv => (
                    <SelectItem key={inv.id} value={inv.id}>
                      {inv.invoice_number} — {formatINR(inv.total)} (Due: {formatINR(inv.balance_due)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Payment Number *</Label>
                <Input value={formState.payment_number} onChange={e => setFormState(prev => ({ ...prev, payment_number: e.target.value }))} required />
              </div>
              <div className="space-y-1.5">
                <Label>Amount (INR) *</Label>
                <Input type="number" value={formState.amount} onChange={e => setFormState(prev => ({ ...prev, amount: e.target.value }))} placeholder="0" min="0.01" step="any" required />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Payment Mode *</Label>
                <Select value={formState.payment_mode} onValueChange={v => setFormState(prev => ({ ...prev, payment_mode: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="upi">UPI</SelectItem>
                    <SelectItem value="bank">Bank Transfer</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="cheque">Cheque</SelectItem>
                    <SelectItem value="online">Online</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Date *</Label>
                <Input type="date" value={formState.date} onChange={e => setFormState(prev => ({ ...prev, date: e.target.value }))} required />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Reference Number</Label>
                <Input value={formState.reference_number} onChange={e => setFormState(prev => ({ ...prev, reference_number: e.target.value }))} placeholder="Txn ID, Cheque #" />
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={formState.status} onValueChange={v => setFormState(prev => ({ ...prev, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="success">Success</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Input value={formState.notes} onChange={e => setFormState(prev => ({ ...prev, notes: e.target.value }))} placeholder="Payment details..." />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save Payment'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={!!deleteItem} onClose={() => setDeleteItem(null)}
        onConfirm={async () => { await remove(deleteItem.id); setDeleteItem(null); }}
        loading={deleting} title="Delete Payment"
        description={`Are you sure you want to delete ${deleteItem?.payment_number}? This will revert any associated invoice balance updates.`} />
    </div>
  );
}