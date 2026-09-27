import PageHeader from '@/components/PageHeader';
import AssistantPanel from '@/components/AssistantPanel';

export default function Assistant() {
  return (
    <div className="max-w-[1000px] mx-auto h-[calc(100vh-8rem)] flex flex-col">
      <PageHeader title="AI Assistant" subtitle="Ask questions about your business" />
      <AssistantPanel />
    </div>
  );
}
