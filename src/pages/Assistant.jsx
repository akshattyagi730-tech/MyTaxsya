import { useState, useEffect, useRef } from 'react';
import apiClient from '@/api/apiClient';
import PageHeader from '@/components/PageHeader';
import { Send, Bot, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function Assistant() {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: "Hello! I'm your AI business assistant. I can help you understand your revenue, expenses, GST, customers, and more. Ask me anything about your business data." },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [context, setContext] = useState('');
  const scrollRef = useRef(null);

  useEffect(() => {
    const loadContext = async () => {
      try {
        const [invoicesRes, customersRes, expensesRes, paymentsRes, productsRes] = await Promise.all([
          apiClient.get('/entities/Invoice', { params: { limit: 100 } }),
          apiClient.get('/entities/Customer', { params: { limit: 100 } }),
          apiClient.get('/entities/Expense', { params: { limit: 100 } }),
          apiClient.get('/entities/Payment', { params: { limit: 100 } }),
          apiClient.get('/entities/Product', { params: { limit: 100 } }),
        ]);
        const invoices = invoicesRes.data;
        const customers = customersRes.data;
        const expenses = expensesRes.data;
        const payments = paymentsRes.data;
        const products = productsRes.data;

        const revenue = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.total || 0), 0);
        const outstanding = invoices.filter(i => i.status === 'sent' || i.status === 'overdue').reduce((s, i) => s + (i.balance_due || 0), 0);
        const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);
        const gstCollected = invoices.reduce((s, i) => s + (i.cgst || 0) + (i.sgst || 0) + (i.igst || 0), 0);
        const ctx = `Business Context: Total Revenue: ₹${revenue}, Outstanding: ₹${outstanding}, Total Expenses: ₹${totalExpenses}, GST Collected: ₹${gstCollected}, Customers: ${customers.length}, Invoices: ${invoices.length}, Expenses: ${expenses.length}, Payments: ${payments.length}, Products: ${products.length}.`;
        setContext(ctx);
      } catch (e) { /* context optional */ }
    };
    loadContext();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const suggestions = [
    'Show my pending ITC for this month',
    'Which customers have overdue invoices?',
    'Summarize my net GST liability',
  ];

  const handleSend = async (overrideText) => {
    const text = (overrideText ?? input).trim();
    if (!text || loading) return;
    const userMessage = { role: 'user', content: text };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);
    try {
      const res = await apiClient.post('/assistant/chat', {
        prompt: `${context}\n\nUser Question: ${text}\n\nPlease answer based on the business context provided. Keep answers concise and helpful. Use Indian Rupee (₹) for monetary values.`,
      });
      setMessages(prev => [...prev, { role: 'assistant', content: typeof res.data === 'string' ? res.data : JSON.stringify(res.data) }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, I encountered an error. Please try again.' }]);
    } finally {
      scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
      setLoading(false);
    }
  };

  return (
    <div className="max-w-[1000px] mx-auto h-[calc(100vh-8rem)] flex flex-col">
      <PageHeader title="AI Assistant" subtitle="Ask questions about your business" />
      <div className="flex-1 bg-card border border-border rounded-xl flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-gradient-to-br from-indigo-500 to-violet-600 text-white'}`}>
                {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>
              <div className={`rounded-2xl px-4 py-2.5 max-w-[80%] ${msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center"><Bot className="w-4 h-4" /></div>
              <div className="bg-muted rounded-2xl px-4 py-2.5">
                <div className="flex gap-1">
                  <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}
          <div ref={scrollRef} />
        </div>
        <div className="p-4 border-t border-border space-y-3">
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => handleSend(s)}
                disabled={loading}
                className="px-3 py-1.5 rounded-full text-xs font-medium bg-muted hover:bg-primary hover:text-primary-foreground border border-border transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {s}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Input value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              placeholder="Ask about your business..." className="h-11" disabled={loading} />
            <Button onClick={handleSend} disabled={loading || !input.trim()} className="h-11 px-4">
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}