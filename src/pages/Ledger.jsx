import { useState, useEffect, useMemo } from 'react';
import apiClient from '@/api/apiClient';
import PageHeader from '@/Components/PageHeader';
import DataTable from '@/Components/DataTable';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/Components/ui/select';
import { formatINR, formatDate } from '@/lib/format';

export default function Ledger() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [typeFilter, setTypeFilter] = useState('all');

  useEffect(() => {
    const load = async () => {
      try {
        const [invoicesRes, paymentsRes, expensesRes] = await Promise.all([
          apiClient.get('/entities/Invoice', { params: { sort: '-created_date', limit: 200 } }),
          apiClient.get('/entities/Payment', { params: { sort: '-created_date', limit: 200 } }),
          apiClient.get('/entities/Expense', { params: { sort: '-created_date', limit: 200 } }),
        ]);
        const invoices = invoicesRes.data;
        const payments = paymentsRes.data;
        const expenses = expensesRes.data;

        const all = [
          ...invoices.map(i => ({ id: i.id, date: i.invoice_date, description: `Invoice ${i.invoice_number}`, type: 'invoice', party: i.customer_name, debit: i.total, credit: 0 })),
          ...payments.map(p => ({ id: p.id, date: p.date, description: `Payment ${p.payment_number}`, type: 'payment', party: p.customer_name, debit: 0, credit: p.amount })),
          ...expenses.map(e => ({ id: e.id, date: e.date, description: e.title, type: 'expense', party: e.vendor, debit: 0, credit: e.amount })),
        ];
        all.sort((a, b) => new Date(a.date) - new Date(b.date));
        let balance = 0;
        const withBalance = all.map(t => {
          balance += t.debit - t.credit;
          return { ...t, balance };
        }).reverse();
        setTransactions(withBalance);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const filtered = useMemo(() =>
    typeFilter === 'all' ? transactions : transactions.filter(t => t.type === typeFilter),
    [transactions, typeFilter]
  );

  const columns = [
    { key: 'date', label: 'Date', sortable: true, render: (r) => formatDate(r.date) },
    { key: 'description', label: 'Description', sortable: true },
    { key: 'type', label: 'Type', sortable: true, render: (r) => <span className="capitalize">{r.type}</span> },
    { key: 'party', label: 'Party' },
    { key: 'debit', label: 'Debit (In)', render: (r) => r.debit ? <span className="text-emerald-600 font-medium">{formatINR(r.debit)}</span> : '—' },
    { key: 'credit', label: 'Credit (Out)', render: (r) => r.credit ? <span className="text-rose-600 font-medium">{formatINR(r.credit)}</span> : '—' },
    { key: 'balance', label: 'Balance', render: (r) => <span className="font-bold">{formatINR(r.balance)}</span> },
  ];

  return (
    <div className="max-w-[1400px] mx-auto">
      <PageHeader title="Ledger" subtitle="Unified view of all financial transactions" />
      <DataTable
        data={filtered} columns={columns} loading={loading} error={error}
        searchKeys={['description', 'party']}
        toolbar={
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-36 h-10"><SelectValue placeholder="All Types" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="invoice">Invoices</SelectItem>
              <SelectItem value="payment">Payments</SelectItem>
              <SelectItem value="expense">Expenses</SelectItem>
            </SelectContent>
          </Select>
        }
      />
    </div>
  );
}