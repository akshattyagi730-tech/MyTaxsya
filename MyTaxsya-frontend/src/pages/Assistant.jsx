import PageHeader from '@/components/PageHeader';
import AssistantPanel from '@/components/AssistantPanel';

export default function Assistant() {
  return (
    <div className="max-w-[1000px] mx-auto h-[calc(100vh-8rem)] flex flex-col">
      <PageHeader title="AI Assistant" subtitle="Ask about GST, ITC, invoices and dues — answers come straight from your books" />
      <AssistantPanel />
    </div>
  );
}
