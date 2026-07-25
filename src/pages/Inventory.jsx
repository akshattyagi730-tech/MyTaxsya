import { useState, useEffect, useMemo } from 'react';
import apiClient from '@/api/apiClient';
import PageHeader from '@/components/PageHeader';
import DataTable from '@/components/DataTable';
import StatCard from '@/components/dashboard/StatCard';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Package, AlertTriangle, PackageX, TrendingUp } from 'lucide-react';
import { formatINR } from '@/lib/format';

export default function Inventory() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [adjustProduct, setAdjustProduct] = useState(null);
  const [adjustQty, setAdjustQty] = useState(0);
  const [adjustType, setAdjustType] = useState('add');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await apiClient.get('/entities/Product', { params: { sort: '-created_date', limit: 200 } });
        setProducts(res.data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const stats = useMemo(() => {
    const total = products.length;
    const lowStock = products.filter(p => p.stock_quantity <= (p.low_stock_threshold || 0) && p.stock_quantity > 0).length;
    const outOfStock = products.filter(p => p.stock_quantity <= 0).length;
    const totalValue = products.reduce((s, p) => s + (p.stock_quantity * p.purchase_price), 0);
    return { total, lowStock, outOfStock, totalValue };
  }, [products]);

  const handleAdjust = async () => {
    setSaving(true);
    try {
      const isIncrease = ['add', 'purchase', 'sales_return', 'audit_add'].includes(adjustType);
      const newQty = isIncrease
        ? adjustProduct.stock_quantity + adjustQty
        : adjustProduct.stock_quantity - adjustQty;
      const res = await apiClient.put(`/entities/Product/${adjustProduct.id}`, { stock_quantity: Math.max(0, newQty) });
      setProducts(prev => prev.map(p => p.id === adjustProduct.id ? res.data : p));
      setAdjustProduct(null);
      setAdjustQty(0);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    { key: 'name', label: 'Product', sortable: true },
    { key: 'sku', label: 'SKU', sortable: true },
    { key: 'category', label: 'Category', sortable: true },
    { key: 'stock_quantity', label: 'In Stock', sortable: true, render: (r) => (
      <span className={r.stock_quantity <= 0 ? 'text-red-600 font-medium' : r.stock_quantity <= (r.low_stock_threshold || 0) ? 'text-amber-600 font-medium' : ''}>
        {r.stock_quantity} {r.unit}
      </span>
    ) },
    { key: 'low_stock_threshold', label: 'Min Level' },
    { key: 'purchase_price', label: 'Unit Cost', render: (r) => formatINR(r.purchase_price) },
    { key: 'stock_value', label: 'Stock Value', render: (r) => <span className="font-medium">{formatINR(r.stock_quantity * r.purchase_price)}</span> },
  ];

  return (
    <div className="max-w-[1400px] mx-auto">
      <PageHeader title="Inventory" subtitle="Track and manage stock levels" />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard title="Total Products" value={stats.total} icon={Package} accent="blue" />
        <StatCard title="Low Stock" value={stats.lowStock} icon={AlertTriangle} accent="amber" />
        <StatCard title="Out of Stock" value={stats.outOfStock} icon={PackageX} accent="rose" />
        <StatCard title="Stock Value" value={formatINR(stats.totalValue)} icon={TrendingUp} accent="green" />
      </div>

      <DataTable
        data={products} columns={columns} loading={loading} error={error}
        searchKeys={['name', 'sku', 'category', 'hsn_code']}
        actions={(row) => (
          <Button variant="outline" size="sm" onClick={() => { setAdjustProduct(row); setAdjustQty(0); setAdjustType('purchase'); }}>
            Adjust Stock
          </Button>
        )}
      />

      <Dialog open={!!adjustProduct} onOpenChange={() => setAdjustProduct(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Adjust Stock — {adjustProduct?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">Current Stock: {adjustProduct?.stock_quantity} {adjustProduct?.unit}</div>
            <div className="space-y-1.5">
              <Label>Adjustment Type</Label>
              <Select value={adjustType} onValueChange={setAdjustType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="purchase">Purchase (Increase Stock)</SelectItem>
                  <SelectItem value="sales_return">Sales Return (Increase Stock)</SelectItem>
                  <SelectItem value="audit_add">Audit Adjustment (Increase)</SelectItem>
                  <SelectItem value="sales">Sales (Decrease Stock)</SelectItem>
                  <SelectItem value="purchase_return">Purchase Return (Decrease)</SelectItem>
                  <SelectItem value="audit_remove">Audit Adjustment (Decrease)</SelectItem>
                  <SelectItem value="add">Manual Add</SelectItem>
                  <SelectItem value="remove">Manual Remove</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Quantity</Label>
              <Input type="number" value={adjustQty} onChange={e => setAdjustQty(Number(e.target.value))} min="1" />
            </div>
            <div className="text-sm font-medium">
              New Stock: {adjustProduct ? Math.max(0, ['add', 'purchase', 'sales_return', 'audit_add'].includes(adjustType) ? adjustProduct.stock_quantity + adjustQty : adjustProduct.stock_quantity - adjustQty) : 0}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustProduct(null)}>Cancel</Button>
            <Button onClick={handleAdjust} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}