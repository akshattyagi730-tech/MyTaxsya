import { useState, useEffect, useMemo } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';
import api from '@/services/api';
import { formatINR } from '@/utils/format';
import { validateGstin } from '@/utils/gstin';

const ITC_INELIGIBLE_REASONS = [
  { value: 'motor_vehicle', label: 'Motor vehicle' },
  { value: 'food_beverage_outdoor_catering', label: 'Food/beverage & outdoor catering' },
  { value: 'employee_benefit', label: 'Employee benefit (leave/health/life cover)' },
  { value: 'personal_use', label: 'Personal use' },
  { value: 'works_contract_immovable_property', label: 'Works contract for immovable property' },
  { value: 'membership_club_fitness', label: 'Club / fitness / membership' },
  { value: 'other_blocked', label: 'Other blocked credit (Sec 17(5))' },
];

const emptyItem = { description: '', hsn: '', quantity: 1, rate: 0, gst_rate: 18 };

export default function PurchaseBillForm({ open, onClose, onSaved, bill = null }) {
  const [suppliers, setSuppliers] = useState([]);
  const [business, setBusiness] = useState(null);

  const [formData, setFormData] = useState({
    bill_number: '',
    supplier_id: '',
    supplier_name: '',
    supplier_gstin: '',
    bill_date: new Date().toISOString().split('T')[0],
    due_date: '',
    status: 'draft',
    payment_status: 'unpaid',
    itc_eligible: true,
    itc_ineligible_reason: '',
    notes: '',
    discount: 0,
    items: [{ ...emptyItem }],
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    const loadData = async () => {
      try {
        const [supRes, bizRes] = await Promise.all([
          api.get('/entities/Supplier', { params: { sort: '-created_date', limit: 200 } }),
          api.get('/entities/Business', { params: { sort: '-created_date', limit: 10 } }),
        ]);
        setSuppliers(supRes.data);
        if (bizRes.data && bizRes.data.length > 0) setBusiness(bizRes.data[0]);
      } catch (err) {
        console.error('Failed to load purchase bill form context data:', err);
      }
    };
    loadData();
  }, []);

  useEffect(() => {
    const formatDateForInput = (dStr) => {
      if (!dStr) return '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(dStr)) return dStr;
      const dObj = new Date(dStr);
      return !isNaN(dObj.getTime()) ? dObj.toISOString().split('T')[0] : '';
    };

    if (bill) {
      const supName = bill.supplier_name || '';
      let supId = bill.supplier_id || '';
      if (!supId && supName && suppliers.length > 0) {
        const found = suppliers.find(s => s.name.toLowerCase() === supName.toLowerCase());
        if (found) supId = found.id;
      }
      if (!supId && supName) supId = `temp_${supName.replace(/\s+/g, '_')}`;

      setFormData({
        bill_number: bill.bill_number || '',
        supplier_id: supId,
        supplier_name: supName,
        supplier_gstin: bill.supplier_gstin || '',
        bill_date: formatDateForInput(bill.bill_date) || new Date().toISOString().split('T')[0],
        due_date: formatDateForInput(bill.due_date) || '',
        status: bill.status || 'draft',
        payment_status: bill.payment_status || 'unpaid',
        itc_eligible: bill.itc_eligible !== false,
        itc_ineligible_reason: bill.itc_ineligible_reason || '',
        notes: bill.notes || '',
        discount: Number(bill.discount) || 0,
        items: bill.items?.length
          ? bill.items.map(item => ({
            description: item.description || '',
            hsn: item.hsn || '',
            quantity: Number(item.quantity) || 1,
            rate: Number(item.rate) || 0,
            gst_rate: Number(item.gst_rate) !== undefined ? Number(item.gst_rate) : 18,
          }))
          : [{ ...emptyItem }],
      });
    } else {
      setFormData({
        bill_number: '', supplier_id: '', supplier_name: '', supplier_gstin: '',
        bill_date: new Date().toISOString().split('T')[0], due_date: '',
        status: 'draft', payment_status: 'unpaid', itc_eligible: true, itc_ineligible_reason: '',
        notes: '', discount: 0, items: [{ ...emptyItem }],
      });
    }
    setSaveError('');
  }, [bill, open, suppliers]);

  const selectedSupplier = useMemo(() => suppliers.find(s => s.id === formData.supplier_id), [suppliers, formData.supplier_id]);

  const isInterstate = useMemo(() => {
    if (!business?.state || !selectedSupplier?.state) return false;
    return business.state.trim().toLowerCase() !== selectedSupplier.state.trim().toLowerCase();
  }, [business, selectedSupplier]);

  const gstinCheck = useMemo(() => formData.supplier_gstin ? validateGstin(formData.supplier_gstin) : null, [formData.supplier_gstin]);

  const taxableValue = formData.items.reduce((s, item) => s + (Number(item.quantity) * Number(item.rate)), 0);
  const totalGst = formData.items.reduce((s, item) => s + (Number(item.quantity) * Number(item.rate) * Number(item.gst_rate) / 100), 0);
  const discount = Number(formData.discount) || 0;

  const cgst = isInterstate ? 0 : totalGst / 2;
  const sgst = isInterstate ? 0 : totalGst / 2;
  const igst = isInterstate ? totalGst : 0;

  const rawTotal = taxableValue - discount + cgst + sgst + igst;
  const total = Math.round(rawTotal);
  const roundOff = Number((total - rawTotal).toFixed(2));

  const handleItemChange = (index, field, value) => {
    const items = [...formData.items];
    items[index] = { ...items[index], [field]: value };
    setFormData(prev => ({ ...prev, items }));
  };

  const addItem = () => setFormData(prev => ({ ...prev, items: [...prev.items, { ...emptyItem }] }));
  const removeItem = (index) => setFormData(prev => ({ ...prev, items: prev.items.filter((_, i) => i !== index) }));

  const handleSupplierChange = (supplierId) => {
    const supplier = suppliers.find(s => s.id === supplierId);
    setFormData(prev => ({
      ...prev,
      supplier_id: supplierId,
      supplier_name: supplier?.name || '',
      supplier_gstin: supplier?.gstin || prev.supplier_gstin,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.supplier_name) {
      setSaveError('Please select or enter a supplier.');
      return;
    }
    setSaving(true);
    setSaveError('');
    const payload = {
      ...formData,
      taxable_value: taxableValue,
      discount,
      cgst,
      sgst,
      igst,
      round_off: roundOff,
      total,
    };
    try {
      if (bill?.id) {
        await api.put(`/entities/PurchaseBill/${bill.id}`, payload);
      } else {
        await api.post('/entities/PurchaseBill', payload);
      }
      onSaved();
      onClose();
    } catch (err) {
      setSaveError(err.message || 'Error saving purchase bill.');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const supplierOptions = [...suppliers];
  if (formData.supplier_name && !supplierOptions.find(s => s.id === formData.supplier_id || s.name.toLowerCase() === formData.supplier_name.toLowerCase())) {
    const fallbackId = formData.supplier_id || `temp_${formData.supplier_name.replace(/\s+/g, '_')}`;
    supplierOptions.unshift({ id: fallbackId, name: formData.supplier_name });
  }
  const selectedSupplierLabel = supplierOptions.find(s => s.id === formData.supplier_id)?.name || '';

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{bill ? 'Edit Purchase Bill' : 'Add Purchase Bill'}</DialogTitle>
        </DialogHeader>
        {saveError && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 text-sm text-destructive font-medium">
            {saveError}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Supplier *</Label>
              <Select value={formData.supplier_id} onValueChange={handleSupplierChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select supplier">{selectedSupplierLabel || undefined}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {supplierOptions.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {selectedSupplier && (
                <p className="text-[11px] text-muted-foreground">
                  State: <span className="font-semibold">{selectedSupplier.state || '—'}</span> {isInterstate ? '(Inter-state IGST)' : '(Intra-state CGST+SGST)'}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Bill Number *</Label>
              <Input value={formData.bill_number}
                onChange={e => setFormData(prev => ({ ...prev, bill_number: e.target.value }))} required />
            </div>
            <div className="space-y-1.5">
              <Label>Supplier GSTIN</Label>
              <Input value={formData.supplier_gstin}
                onChange={e => setFormData(prev => ({ ...prev, supplier_gstin: e.target.value.toUpperCase() }))}
                placeholder="27ABCDE1234F1Z5" />
              {gstinCheck && !gstinCheck.formatValid && (
                <p className="text-[11px] text-destructive font-medium">{gstinCheck.reason}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Bill Date *</Label>
              <Input type="date" value={formData.bill_date}
                onChange={e => setFormData(prev => ({ ...prev, bill_date: e.target.value }))} required />
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
                    <th className="text-left text-xs px-3 py-2">Description</th>
                    <th className="text-left text-xs px-3 py-2 w-24">HSN</th>
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
                        <Input value={item.description}
                          onChange={e => handleItemChange(i, 'description', e.target.value)}
                          placeholder="Item description" className="h-9" required />
                      </td>
                      <td className="px-2 py-2">
                        <Input value={item.hsn}
                          onChange={e => handleItemChange(i, 'hsn', e.target.value)}
                          className="h-9" />
                      </td>
                      <td className="px-2 py-2">
                        <Input type="number" value={item.quantity}
                          onChange={e => handleItemChange(i, 'quantity', Number(e.target.value))}
                          className="h-9 text-right" min="0" step="any" required />
                      </td>
                      <td className="px-2 py-2">
                        <Input type="number" value={item.rate}
                          onChange={e => handleItemChange(i, 'rate', Number(e.target.value))}
                          className="h-9 text-right" min="0" step="0.01" required />
                      </td>
                      <td className="px-2 py-2">
                        <Select value={String(item.gst_rate)} onValueChange={v => handleItemChange(i, 'gst_rate', Number(v))}>
                          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="0">0%</SelectItem>
                            <SelectItem value="5">5%</SelectItem>
                            <SelectItem value="12">12%</SelectItem>
                            <SelectItem value="18">18%</SelectItem>
                            <SelectItem value="28">28%</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-2 text-right text-sm font-medium">
                        {formatINR(item.quantity * item.rate)}
                      </td>
                      <td className="px-2 py-2 text-center">
                        {formData.items.length > 1 && (
                          <button type="button" onClick={() => removeItem(i)}
                            className="text-destructive hover:text-destructive/80">
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
              <div className="flex justify-between"><span className="text-muted-foreground">Taxable Value</span><span>{formatINR(taxableValue)}</span></div>
              <div className="flex justify-between items-center gap-2">
                <Label htmlFor="pb-discount" className="text-muted-foreground font-normal">Discount</Label>
                <Input id="pb-discount" type="number" min="0" step="0.01"
                  value={formData.discount}
                  onChange={e => setFormData(prev => ({ ...prev, discount: e.target.value === '' ? '' : Number(e.target.value) }))}
                  className="h-7 w-28 text-right" placeholder="0" />
              </div>
              {isInterstate ? (
                <div className="flex justify-between"><span className="text-muted-foreground">IGST</span><span>{formatINR(igst)}</span></div>
              ) : (
                <>
                  <div className="flex justify-between"><span className="text-muted-foreground">CGST</span><span>{formatINR(cgst)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">SGST</span><span>{formatINR(sgst)}</span></div>
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

          <div className="border border-border rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <Label>ITC Eligible</Label>
                <p className="text-xs text-muted-foreground mt-0.5">Turn off if this purchase is a blocked credit under Sec 17(5) — it will be excluded from GST Center's Input Tax Credit.</p>
              </div>
              <Switch checked={formData.itc_eligible}
                onCheckedChange={v => setFormData(prev => ({ ...prev, itc_eligible: v, itc_ineligible_reason: v ? '' : prev.itc_ineligible_reason }))} />
            </div>
            {!formData.itc_eligible && (
              <div className="space-y-1.5 pt-1">
                <Label>Reason</Label>
                <Select value={formData.itc_ineligible_reason} onValueChange={v => setFormData(prev => ({ ...prev, itc_ineligible_reason: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select reason" /></SelectTrigger>
                  <SelectContent>
                    {ITC_INELIGIBLE_REASONS.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={formData.status} onValueChange={v => setFormData(prev => ({ ...prev, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="recorded">Recorded</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">Only "Recorded" bills count toward GST Center's output tax reconciliation and ITC.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Payment Status</Label>
              <Select value={formData.payment_status} onValueChange={v => setFormData(prev => ({ ...prev, payment_status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unpaid">Unpaid</SelectItem>
                  <SelectItem value="partial">Partial</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
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
            <Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save Purchase Bill'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
