/** Modal that shows the retrieved passage that grounded an answer. */
export default function SourceViewer({ source, onClose }) {
  if (!source) return null;
  const meta = source.metadata || {};
  const title = meta.filename || meta.source || meta.file_name || meta.title || 'Retrieved passage';

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-6" onClick={onClose}
      style={{ background: 'rgba(10,37,64,0.45)', backdropFilter: 'blur(4px)' }}>
      <div className="glass-card w-full max-w-[640px] max-h-[80vh] flex flex-col animate-slide-up"
        onClick={e => e.stopPropagation()} style={{ background: 'rgba(255,255,255,0.95)' }}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-[rgba(0,114,206,0.10)]">
          <div className="flex items-center gap-2 min-w-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" className="shrink-0">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
            </svg>
            <span className="text-sm font-bold truncate" style={{ color: 'var(--text)' }}>{title}</span>
            {meta.page != null && (
              <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                style={{ background: 'rgba(0,114,206,0.08)', color: 'var(--gold)' }}>p. {meta.page}</span>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[rgba(0,114,206,0.08)]" style={{ color: 'var(--text-dim)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="text-[12.5px] leading-[1.8] whitespace-pre-wrap" style={{ color: 'var(--text-md)' }}>
            {source.pageContent || source.page_content || source.content || '(no text content)'}
          </p>
        </div>
      </div>
    </div>
  );
}
