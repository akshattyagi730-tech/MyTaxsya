import { useState, useEffect, useMemo } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';
import api from '@/services/api';
import { formatINR } from '@/utils/format';

export default function InvoiceForm({ open, onClose, onSaved, invoice = null }) {
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [business, setBusiness] = useState(null);

  const [formData, setFormData] = useState({
    invoice_number: `INV-${Date.now().toString().slice(-6)}`,
    customer_id: '',
    customer_name: '',
    invoice_date: new Date().toISOString().split('T')[0],
    due_date: '',
    status: 'draft',
    notes: '',
    items: [{ product_id: '', description: '', quantity: 1, rate: 0, gst_rate: 18 }],
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    if (invoice) {
      setFormData({
        invoice_number: invoice.invoice_number || '',
        customer_id: invoice.customer_id || '',
        customer_name: invoice.customer_name || '',
        invoice_date: invoice.invoice_date || '',
        due_date: invoice.due_date || '',
        status: invoice.status || 'draft',
        notes: invoice.notes || '',
        items: invoice.items?.length
          ? invoice.items.map(item => ({
            product_id: item.product_id || '',
            description: item.description || '',
            quantity: Number(item.quantity) || 0,
            rate: Number(item.rate) || 0,
            gst_rate: Number(item.gst_rate) || 0,
          }))
          : [{ product_id: '', description: '', quantity: 1, rate: 0, gst_rate: 18 }],
      });
    } else {
      setFormData({
        invoice_number: `INV-${Date.now().toString().slice(-6)}`,
        customer_id: '',
        customer_name: '',
        invoice_date: new Date().toISOString().split('T')[0],
        due_date: '',
        status: 'draft',
        notes: '',
        items: [{ product_id: '', description: '', quantity: 1, rate: 0, gst_rate: 18 }],
      });
    }
    setSaveError('');
  }, [invoice, open]);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [custRes, prodRes, bizRes] = await Promise.all([
          api.get('/entities/Customer', { params: { sort: '-created_date', limit: 200 } }),
          api.get('/entities/Product', { params: { sort: '-created_date', limit: 200 } }),
          api.get('/entities/Business', { params: { sort: '-created_date', limit: 10 } })
        ]);
        setCustomers(custRes.data);
        setProducts(prodRes.data);
        if (bizRes.data && bizRes.data.length > 0) {
          setBusiness(bizRes.data[0]);
        }
      } catch (err) {
        console.error("Failed to load invoice form context data:", err);
      }
    };
    loadData();
  }, []);

  const selectedCustomer = useMemo(() => {
    return customers.find(c => c.id === formData.customer_id);
  }, [customers, formData.customer_id]);

  const isInterstate = useMemo(() => {
    if (!business?.state || !selectedCustomer?.state) return false;
    return business.state.trim().toLowerCase() !== selectedCustomer.state.trim().toLowerCase();
  }, [business, selectedCustomer]);

  const subtotal = formData.items.reduce((s, item) => s + (item.quantity * item.rate), 0);
  const totalGst = formData.items.reduce((s, item) => s + (item.quantity * item.rate * item.gst_rate / 100), 0);

  // Tax determination (CGST + SGST vs IGST)
  const cgst = isInterstate ? 0 : totalGst / 2;
  const sgst = isInterstate ? 0 : totalGst / 2;
  const igst = isInterstate ? totalGst : 0;

  const rawTotal = subtotal + totalGst;
  const total = Math.round(rawTotal);
  const roundOff = Number((total - rawTotal).toFixed(2));

  const handleItemChange = (index, field, value) => {
    const items = [...formData.items];
    items[index] = { ...items[index], [field]: value };
    setFormData(prev => ({ ...prev, items }));
  };

  const handleProductSelect = (index, productId) => {
    const items = [...formData.items];
    if (productId === 'custom') {
      items[index] = { ...items[index], product_id: '', description: '', rate: 0, gst_rate: 18 };
    } else {
      const prod = products.find(p => p.id === productId);
      if (prod) {
        items[index] = {
          ...items[index],
          product_id: productId,
          description: prod.name,
          rate: prod.selling_price,
          gst_rate: prod.gst_rate !== undefined ? prod.gst_rate : 18
        };
      }
    }
    setFormData(prev => ({ ...prev, items }));
  };

  const addItem = () => {
    setFormData(prev => ({ ...prev, items: [...prev.items, { product_id: '', description: '', quantity: 1, rate: 0, gst_rate: 18 }] }));
  };

  const removeItem = (index) => {
    setFormData(prev => ({ ...prev, items: prev.items.filter((_, i) => i !== index) }));
  };

  const handleCustomerChange = (customerId) => {
    const customer = customers.find(c => c.id === customerId);
    setFormData(prev => ({ ...prev, customer_id: customerId, customer_name: customer?.name || '' }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.customer_id) {
      setSaveError('Please select a customer.');
      return;
    }
    setSaving(true);
    setSaveError('');
    const payload = {
      ...formData,
      subtotal,
      cgst,
      sgst,
      igst,
      total,
      paid_amount: invoice?.paid_amount || 0,
      balance_due: total - (invoice?.paid_amount || 0),
    };
    try {
      if (invoice?.id) {
        await api.put(`/entities/Invoice/${invoice.id}`, payload);
      } else {
        await api.post('/entities/Invoice', payload);
      }
      onSaved();
      onClose();
    } catch (err) {
      setSaveError(err.message || 'Error saving invoice.');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const customerOptions = [...customers];
  if (formData.customer_id && !customers.find(c => c.id === formData.customer_id) && formData.customer_name) {
    customerOptions.unshift({ id: formData.customer_id, name: formData.customer_name });
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{invoice ? 'Edit Invoice' : 'Create Invoice'}</DialogTitle>
        </DialogHeader>
        {saveError && (
          <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-lg p-3 text-sm text-red-600 dark:text-red-400 font-medium">
            {saveError}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Customer *</Label>
              <Select value={formData.customer_id} onValueChange={handleCustomerChange}>
                <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                <SelectContent>
                  {customerOptions.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {selectedCustomer && (
                <p className="text-[11px] text-muted-foreground">
                  Billing State: <span className="font-semibold">{selectedCustomer.state || '—'}</span> {isInterstate ? '(Inter-state IGST)' : '(Intra-state CGST+SGST)'}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Invoice Number *</Label>
              <Input value={formData.invoice_number}
                onChange={e => setFormData(prev => ({ ...prev, invoice_number: e.target.value }))} required />
            </div>
            <div className="space-y-1.5">
              <Label>Invoice Date *</Label>
              <Input type="date" value={formData.invoice_date}
                onChange={e => setFormData(prev => ({ ...prev, invoice_date: e.target.value }))} required />
            </div>
            <div className="space-y-1.5">
              <Label>Due Date</Label>
              <Input type="date" value={formData.due_date}
                onChange={e => setFormData(prev => ({ ...prev, due_date: e.target.value }))} />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Line Items</Label>
              <Button type="button" variant="outline" size="sm" onClick={addItem}>
                <Plus className="w-4 h-4 mr-1" /> Add Item
              </Button>
            </div>
            <div className="border border-border rounded-lg overflow-x-auto">
              <table className="w-full min-w-[700px]">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="text-left text-xs px-3 py-2 w-48">Product/Item</th>
                    <th className="text-left text-xs px-3 py-2">Description</th>
                    <th className="text-right text-xs px-3 py-2 w-20">Qty</th>
                    <th className="text-right text-xs px-3 py-2 w-28">Rate</th>
                    <th className="text-right text-xs px-3 py-2 w-20">GST%</th>
                    <th className="text-right text-xs px-3 py-2 w-28">Amount</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {formData.items.map((item, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-2 py-2">
                        <Select value={item.product_id || 'custom'} onValueChange={(val) => handleProductSelect(i, val)}>
                          <SelectTrigger className="h-9"><SelectValue placeholder="Custom Line Item" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="custom">Custom Item...</SelectItem>
                            {products.map(p => (
                              <SelectItem key={p.id} value={p.id}>{p.name} {p.sku ? `(${p.sku})` : ''}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-2">
                        <Input value={item.description}
                          onChange={e => handleItemChange(i, 'description', e.target.value)}
                          placeholder="Item description" className="h-9" required />
                      </td>
                      <td className="px-2 py-2">
                        <Input type="number" value={item.quantity}
                          onChange={e => handleItemChange(i, 'quantity', Number(e.target.value))}
                          className="h-9 text-right" min="1" required />
                      </td>
                      <td className="px-2 py-2">
                        <Input type="number" value={item.rate}
                          onChange={e => handleItemChange(i, 'rate', Number(e.target.value))}
                          className="h-9 text-right" min="0" required />
                      </td>
                      <td className="px-2 py-2">
                        <Input type="number" value={item.gst_rate}
                          onChange={e => handleItemChange(i, 'gst_rate', Number(e.target.value))}
                          className="h-9 text-right" min="0" required />
                      </td>
                      <td className="px-2 py-2 text-right text-sm font-medium">
                        {formatINR(item.quantity * item.rate)}
                      </td>
                      <td className="px-2 py-2 text-center">
                        {formData.items.length > 1 && (
                          <button type="button" onClick={() => removeItem(i)}
                            className="text-red-500 hover:text-red-700">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-end">
            <div className="w-80 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{formatINR(subtotal)}</span></div>
              {cgst > 0 && <div className="flex justify-between"><span className="text-muted-foreground">CGST</span><span>{formatINR(cgst)}</span></div>}
              {sgst > 0 && <div className="flex justify-between"><span className="text-muted-foreground">SGST</span><span>{formatINR(sgst)}</span></div>}
              {igst > 0 && <div className="flex justify-between"><span className="text-muted-foreground">IGST</span><span>{formatINR(igst)}</span></div>}
              {roundOff !== 0 && (
                <div className="flex justify-between text-muted-foreground text-xs">
                  <span>Round-off</span>
                  <span>{roundOff > 0 ? `+${formatINR(roundOff)}` : formatINR(roundOff)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold border-t border-border pt-1.5 text-base"><span>Total</span><span>{formatINR(total)}</span></div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={formData.status} onValueChange={v => setFormData(prev => ({ ...prev, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="overdue">Overdue</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Input value={formData.notes}
              onChange={e => setFormData(prev => ({ ...prev, notes: e.target.value }))}
              placeholder="Additional notes" />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save Invoice'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}