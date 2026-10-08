import test from 'node:test';
import assert from 'node:assert/strict';
import { amountInWordsINR, formatMoney, gstSummary, lineTaxable, paymentLabel, roundOffOf } from './invoiceDocument.js';

test('amount in words uses the Indian system and includes paise', () => {
  assert.equal(amountInWordsINR(166468.5), 'One Lakh Sixty Six Thousand Four Hundred Sixty Eight Rupees and Fifty Paise Only');
  assert.equal(amountInWordsINR(49394), 'Forty Nine Thousand Three Hundred Ninety Four Rupees Only');
  assert.equal(amountInWordsINR(10000000), 'One Crore Rupees Only');
  assert.equal(amountInWordsINR(100), 'One Hundred Rupees Only');
  assert.equal(amountInWordsINR(0.5), 'Fifty Paise Only');
  assert.equal(amountInWordsINR(0), 'Zero Rupees Only');
});

test('formatMoney keeps paise and Indian grouping', () => {
  assert.equal(formatMoney(166468.5), '1,66,468.50');
  assert.equal(formatMoney(2271), '2,271.00');
  assert.equal(formatMoney(null), '0.00');
});

test('line taxable prefers the stored (post-discount) amount, else qty x rate', () => {
  assert.equal(lineTaxable({ quantity: 2, rate: 500, amount: 900 }), 900);
  assert.equal(lineTaxable({ quantity: 2, rate: 500 }), 1000);
});

test('GST summary spreads the invoice tax over rates and sums exactly', () => {
  const rows = gstSummary({
    items: [{ quantity: 1, rate: 1000, gst_rate: 18 }, { quantity: 1, rate: 1000, gst_rate: 5 }],
    cgst: 115, sgst: 115, igst: 0,
  });
  assert.equal(rows.length, 2);
  assert.equal(rows.reduce((s, r) => s + r.cgst, 0).toFixed(2), '115.00');
  assert.equal(rows.reduce((s, r) => s + r.sgst, 0).toFixed(2), '115.00');
  assert.equal(rows[0].taxable, 1000);
});

test('round-off and payment label', () => {
  assert.equal(roundOffOf({ subtotal: 36750, igst: 1837.5, total: 38588 }), 0.5);
  assert.equal(paymentLabel({ total: 100, paid_amount: 100 }), 'PAID');
  assert.equal(paymentLabel({ total: 100, paid_amount: 40 }), 'PARTIALLY PAID');
  assert.equal(paymentLabel({ total: 100, paid_amount: 0, status: 'sent' }), 'UNPAID');
  assert.equal(paymentLabel({ total: 100, paid_amount: 0, status: 'draft' }), 'DRAFT');
});
