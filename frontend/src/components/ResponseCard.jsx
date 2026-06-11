import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ToolCallTrace from './ToolCallTrace';

const sourceLabel = (doc, i) => {
  const meta = doc?.metadata || {};
  return meta.filename || meta.source || meta.file_name || meta.title || `Source ${i + 1}`;
};

const markdownComponents = {
  p: ({node, ...props}) => <p className="my-1 leading-[1.75]" {...props} />,
  strong: ({node, ...props}) => <strong style={{ color: 'var(--gold)', fontWeight: 700 }} {...props} />,
  em: ({node, ...props}) => <em style={{ color: 'var(--gold-lo)' }} {...props} />,
  ul: ({node, ...props}) => <ul className="my-1.5 space-y-0.5 pl-5 list-disc" {...props} />,
  ol: ({node, ...props}) => <ol className="my-1.5 space-y-0.5 pl-5 list-decimal" {...props} />,
  li: ({node, ...props}) => <li className="leading-[1.7]" {...props} />,
  h1: ({node, ...props}) => <h1 className="text-[15px] font-bold my-2" style={{ color: 'var(--gold)' }} {...props} />,
  h2: ({node, ...props}) => <h2 className="text-[14px] font-bold my-2" style={{ color: 'var(--gold)' }} {...props} />,
  h3: ({node, ...props}) => <h3 className="text-[13px] font-semibold my-1.5" style={{ color: 'var(--gold-lo)' }} {...props} />,
  table: ({node, ...props}) => (
    <div className="my-2 overflow-x-auto">
      <table className="border-collapse text-[12px] w-full" style={{ border: '1px solid rgba(0,114,206,0.15)' }} {...props} />
    </div>
  ),
  thead: ({node, ...props}) => <thead style={{ background: 'rgba(0,114,206,0.06)' }} {...props} />,
  th: ({node, ...props}) => <th className="px-2 py-1.5 text-left font-semibold" style={{ border: '1px solid rgba(0,114,206,0.15)', color: 'var(--gold)' }} {...props} />,
  td: ({node, ...props}) => <td className="px-2 py-1.5" style={{ border: '1px solid rgba(0,114,206,0.10)' }} {...props} />,
  code: ({node, inline, ...props}) => inline
    ? <code className="px-1 py-0.5 rounded text-[12px]" style={{ background: 'rgba(0,114,206,0.08)', color: 'var(--gold)' }} {...props} />
    : <code className="block p-2 rounded my-1 text-[12px] overflow-x-auto" style={{ background: 'rgba(0,0,0,0.04)' }} {...props} />,
  blockquote: ({node, ...props}) => <blockquote className="pl-3 my-2 italic" style={{ borderLeft: '2px solid var(--gold-lo)', color: 'var(--text-md)' }} {...props} />,
};

/** Renders one normalized RAM query response: answer, sources, tool calls, usage. */
export default function ResponseCard({ data, onOpenSource }) {
  if (!data) return null;
  const usage = data.usage || {};
  const hasUsage = usage.llmTotalTokens != null || usage.llmTotalCost != null;

  return (
    <div className="animate-slide-up space-y-2.5 max-w-[640px]">
      {/* Answer bubble */}
      <div className="msg-bot-bubble px-4 py-3">
        <div className="text-[13px]" style={{ color: 'var(--text)' }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {data.answer || '_(empty answer)_'}
          </ReactMarkdown>
        </div>
      </div>

      {/* Retrieved context — click to view the passage */}
      {data.context && data.context.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {data.context.map((doc, i) => (
            <button key={i} onClick={() => onOpenSource?.(doc)}
              title="Click to view the retrieved passage"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] transition-all cursor-pointer hover:shadow-md hover:-translate-y-[1px]"
              style={{ color: 'var(--gold-lo)', background: 'rgba(0,114,206,0.06)', border: '1px solid rgba(0,114,206,0.18)' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
              </svg>
              {sourceLabel(doc, i)}
            </button>
          ))}
        </div>
      )}

      <ToolCallTrace toolCalls={data.toolCalls} />

      {/* Usage footer */}
      {hasUsage && (
        <div className="flex items-center gap-3 px-1 text-[10px]" style={{ color: 'var(--text-faint)' }}>
          {usage.llmTotalTokens != null && <span>{usage.llmTotalTokens.toLocaleString()} tokens</span>}
          {usage.llmPromptTokens != null && <span>{usage.llmPromptTokens.toLocaleString()} prompt · {usage.llmCompletionTokens?.toLocaleString() ?? 0} completion</span>}
          {usage.llmTotalCost != null && <span>${Number(usage.llmTotalCost).toFixed(4)}</span>}
        </div>
      )}
    </div>
  );
}
