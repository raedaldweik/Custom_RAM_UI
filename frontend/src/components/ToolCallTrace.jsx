import { useState } from 'react';

const fmt = (v) => {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
};

/** Collapsible trace of the tool calls RAM's agent made while answering. */
export default function ToolCallTrace({ toolCalls }) {
  const [open, setOpen] = useState(false);
  if (!toolCalls || toolCalls.length === 0) return null;

  return (
    <div className="trace-panel mt-2">
      <div className="trace-header" onClick={() => setOpen(!open)}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 3" />
        </svg>
        <span>Agent tool calls · {toolCalls.length} step{toolCalls.length !== 1 ? 's' : ''}</span>
        <div className="flex-1" />
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {open && (
        <div className="animate-slide-up">
          {toolCalls.map((call, i) => (
            <div key={i} className="trace-step">
              <div className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5"
                style={{ background: 'rgba(12,110,122,0.15)', color: 'var(--teal)' }}>
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  <span className="trace-step-tool">{call.toolName || call.name || 'tool'}</span>
                </div>
                {call.input && (
                  <div className="mt-1 text-[10.5px] px-2 py-1 rounded font-mono break-all"
                    style={{ background: 'rgba(12,110,122,0.04)', color: 'var(--text-dim)', border: '1px solid rgba(12,110,122,0.08)' }}>
                    in: {fmt(call.input).slice(0, 400)}
                  </div>
                )}
                {call.output && (
                  <div className="mt-1 text-[10.5px] px-2 py-1 rounded font-mono break-all"
                    style={{ background: 'rgba(12,110,122,0.04)', color: 'var(--text-dim)', border: '1px solid rgba(12,110,122,0.08)' }}>
                    out: {fmt(call.output).slice(0, 400)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
