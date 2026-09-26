import { useState, useRef } from 'react';
import api from '@/services/api';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  UploadCloud, Loader2, CheckCircle2, AlertCircle, FileText, Database, Trash2,
} from 'lucide-react';
import { formatINR } from '@/utils/format';
import { applyReconciliation } from '@/utils/reconciliation';
import { runPool } from '@/utils/concurrency';
import {
  EXTRACTION_CONCURRENCY, MAX_FILES_PER_BATCH, describeExtractionError, throwIfAiFailure, withAutoRetry,
} from '@/utils/extraction';

// Document types the AI's own classification considers an actual bill (money
// owed to a supplier) rather than a quote, statement, list, or unrelated
// document. Everything else gets flagged instead of silently imported.
const BILL_LIKE_TYPES = new Set(['Sales Invoice', 'Purchase Invoice', 'GST Invoice', 'Vendor Bill']);

// Independent of what the AI *thinks* the document is, a real bill must
// structurally have a supplier, a bill reference/date or a total, and at
// least one item or a total — this catches cases where the AI mislabels a
// document but the extracted fields are hollow either way.
const checkIsBill = (doc, documentType) => {
  const reasons = [];
  if (documentType && !BILL_LIKE_TYPES.has(documentType)) {
    reasons.push(`This looks like a "${documentType}", not a purchase bill.`);
  }
  if (!doc.supplier_name) reasons.push('No supplier name could be found.');
  if (!doc.bill_number && !(doc.total > 0)) reasons.push('No bill number or total amount could be found.');
  if (doc.items.length === 0 && !(doc.total > 0)) reasons.push('No line items or total amount could be found.');
  return { isBill: reasons.length === 0, reasons };
};

const normalizeDate = (value) => {
  if (!value) return null;
  let str = String(value).trim();
  if (str.includes('T')) str = str.split('T')[0].trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(str);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const dmy = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(str);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  const parsed = new Date(str);
  return !isNaN(parsed.getTime()) ? parsed.toISOString().split('T')[0] : null;
};

// Turn one /assistant/extract-invoice response into a purchase-bill draft for review.
const buildBillDoc = (file, data) => {
  const seller = data.seller_information || {};
  // GST-inclusive (MRP) bills arrive with an ex-tax view; use it so the tax isn't counted twice.
  const { products: items, totals } = applyReconciliation({
    products: data.products || data.line_items || [],
    totals: data.totals || {},
    reconciliation: data.reconciliation,
  });

  const taxableValue = Number(totals.taxable_value) || items.reduce((s, p) => s + (Number(p.taxable_value) || (Number(p.quantity) * Number(p.rate)) || 0), 0);
  const totalTax = (Number(totals.cgst) || 0) + (Number(totals.sgst) || 0) + (Number(totals.igst) || 0);
  // The AI sometimes captures the document-level CGST/SGST/IGST total
  // correctly but leaves each line item's own gst_rate blank — rather
  // than showing a misleading "0%" per item, back-calculate a single
  // effective rate from the totals when every item is missing one.
  const fallbackGstRate = taxableValue > 0 && totalTax > 0 ? Math.round((totalTax / taxableValue) * 100) : 0;

  const doc = {
    fileName: file.name,
    confidence: data.confidence !== undefined ? data.confidence : (data.confidence_score || 0),
    status: (data.status || data.validation_status || 'success').toString().toLowerCase(),
    warnings: data.warnings || [],
    notes: data.reconciliation?.notes || [],
    bill_number: data.fields?.invoice_number || '',
    bill_date: normalizeDate(data.fields?.invoice_date || data.invoice_information?.invoice_date) || new Date().toISOString().split('T')[0],
    supplier_name: seller.name || data.fields?.supplier || data.fields?.business_name || '',
    supplier_gstin: seller.gstin || data.fields?.gstin || '',
    items: items.map(p => ({
      description: p.description || 'Imported Item',
      hsn: p.hsn || '',
      quantity: Number(p.quantity) || 1,
      rate: Number(p.rate) || 0,
      taxable_value: Number(p.taxable_value) || (Number(p.quantity) * Number(p.rate)) || 0,
      gst_rate: Number(p.gst_rate) || fallbackGstRate,
    })),
    taxable_value: taxableValue,
    discount: Number(totals.discount) || 0,
    cgst: Number(totals.cgst) || 0,
    sgst: Number(totals.sgst) || 0,
    igst: Number(totals.igst) || 0,
    round_off: Number(totals.round_off) || 0,
    total: Number(totals.grand_total) || 0,
    error: null,
  };

  const { isBill, reasons } = checkIsBill(doc, data.documentType);
  doc.isBill = isBill;
  doc.billCheckReasons = reasons;
  return doc;
};

