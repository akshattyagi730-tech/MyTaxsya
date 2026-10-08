import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import api from '@/services/api';
import { Send, Bot, User, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const GREETING = "Hello! I'm your AI accounting assistant. I look things up directly in your books — GST payable, input tax credit, invoices, purchase bills and what customers owe you — so the numbers match GST Center. Ask me anything.";

// What the assistant looked up, in words a business owner would recognise.
const SOURCE_LABELS = {
  get_gst_summary: 'GST summary',
  get_sales_summary: 'Sales',
  get_purchase_summary: 'Purchases',
  get_receivables: 'Receivables',
  get_expense_summary: 'Expenses',
  find_invoices: 'Invoices',
  find_purchase_bills: 'Purchase bills',
  get_business_profile: 'Business profile',
};

const SUGGESTIONS = [
  'How much GST do I owe this month?',
  'What ITC can I claim this month?',
  'Which customers owe me money?',
  'Who are my top customers this financial year?',
];

// Replies use only bold and simple bullets, so a handful of element styles is enough.
const markdownComponents = {
  p: ({ children }) => <p className="text-sm leading-relaxed [&:not(:last-child)]:mb-2">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-5 space-y-1 text-sm my-2">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1 text-sm my-2">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
};

// The AI Assistant chat itself — no page chrome, so it can be dropped into
// the /assistant page (inside PageHeader + a max-width wrapper) or into the
// right-side AssistantDrawer opened from the floating button, unchanged.
export default function AssistantPanel({ bordered = true }) {
  const [messages, setMessages] = useState([{ role: 'assistant', content: GREETING }]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleSend = async (overrideText) => {
    const text = (overrideText ?? input).trim();
    if (!text || loading) return;

    // The greeting is UI chrome, not part of the conversation the model should see.
    const history = messages.slice(1).map(({ role, content }) => ({ role, content }));
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setInput('');
    setLoading(true);
    try {
      const res = await api.post('/assistant/chat', { message: text, history });
      const data = res.data;
      const reply = typeof data === 'string' ? data : data.reply;
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: reply,
        sources: typeof data === 'string' ? [] : (data.sources || []),
        degraded: typeof data === 'string' ? false : !!data.degraded,
      }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: err?.data?.error || 'Sorry, I could not reach the assistant. Please try again in a moment.',
        degraded: true,
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`flex-1 flex flex-col overflow-hidden min-h-0 ${bordered ? 'bg-card border border-border rounded-xl' : ''}`}>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, i) => {
          const sourceLabels = [...new Set((msg.sources || []).map(s => SOURCE_LABELS[s.tool]).filter(Boolean))];
          return (
            <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-gradient-to-br from-primary to-secondary text-white'}`}>
                {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>
              <div className="max-w-[80%] min-w-0">
                <div className={`rounded-2xl px-4 py-2.5 ${msg.role === 'user' ? 'bg-primary text-primary-foreground' : msg.degraded ? 'bg-accent/10 border border-accent/30' : 'bg-muted'}`}>
                  {msg.role === 'user'
                    ? <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                    : <ReactMarkdown components={markdownComponents}>{msg.content}</ReactMarkdown>}
                </div>
                {sourceLabels.length > 0 && (
                  <p className="mt-1.5 ml-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Database className="w-3 h-3" />
                    Checked: {sourceLabels.join(' · ')}
                  </p>
                )}
              </div>
            </div>
          );
        })}
        {loading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-secondary text-white flex items-center justify-center"><Bot className="w-4 h-4" /></div>
            <div className="bg-muted rounded-2xl px-4 py-2.5 flex items-center gap-2">
              <div className="flex gap-1">
                <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
              <span className="text-xs text-muted-foreground">Checking your books…</span>
            </div>
          </div>
        )}
        <div ref={scrollRef} />
      </div>
      <div className="p-4 border-t border-border space-y-3">
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
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
            placeholder="Ask about your GST, invoices, or dues..." className="h-11" disabled={loading} maxLength={2000} />
          <Button onClick={() => handleSend()} disabled={loading || !input.trim()} className="h-11 px-4" aria-label="Send">
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
