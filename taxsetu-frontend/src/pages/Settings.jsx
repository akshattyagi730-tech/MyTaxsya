import { useState, useEffect } from 'react';
import api from '@/services/api';
import PageHeader from '@/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Building, Save } from 'lucide-react';

export default function Settings() {
  const [business, setBusiness] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
  const gstinError = business?.gstin && !GSTIN_REGEX.test(business.gstin) ? 'Invalid GSTIN format (e.g. 27ABCDE1234F1Z5)' : '';
  const panError = business?.pan && !PAN_REGEX.test(business.pan) ? 'Invalid PAN format (e.g. ABCDE1234F)' : '';

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get('/entities/Business', { params: { sort: '-created_date', limit: 10 } });
        const businesses = res.data;
        if (businesses.length > 0) {
          setBusiness(businesses[0]);
        } else {
          setBusiness({ name: '', legal_name: '', gstin: '', pan: '', email: '', phone: '', address: '', city: '', state: '', pincode: '', business_type: 'proprietorship', gst_enabled: true, currency_symbol: '₹' });
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      if (business.id) {
        const res = await api.put(`/entities/Business/${business.id}`, business);
        setBusiness(res.data);
      } else {
        const res = await api.post('/entities/Business', business);
        setBusiness(res.data);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-8"><div className="h-64 rounded-xl bg-muted animate-pulse" /></div>;
  if (!business) return <div className="p-8 text-center text-muted-foreground">{error || 'Unable to load settings'}</div>;

  return (
    <div className="max-w-[800px] mx-auto space-y-6">
      <PageHeader title="Settings" subtitle="Configure your business profile" />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Building className="w-5 h-5" /> Business Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Business Name *</Label>
              <Input value={business.name || ''} onChange={e => setBusiness({ ...business, name: e.target.value })} required />
            </div>
            <div className="space-y-1.5">
              <Label>Legal Name</Label>
              <Input value={business.legal_name || ''} onChange={e => setBusiness({ ...business, legal_name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>GSTIN</Label>
              <Input value={business.gstin || ''} onChange={e => setBusiness({ ...business, gstin: e.target.value.toUpperCase() })} placeholder="27ABCDE1234F1Z5" className={gstinError ? 'border-red-500 focus-visible:ring-red-500' : ''} />
              {gstinError && <p className="text-xs text-red-500 font-medium">{gstinError}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>PAN</Label>
              <Input value={business.pan || ''} onChange={e => setBusiness({ ...business, pan: e.target.value.toUpperCase() })} placeholder="ABCDE1234F" className={panError ? 'border-red-500 focus-visible:ring-red-500' : ''} />
              {panError && <p className="text-xs text-red-500 font-medium">{panError}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={business.email || ''} onChange={e => setBusiness({ ...business, email: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={business.phone || ''} onChange={e => setBusiness({ ...business, phone: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Business Type</Label>
              <Select value={business.business_type || 'proprietorship'} onValueChange={v => setBusiness({ ...business, business_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="proprietorship">Proprietorship</SelectItem>
                  <SelectItem value="partnership">Partnership</SelectItem>
                  <SelectItem value="llp">LLP</SelectItem>
                  <SelectItem value="private_limited">Private Limited</SelectItem>
                  <SelectItem value="public_limited">Public Limited</SelectItem>
                  <SelectItem value="huf">HUF</SelectItem>
                  <SelectItem value="trust">Trust</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Currency Symbol</Label>
              <Input value={business.currency_symbol || ''} onChange={e => setBusiness({ ...business, currency_symbol: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Address</Label>
            <Textarea value={business.address || ''} onChange={e => setBusiness({ ...business, address: e.target.value })} rows={2} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label>City</Label>
              <Input value={business.city || ''} onChange={e => setBusiness({ ...business, city: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>State</Label>
              <Input value={business.state || ''} onChange={e => setBusiness({ ...business, state: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Pincode</Label>
              <Input value={business.pincode || ''} onChange={e => setBusiness({ ...business, pincode: e.target.value })} />
            </div>
          </div>
          <div className="flex items-center justify-end gap-3">
            {saved && <span className="text-sm text-emerald-600 font-medium">Settings saved!</span>}
            <Button onClick={handleSave} disabled={saving || !business.name || !!gstinError || !!panError} className="gap-2">
              <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save Settings'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}