// Read one bill through the backend; a temporary failure gets a pause and one more go.
const extractBill = (file) => withAutoRetry(async () => {
  const formData = new FormData();
  formData.append('file', file);
  const res = await api.post('/assistant/extract-invoice', formData);
  throwIfAiFailure(res.data);
  return buildBillDoc(file, res.data || {});
});

let failedBillCounter = 0;
// A placeholder for a file that could not be read; it keeps the file so it can be retried.
const failedBillDoc = (file, info) => ({
  id: `failed-${Date.now()}-${failedBillCounter++}`,
  file,
  fileName: file.name,
  error: info.message || 'Extraction failed',
  errorCode: info.code,
  retryable: info.retryable,
  bill_number: '', supplier_name: '', items: [], total: 0, confidence: 0, status: 'error',
});

// A supplier's own invoice IS, from our side, a Purchase Bill — this reuses the
// same extraction pipeline the Invoices importer uses (Gemini vision under the
// hood), but maps seller_information -> supplier (since it's the other party's
// bill we're recording), not customer.
export default function PurchaseBillUploadDialog({ open, onClose, onDone }) {
  const [processing, setProcessing] = useState(false);
  const [status, setStatus] = useState('');
  const [docs, setDocs] = useState([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [importSummary, setImportSummary] = useState(null);
  const [notice, setNotice] = useState('');
  const inputRef = useRef(null);

  const reset = () => {
    setStatus('');
    setProcessing(false);
    setDocs([]);
    setSelectedIdx(0);
    setImportSummary(null);
    setNotice('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleClose = () => {
    if (processing) return;
    reset();
    onClose();
  };

  const handleFileChange = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    if (e.target) e.target.value = '';

    setDocs([]);
    setSelectedIdx(0);
    setImportSummary(null);
    setNotice('');

    if (files.length > MAX_FILES_PER_BATCH) {
      setNotice(`Too many files (${files.length}). Please upload at most ${MAX_FILES_PER_BATCH} bills per batch.`);
      return;
    }

    setProcessing(true);
    setStatus(`Extracting 0 of ${files.length} bills...`);

    // Read several bills at a time. Each file stands on its own: one bad bill or a temporary
    // hiccup never throws away the others (it shows up as a failed row you can retry).
    const results = new Array(files.length);
    let finished = 0;
    let active = 0;
    let fatalInfo = null;

    const { skipped } = await runPool(files, EXTRACTION_CONCURRENCY, async (file, i) => {
      active++;
      setStatus(`Extracting ${finished} of ${files.length} bills (${active} at once)...`);
      try {
        results[i] = await extractBill(file);
      } catch (err) {
        const info = describeExtractionError(err);
        if (info.fatal && !fatalInfo) fatalInfo = info;
        results[i] = failedBillDoc(file, info);
      } finally {
        active--;
        finished++;
        setStatus(`Extracting ${finished} of ${files.length} bills${active > 0 ? ` (${active} at once)` : ''}...`);
      }
    }, { shouldStop: () => fatalInfo !== null });

    // Files never sent because a fatal error (bad key, quota) stopped the run.
    skipped.forEach((i) => {
      results[i] = failedBillDoc(files[i], {
        message: `Not processed: extraction stopped. ${fatalInfo.message}`,
        code: fatalInfo.code,
        retryable: true,
      });
    });

    if (fatalInfo && results.every((d) => d.error)) {
      setNotice(fatalInfo.message);
    } else {
      setDocs(results);
    }
    setProcessing(false);
    setStatus('');
  };

  // Read one failed file again and swap the result in; the other bills stay untouched.
  const retryDoc = async (doc) => {
    if (!doc?.file || doc.retrying) return;
    setDocs(prev => prev.map(d => d.id === doc.id ? { ...d, retrying: true } : d));
    try {
      const fresh = await extractBill(doc.file);
      setDocs(prev => prev.map(d => d.id === doc.id ? fresh : d));
    } catch (err) {
      const failed = { ...failedBillDoc(doc.file, describeExtractionError(err)), id: doc.id };
      setDocs(prev => prev.map(d => d.id === doc.id ? failed : d));
    }
  };

  const retryAllFailed = async () => {
    const targets = docs.filter(d => d.error && d.file && !d.retrying);
    await runPool(targets, EXTRACTION_CONCURRENCY, (doc) => retryDoc(doc));
  };

  const updateDoc = (idx, field, value) => {
    setDocs(prev => prev.map((d, i) => i === idx ? { ...d, [field]: value } : d));
  };

  const removeDoc = (idx) => {
    setDocs(prev => prev.filter((_, i) => i !== idx));
    setSelectedIdx(i => Math.max(0, Math.min(i, docs.length - 2)));
  };

  const handleImportAll = async () => {
    setProcessing(true);
    setStatus('Connecting to database...');
    let successCount = 0;
    const failedReport = [];

    try {
      const supRes = await api.get('/entities/Supplier', { params: { limit: 100000 } });
      const dbSuppliers = supRes.data || [];
      const supplierMap = {};
      dbSuppliers.forEach(s => { const k = s.name.toLowerCase(); if (!supplierMap[k]) supplierMap[k] = s.id || s._id; });

      let i = 0;
      for (const doc of docs) {
        i++;
        if (doc.error) { failedReport.push({ fileName: doc.fileName, error: doc.error }); continue; }
        if (!doc.bill_number) { failedReport.push({ fileName: doc.fileName, error: 'Missing bill number.' }); continue; }
        if (!doc.supplier_name) { failedReport.push({ fileName: doc.fileName, error: 'Missing supplier name.' }); continue; }
        if (doc.items.length === 0 && !(doc.total > 0)) { failedReport.push({ fileName: doc.fileName, error: 'No line items or total amount.' }); continue; }

        setStatus(`Importing bill ${i} of ${docs.length}: ${doc.fileName}...`);
        try {
          let supplierId = supplierMap[doc.supplier_name.toLowerCase()];
          if (!supplierId) {
            const res = await api.post('/entities/Supplier', {
              name: doc.supplier_name, gstin: doc.supplier_gstin || undefined, status: 'active',
            });
            supplierId = res.data.id || res.data._id;
            supplierMap[doc.supplier_name.toLowerCase()] = supplierId;
          }

          await api.post('/entities/PurchaseBill', {
            bill_number: doc.bill_number,
            supplier_id: supplierId,
            supplier_name: doc.supplier_name,
            supplier_gstin: doc.supplier_gstin,
            bill_date: doc.bill_date,
            items: doc.items,
            taxable_value: doc.taxable_value,
            discount: doc.discount,
            cgst: doc.cgst,
            sgst: doc.sgst,
            igst: doc.igst,
            round_off: doc.round_off,
            total: doc.total,
            // AI-imported bills stay in draft, ITC-eligible-by-default until a
            // human confirms them — mirrors how AI-imported invoices land as
            // "draft" rather than silently counting toward GST numbers.
            status: 'draft',
            itc_eligible: true,
            notes: `AI Imported from ${doc.fileName} (confidence ${Math.round((doc.confidence || 0) * 100)}%)`,
          });
          successCount++;
        } catch (err) {
          failedReport.push({ fileName: doc.fileName, error: err.message || 'Save failed.' });
        }
      }

      setImportSummary({ total: docs.length, successCount, failedCount: failedReport.length, failedReport });
      setStatus('');
    } catch (err) {
      setStatus(err.message || 'Import failed.');
    } finally {
      setProcessing(false);
    }
  };

  // ---- Results screen ----
  if (importSummary) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-secondary" /> Import Results</DialogTitle>
            <DialogDescription>Purchase bills are saved as Draft — review and mark them Recorded to include in GST Center.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-3 my-2">
            <div className="bg-muted/50 p-3 rounded-lg text-center border border-border">
              <p className="text-[10px] text-muted-foreground uppercase font-medium">Total</p>
              <p className="text-2xl font-bold">{importSummary.total}</p>
            </div>
            <div className="bg-secondary/10 p-3 rounded-lg text-center border border-secondary/20">
              <p className="text-[10px] text-secondary uppercase font-medium">Success</p>
              <p className="text-2xl font-bold text-secondary">{importSummary.successCount}</p>
            </div>
            <div className={`p-3 rounded-lg text-center border ${importSummary.failedCount > 0 ? 'bg-destructive/10 border-destructive/20' : 'bg-muted/50 border-border'}`}>
              <p className={`text-[10px] uppercase font-medium ${importSummary.failedCount > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>Failed</p>
              <p className={`text-2xl font-bold ${importSummary.failedCount > 0 ? 'text-destructive' : ''}`}>{importSummary.failedCount}</p>
            </div>
          </div>
          {importSummary.failedReport.length > 0 && (
            <div className="border border-border rounded-lg divide-y divide-border max-h-40 overflow-y-auto text-xs">
              {importSummary.failedReport.map((f, i) => (
                <div key={i} className="px-3 py-1.5 flex justify-between gap-2">
                  <span className="truncate">{f.fileName}</span>
                  <span className="text-destructive text-right">{f.error}</span>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={reset}>Import More</Button>
            <Button onClick={() => onDone()}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // ---- Review screen ----
  if (docs.length > 0) {
    const doc = docs[Math.min(selectedIdx, docs.length - 1)];
    const failedCount = docs.filter(d => d.error).length;
    const anyRetrying = docs.some(d => d.retrying);
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Database className="w-5 h-5 text-primary" /> Review Extracted Bills</DialogTitle>
            <DialogDescription>Verify supplier, amounts, and quantities before importing — AI extraction can misread numbers.</DialogDescription>
          </DialogHeader>

          {failedCount > 0 && (
            <div className="flex items-center justify-between gap-3 p-2.5 border border-destructive/20 bg-destructive/5 rounded-lg text-xs">
              <span className="flex items-center gap-2 text-destructive font-medium">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {failedCount === docs.length
                  ? `${docs.length === 1 ? 'This file' : `None of the ${docs.length} files`} could be read. Check the reason on each file, then retry.`
                  : `${failedCount} of ${docs.length} file${docs.length === 1 ? '' : 's'} could not be read. The others are ready to review and import.`}
              </span>
              <Button size="sm" variant="outline" onClick={retryAllFailed} disabled={anyRetrying} className="border-destructive/30 hover:bg-destructive/10 shrink-0">
                {anyRetrying ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Retrying...</> : 'Retry failed files'}
              </Button>
            </div>
          )}

          {docs.length > 1 && (
            <div className="flex gap-2 flex-wrap">
              {docs.map((d, i) => (
                <button key={i} type="button" onClick={() => setSelectedIdx(i)}
                  className={`text-xs px-2.5 py-1 rounded-full border ${i === selectedIdx ? 'bg-primary/10 border-primary text-primary font-medium' : 'border-border text-muted-foreground'}`}>
                  {d.fileName}
                </button>
              ))}
            </div>
          )}

          {doc.error ? (
            <div className="p-4 border border-destructive/20 bg-destructive/5 rounded-xl flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-destructive shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-destructive">{doc.fileName}</p>
                <p className="text-xs text-muted-foreground">{doc.error}</p>
              </div>
              {doc.file && (
                <Button size="sm" variant="outline" onClick={() => retryDoc(doc)} disabled={!!doc.retrying} className="shrink-0">
                  {doc.retrying ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Retrying...</> : 'Retry this file'}
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 font-mono text-muted-foreground"><FileText className="w-3.5 h-3.5" /> {doc.fileName}</span>
                <span className={`px-2 py-0.5 rounded-full border font-semibold ${doc.confidence >= 0.85 ? 'bg-secondary/10 text-secondary border-secondary/20' : doc.confidence >= 0.6 ? 'bg-accent/10 text-accent border-accent/20' : 'bg-destructive/10 text-destructive border-destructive/20'}`}>
                  Confidence: {Math.round((doc.confidence || 0) * 100)}%
                </span>
              </div>

              {doc.notes?.length > 0 && (
                <div className="p-3 border border-primary/20 bg-primary/5 text-primary rounded-lg text-xs space-y-0.5">
                  {doc.notes.map((n, i) => <p key={i}>{n}</p>)}
                </div>
              )}

              {doc.isBill === false && (
                <div className="p-3 border border-destructive/30 bg-destructive/10 text-destructive rounded-lg text-xs space-y-1">
                  <p className="font-semibold flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> This may not be a valid purchase bill</p>
                  {doc.billCheckReasons.map((r, i) => <p key={i}>• {r}</p>)}
                  <p className="text-destructive/80">Fix supplier, bill number, and amounts below, or remove this file before importing.</p>
                </div>
              )}

              {doc.warnings?.length > 0 && (
                <div className="p-3 border border-accent/20 bg-accent/10 text-accent rounded-lg text-xs space-y-0.5">
                  {doc.warnings.map((w, i) => <p key={i}>⚠ {w}</p>)}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground uppercase font-semibold">Supplier</label>
                  <input value={doc.supplier_name} onChange={e => updateDoc(selectedIdx, 'supplier_name', e.target.value)}
                    className="w-full text-sm border border-border rounded-lg px-2.5 py-1.5 bg-background" />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground uppercase font-semibold">Supplier GSTIN</label>
                  <input value={doc.supplier_gstin} onChange={e => updateDoc(selectedIdx, 'supplier_gstin', e.target.value.toUpperCase())}
                    className="w-full text-sm border border-border rounded-lg px-2.5 py-1.5 bg-background" />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground uppercase font-semibold">Bill Number</label>
                  <input value={doc.bill_number} onChange={e => updateDoc(selectedIdx, 'bill_number', e.target.value)}
                    className="w-full text-sm border border-border rounded-lg px-2.5 py-1.5 bg-background" />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground uppercase font-semibold">Bill Date</label>
                  <input type="date" value={doc.bill_date} onChange={e => updateDoc(selectedIdx, 'bill_date', e.target.value)}
                    className="w-full text-sm border border-border rounded-lg px-2.5 py-1.5 bg-background" />
                </div>
              </div>

              {doc.items.length > 0 && (
                <div className="border border-border rounded-lg overflow-x-auto">
                  <table className="w-full min-w-[500px] text-xs">
                    <thead className="bg-muted/30">
                      <tr>
                        <th className="text-left px-2.5 py-1.5">Description</th>
                        <th className="text-right px-2.5 py-1.5">Qty</th>
                        <th className="text-right px-2.5 py-1.5">Rate</th>
                        <th className="text-right px-2.5 py-1.5">GST%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {doc.items.map((it, i) => (
                        <tr key={i} className="border-t border-border">
                          <td className="px-2.5 py-1.5">{it.description}</td>
                          <td className="px-2.5 py-1.5 text-right">{it.quantity}</td>
                          <td className="px-2.5 py-1.5 text-right">{formatINR(it.rate)}</td>
                          <td className="px-2.5 py-1.5 text-right">{it.gst_rate}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* CGST+SGST (intra-state) and IGST (inter-state) are mutually
                  exclusive on a real GST invoice — never both. Showing them
                  as one combined figure would hide that distinction, and
                  would silently mask the rare case where extraction gets
                  both non-zero on the same bill (a real data error worth
                  seeing, not summing away). */}
              {doc.cgst > 0 && doc.igst > 0 && (
                <div className="p-2.5 border border-destructive/30 bg-destructive/10 text-destructive rounded-lg text-xs font-semibold">
                  ⚠ Both CGST/SGST and IGST are non-zero — a bill should only have one or the other. Please verify.
                </div>
              )}
              <div className="flex justify-end">
                <div className="w-64 space-y-1 text-sm">
                  <div className="flex justify-between text-muted-foreground"><span>Taxable Value</span><span>{formatINR(doc.taxable_value)}</span></div>
                  {doc.discount > 0 && (
                    <div className="flex justify-between text-muted-foreground"><span>Discount</span><span>-{formatINR(doc.discount)}</span></div>
                  )}
                  {doc.igst > 0 ? (
                    <div className="flex justify-between text-muted-foreground"><span>IGST (inter-state)</span><span>{formatINR(doc.igst)}</span></div>
                  ) : (
                    <>
                      <div className="flex justify-between text-muted-foreground"><span>CGST</span><span>{formatINR(doc.cgst)}</span></div>
                      <div className="flex justify-between text-muted-foreground"><span>SGST</span><span>{formatINR(doc.sgst)}</span></div>
                    </>
                  )}
                  {doc.round_off !== 0 && (
                    <div className="flex justify-between text-muted-foreground"><span>Round-off</span><span>{formatINR(doc.round_off)}</span></div>
                  )}
                  <div className="flex justify-between font-bold border-t border-border pt-1"><span>Total</span><span>{formatINR(doc.total)}</span></div>
                </div>
              </div>

              {docs.length > 1 && (
                <button type="button" onClick={() => removeDoc(selectedIdx)} className="text-xs text-destructive flex items-center gap-1">
                  <Trash2 className="w-3.5 h-3.5" /> Remove this file from import
                </button>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={handleClose}>Cancel</Button>
            <Button onClick={handleImportAll} disabled={processing || anyRetrying || docs.every(d => d.error)}>
              {processing ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> {status || 'Importing...'}</> : `Import ${docs.filter(d => !d.error).length} Bill(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // ---- Upload screen ----
  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><UploadCloud className="w-5 h-5 text-primary" /> Upload Purchase Bill</DialogTitle>
          <DialogDescription>Drop a photo or PDF of a supplier's bill — AI extracts supplier, items, and GST automatically.</DialogDescription>
        </DialogHeader>
        <button type="button" onClick={() => inputRef.current?.click()} disabled={processing}
          className="border-2 border-dashed border-border rounded-xl p-10 flex flex-col items-center gap-3 hover:border-primary/40 transition-colors disabled:opacity-60">
          {processing ? <Loader2 className="w-8 h-8 text-primary animate-spin" /> : <UploadCloud className="w-8 h-8 text-muted-foreground" />}
          <p className="text-sm font-medium">{processing ? (status || 'Processing...') : 'Click to select files'}</p>
          <p className="text-xs text-muted-foreground">PDF, PNG, JPG, WEBP — up to {MAX_FILES_PER_BATCH} files at once, read several at a time</p>
        </button>
        <input ref={inputRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp" className="hidden" onChange={handleFileChange} />
        {notice && (
          <div role="alert" className="flex items-start gap-2 text-sm p-3 rounded-lg bg-destructive/10 text-destructive">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{notice}</span>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
