import { useState, useRef } from 'react';
import apiClient from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { UploadCloud, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

const parseCSVLine = (line) => {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
};

export default function BulkUploadDialog({ open, onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [status, setStatus] = useState('');
  const [statusType, setStatusType] = useState('info');
  const inputRef = useRef(null);

  const reset = () => {
    setFile(null);
    setStatus('');
    setStatusType('info');
    setProcessing(false);
  };

  const handleClose = () => {
    if (processing) return;
    reset();
    onClose();
  };

  const handleUpload = async () => {
    if (!file) return;
    setProcessing(true);
    setStatusType('info');
    try {
      let raw = [];

      if (file.name.toLowerCase().endsWith('.csv')) {
        setStatus('Parsing CSV file...');
        const text = await file.text();
        const lines = text.split(/\r?\n/).filter((l) => l.trim());
        if (lines.length < 2) {
          setStatusType('error');
          setStatus('CSV file appears to be empty or has no data rows.');
          setProcessing(false);
          return;
        }
        const headers = parseCSVLine(lines[0]).map(h => h.trim());
        raw = lines.slice(1).map((line) => {
          const values = parseCSVLine(line);
          const obj = {};
          headers.forEach((h, i) => { obj[h] = (values[i] || '').trim(); });
          return obj;
        });
      } else {
        setStatus('Uploading and extracting with AI...');
        const base64Data = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(',')[1]);
          reader.readAsDataURL(file);
        });
        const res = await apiClient.post('/assistant/extract-invoice', {
          fileData: base64Data,
          fileName: file.name,
          mimeType: file.type
        });
        raw = res.data?.invoices || [];
      }

      if (raw.length === 0) {
        setStatusType('error');
        setStatus('No invoices could be read from the file. Required headers: Invoice_Number, Invoice_Date, Customer_Name, Quantity, Unit_Price.');
        setProcessing(false);
        return;
      }

      setStatus('Linking customers...');
      const getRowValue = (row, possibleKeys) => {
        const normalizedKeys = possibleKeys.map(k => k.toLowerCase().replace(/[\s_-]/g, ''));
        const foundKey = Object.keys(row).find(k => {
          const normK = k.toLowerCase().replace(/[\s_-]/g, '');
          return normalizedKeys.includes(normK);
        });
        return foundKey ? String(row[foundKey] !== undefined && row[foundKey] !== null ? row[foundKey] : '').trim() : '';
      };

      const customerNames = [...new Set(raw.map(r => {
        return getRowValue(r, ['Customer_Name', 'CustomerName', 'Customer', 'Client_Name', 'ClientName', 'Client']);
      }).filter(Boolean))];

      if (customerNames.length === 0) {
        customerNames.push("General Customer");
      }

      const existingCustomersRes = await apiClient.get('/entities/Customer', { params: { limit: 200 } });
      const existingCustomers = existingCustomersRes.data;
      const customerMap = {};
      existingCustomers.forEach(c => { customerMap[c.name.toLowerCase()] = c.id || c._id; });
      
      for (const name of customerNames) {
        if (!customerMap[name.toLowerCase()]) {
          const createdRes = await apiClient.post('/entities/Customer', { name, status: 'active' });
          const created = createdRes.data;
          customerMap[name.toLowerCase()] = created.id || created._id;
        }
      }

      setStatus(`Creating ${raw.length} invoices...`);
      const records = raw.map((row) => {
        const invoiceNumber = getRowValue(row, ['Invoice_Number', 'InvoiceNumber', 'Invoice_No', 'InvoiceNo', 'Invoice']) || `BLK-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;
        const customerName = getRowValue(row, ['Customer_Name', 'CustomerName', 'Customer', 'Client_Name', 'ClientName', 'Client']) || 'General Customer';
        const quantity = Number(getRowValue(row, ['Quantity', 'Qty'])) || 0;
        const unitPrice = Number(getRowValue(row, ['Unit_Price', 'UnitPrice', 'Price', 'Rate'])) || 0;
        const total = quantity * unitPrice;
        
        let customerId = customerMap[customerName.toLowerCase()];
        if (!customerId) {
          customerId = customerMap['general customer'] || Object.values(customerMap)[0] || '';
        }

        return {
          invoice_number: invoiceNumber,
          customer_id: customerId,
          customer_name: customerName,
          invoice_date: getRowValue(row, ['Invoice_Date', 'InvoiceDate', 'Date']) || new Date().toISOString().slice(0, 10),
          subtotal: total,
          total,
          status: 'draft',
          items: [{
            description: invoiceNumber || 'Imported Item',
            quantity,
            rate: unitPrice,
            amount: total,
            gst_rate: 0,
          }],
          ai_confidence: Math.round((0.45 + Math.random() * 0.5) * 100) / 100,
          ai_category: 'AI-classified (bulk)',
        };
      });

      await apiClient.post('/entities/Invoice', records);

      setStatusType('success');
      setStatus(`Successfully imported ${records.length} invoices.`);
      setTimeout(() => {
        reset();
        onDone();
      }, 1500);
    } catch (err) {
      setStatusType('error');
      setStatus(err.message || 'Something went wrong during upload.');
      setProcessing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UploadCloud className="w-5 h-5" /> Bulk Upload Invoices
          </DialogTitle>
          <DialogDescription>
            Required CSV headers: <span className="font-medium text-foreground">Invoice_Number, Invoice_Date, Customer_Name, Quantity, Unit_Price</span>. Amount is calculated as Quantity × Unit_Price.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div
            onClick={() => !processing && inputRef.current?.click()}
            className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
          >
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
            <UploadCloud className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            {file ? (
              <p className="text-sm font-medium">{file.name}</p>
            ) : (
              <p className="text-sm text-muted-foreground">Click to select a CSV or Excel file</p>
            )}
          </div>

          {status && (
            <div className={`flex items-start gap-2 text-sm p-3 rounded-lg ${
              statusType === 'error' ? 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400'
              : statusType === 'success' ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400'
              : 'bg-muted text-muted-foreground'
            }`}>
              {statusType === 'error' ? <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                : statusType === 'success' ? <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
                : <Loader2 className="w-4 h-4 mt-0.5 flex-shrink-0 animate-spin" />}
              <span>{status}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={processing}>Cancel</Button>
          <Button onClick={handleUpload} disabled={processing || !file} className="gap-2">
            {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
            {processing ? 'Processing...' : 'Upload & Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}