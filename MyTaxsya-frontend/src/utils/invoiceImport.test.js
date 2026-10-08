import test from 'node:test';
import assert from 'node:assert/strict';
import { computeInvoiceAmounts, buildInvoiceItems } from './invoiceImport.js';

test('uses ex-tax line values for subtotal and the printed grand total', () => {
  const a = computeInvoiceAmounts({
    products: [{ quantity: 2, rate: 500, taxable_value: 1000, total: 1180, gst_rate: 18 }],
    totals: { cgst: 90, sgst: 90, grand_total: 1180 },
  });
  assert.equal(a.subtotal, 1000);
  assert.equal(a.total, 1180);
  assert.equal(a.round_off, 0);
});

test('computes total when no grand total is printed', () => {
  const a = computeInvoiceAmounts({
    products: [{ quantity: 1, rate: 1000, gst_rate: 18 }],
    totals: { igst: 180, discount: 100 },
  });
  assert.equal(a.total, 1080);
});

test('derives tax from line GST rates only when none is printed', () => {
  const a = computeInvoiceAmounts({ products: [{ quantity: 1, rate: 1000, gst_rate: 18 }], totals: {} });
  assert.equal(a.cgst + a.sgst, 180);
  assert.equal(a.total, 1180);
  assert.equal(a.taxSource, 'derived');
});

test('cess is included and round-off is the gap to the printed total', () => {
  const a = computeInvoiceAmounts({
    products: [{ taxable_value: 1000 }],
    totals: { igst: 280, cess: 20, grand_total: 1300 },
  });
  assert.equal(a.total, 1300);
  assert.equal(a.round_off, 0);
  const b = computeInvoiceAmounts({ products: [{ taxable_value: 999.6 }], totals: { grand_total: 1000 } });
  assert.equal(b.round_off, 0.4);
});

test('an item with no value is not filled with the invoice subtotal', () => {
  const items = buildInvoiceItems([{ description: 'A', quantity: 1, taxable_value: 500 }, { description: 'B' }]);
  assert.equal(items[0].amount, 500);
  assert.equal(items[1].amount, 0);
  assert.equal(items[1].rate, 0);
});
