import { useState, useEffect, useMemo, useRef } from 'react';
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
    discount: 0,
    cgst: 0,
    sgst: 0,
    igst: 0,
    items: [{ product_id: '', description: '', quantity: 1, rate: 0, gst_rate: 18 }],
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  // Once the user (or an imported invoice) supplies an explicit CGST/SGST/IGST
  // breakdown, stop silently recalculating it from items so real printed values
  // aren't overwritten. A ref (not state) is required here: the invoice-load
  // effect below and the auto-calc effect can both run within the same commit,
  // and a state update from the first wouldn't be visible to the second until
  // the next render — a ref updates synchronously, closing that race.
  const taxOverriddenRef = useRef(false);

  useEffect(() => {
    if (invoice) {
      const formatDateForInput = (dStr) => {
        if (!dStr) return '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(dStr)) return dStr;
        if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dStr)) {
          const [d, m, y] = dStr.split('/');
          return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
        }
        const dObj = new Date(dStr);
        return !isNaN(dObj.getTime()) ? dObj.toISOString().split('T')[0] : dStr;
      };

      const custName = invoice.customer_name || invoice.customer || invoice.buyer?.name || '';
      let custId = invoice.customer_id || '';
      if (!custId && custName && customers.length > 0) {
        const found = customers.find(c => c.name.toLowerCase() === custName.toLowerCase());
        if (found) custId = found.id;
      }
      if (!custId && custName) {
        custId = `temp_${custName.replace(/\s+/g, '_')}`;
      }

      setFormData({
        invoice_number: invoice.invoice_number || '',
        customer_id: custId,
        customer_name: custName,
        invoice_date: formatDateForInput(invoice.invoice_date) || new Date().toISOString().split('T')[0],
        due_date: formatDateForInput(invoice.due_date) || '',
        status: invoice.status || 'draft',
        notes: invoice.notes || '',
        discount: Number(invoice.discount) || 0,
        cgst: Number(invoice.cgst) || 0,
        sgst: Number(invoice.sgst) || 0,
        igst: Number(invoice.igst) || 0,
        items: invoice.items?.length
          ? invoice.items.map(item => ({
            product_id: item.product_id || '',
            description: item.description || '',
            quantity: Number(item.quantity) || 1,
            rate: Number(item.rate) || 0,
            gst_rate: Number(item.gst_rate) !== undefined ? Number(item.gst_rate) : 18,
          }))
          : [{ product_id: '', description: '', quantity: 1, rate: 0, gst_rate: 18 }],
      });
      // An existing invoice's stored CGST/SGST/IGST reflects what was actually
      // printed/imported — don't silently recompute it away as items are viewed.
      taxOverriddenRef.current = true;
    } else {
      setFormData({
        invoice_number: `INV-${Date.now().toString().slice(-6)}`,
        customer_id: '',
        customer_name: '',
        invoice_date: new Date().toISOString().split('T')[0],
        due_date: '',
        status: 'draft',
        notes: '',
        discount: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
        items: [{ product_id: '', description: '', quantity: 1, rate: 0, gst_rate: 18 }],
      });
      taxOverriddenRef.current = false;
    }
    setSaveError('');
  }, [invoice, open, customers]);

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
  const discount = Number(formData.discount) || 0;

  // Suggested CGST+SGST / IGST split, derived from line items and billing state.
  const autoCgst = isInterstate ? 0 : totalGst / 2;
  const autoSgst = isInterstate ? 0 : totalGst / 2;
  const autoIgst = isInterstate ? totalGst : 0;

  // Keep CGST/SGST/IGST in sync with items until the user (or an imported
  // invoice) sets an explicit value — then respect that value instead.
  useEffect(() => {
    if (!taxOverriddenRef.current) {
      setFormData(prev => ({ ...prev, cgst: autoCgst, sgst: autoSgst, igst: autoIgst }));
    }
  }, [autoCgst, autoSgst, autoIgst]);

  const cgst = Number(formData.cgst) || 0;
  const sgst = Number(formData.sgst) || 0;
  const igst = Number(formData.igst) || 0;

  const handleTaxChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value === '' ? '' : Number(value) }));
    taxOverriddenRef.current = true;
  };

  const rawTotal = subtotal - discount + cgst + sgst + igst;
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
      discount,
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
  if (formData.customer_name && !customerOptions.find(c => c.id === formData.customer_id || c.name.toLowerCase() === formData.customer_name.toLowerCase())) {
    const fallbackId = formData.customer_id || `temp_${formData.customer_name.replace(/\s+/g, '_')}`;
    customerOptions.unshift({ id: fallbackId, name: formData.customer_name });
  }
  // Radix's Select.Value only shows a selected item's label once that item has
  // actually mounted (i.e. the dropdown has been opened at least once), so a
  // freshly-opened edit dialog can show the placeholder even though a valid
  // customer_id is set. Resolve the label ourselves and pass it in directly.
  const selectedCustomerLabel = customerOptions.find(c => c.id === formData.customer_id)?.name || '';

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
                <SelectTrigger>
                  <SelectValue placeholder="Select customer">{selectedCustomerLabel || undefined}</SelectValue>
                </SelectTrigger>
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
                          className="h-9 text-right" min="1" step="any" required />
                      </td>
                      <td className="px-2 py-2">
                        <Input type="number" value={item.rate}
                          onChange={e => handleItemChange(i, 'rate', Number(e.target.value))}
                          className="h-9 text-right" min="0" step="0.01" required />
                      </td>
                      <td className="px-2 py-2">
                        <Input type="number" value={item.gst_rate}
                          onChange={e => handleItemChange(i, 'gst_rate', Number(e.target.value))}
                          className="h-9 text-right" min="0" step="0.01" required />
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
              <div className="flex justify-between items-center gap-2">
                <Label htmlFor="invoice-discount" className="text-muted-foreground font-normal">Discount</Label>
                <Input id="invoice-discount" type="number" min="0" step="0.01"
                  value={formData.discount}
                  onChange={e => setFormData(prev => ({ ...prev, discount: e.target.value === '' ? '' : Number(e.target.value) }))}
                  className="h-7 w-28 text-right" placeholder="0" />
              </div>
              {isInterstate ? (
                <div className="flex justify-between items-center gap-2">
                  <Label htmlFor="invoice-igst" className="text-muted-foreground font-normal">IGST</Label>
                  <Input id="invoice-igst" type="number" min="0" step="0.01"
                    value={formData.igst}
                    onChange={e => handleTaxChange('igst', e.target.value)}
                    className="h-7 w-28 text-right" placeholder="0" />
                </div>
              ) : (
                <>
                  <div className="flex justify-between items-center gap-2">
                    <Label htmlFor="invoice-cgst" className="text-muted-foreground font-normal">CGST</Label>
                    <Input id="invoice-cgst" type="number" min="0" step="0.01"
                      value={formData.cgst}
                      onChange={e => handleTaxChange('cgst', e.target.value)}
                      className="h-7 w-28 text-right" placeholder="0" />
                  </div>
                  <div className="flex justify-between items-center gap-2">
                    <Label htmlFor="invoice-sgst" className="text-muted-foreground font-normal">SGST</Label>
                    <Input id="invoice-sgst" type="number" min="0" step="0.01"
                      value={formData.sgst}
                      onChange={e => handleTaxChange('sgst', e.target.value)}
                      className="h-7 w-28 text-right" placeholder="0" />
                  </div>
                </>
              )}
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