import { useState, useRef, useEffect } from 'react';
import { useChat } from '../context/ChatContext';
import ResponseCard from '../components/ResponseCard';
import SourceViewer from '../components/SourceViewer';
import TargetSelector from '../components/TargetSelector';
import VoiceInput from '../components/VoiceInput';
import { getAgents, getCollections, sendQuery } from '../services/api';

export default function ChatPage() {
  const { chats, activeChat, activeChatId, setActiveChatId, addMessage, setChatSession, renameChat, deleteChat, createNewChat } = useChat();
  const messages = activeChat?.messages || [];
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState(null);
  const [chatMenu, setChatMenu] = useState(null);
  const [renamingChat, setRenamingChat] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  // RAM targets (agents + collections) for the dropdown
  const [agents, setAgents] = useState([]);
  const [collections, setCollections] = useState([]);
  const [target, setTarget] = useState(null);
  const [targetsLoading, setTargetsLoading] = useState(true);
  const [targetsError, setTargetsError] = useState(null);

  const inputRef = useRef(null);
  const endRef = useRef(null);

  useEffect(() => {
    Promise.allSettled([getAgents(), getCollections()]).then(([a, c]) => {
      const agentList = a.status === 'fulfilled' ? a.value : [];
      const collList = c.status === 'fulfilled' ? c.value : [];
      setAgents(agentList);
      setCollections(collList);
      if (a.status === 'rejected' && c.status === 'rejected') {
        setTargetsError(a.reason?.message || 'Could not reach SAS RAM');
      } else if (agentList.length > 0) {
        // Default to the first published agent
        setTarget({ type: 'agent', id: agentList[0].id, name: agentList[0].name });
      } else if (collList.length > 0) {
        setTarget({ type: 'collection', id: collList[0].id, name: collList[0].name });
      }
      setTargetsLoading(false);
    });
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  const send = async (text) => {
    const q = (text || input).trim();
    if (!q || loading) return;
    if (!target) {
      addMessage(activeChatId, { role: 'assistant', type: 'text', content: 'Select an agent from the dropdown first.', isError: true });
      return;
    }
    setInput('');
    addMessage(activeChatId, { role: 'user', type: 'text', content: q });
    setLoading(true);
    try {
      const res = await sendQuery(q, target, activeChat?.sessionId || null);
      if (res.querySessionId) setChatSession(activeChatId, res.querySessionId);
      if (res.errorCode && res.errorCode !== 0) {
        addMessage(activeChatId, { role: 'assistant', type: 'text', content: `RAM error: ${res.errorText || 'query failed'}`, isError: true });
      } else {
        addMessage(activeChatId, { role: 'assistant', type: 'structured', data: res, query: q });
      }
    } catch (err) {
      addMessage(activeChatId, { role: 'assistant', type: 'text', content: `Error: ${err.message}`, isError: true });
    }
    setLoading(false);
    inputRef.current?.focus();
  };

  const startRename = (chat) => { setRenamingChat(chat.id); setRenameValue(chat.title); setChatMenu(null); };
  const finishRename = (id) => { if (renameValue.trim()) renameChat(id, renameValue.trim()); setRenamingChat(null); };

  return (
    <div className="h-full flex gap-4 p-4">

      {/* Chat history panel (left) — past RAM query sessions + local chats */}
      <div className="w-[260px] shrink-0 glass-card flex flex-col">
        <div className="p-4 border-b border-[rgba(0,114,206,0.10)]">
          <p className="text-[10px] font-bold tracking-widest uppercase" style={{ color: 'var(--gold)' }}>Recent conversations</p>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {chats.map(chat => {
            const isRenaming = renamingChat === chat.id;
            const menuOpen = chatMenu === chat.id;
            return (
              <div key={chat.id} className="relative group">
                {isRenaming ? (
                  <div className="px-2 py-1.5">
                    <input value={renameValue} onChange={e => setRenameValue(e.target.value)}
                      onBlur={() => finishRename(chat.id)} onKeyDown={e => e.key === 'Enter' && finishRename(chat.id)} autoFocus
                      className="w-full rounded-lg px-2 py-1.5 text-xs border outline-none"
                      style={{ background: 'rgba(255,255,255,0.5)', borderColor: 'var(--gold-hi)', color: 'var(--text)' }} />
                  </div>
                ) : (
                  <div className="flex items-center">
                    <button onClick={() => setActiveChatId(chat.id)}
                      className={`flex-1 flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs text-left truncate transition-all ${
                        chat.id === activeChatId
                          ? 'font-semibold'
                          : 'hover:bg-[rgba(0,114,206,0.05)] border border-transparent'
                      }`}
                      style={chat.id === activeChatId
                        ? { color: 'var(--gold-lo)', background: 'rgba(0,114,206,0.14)', border: '1px solid rgba(0,114,206,0.30)', borderLeft: '3px solid var(--gold)' }
                        : { color: 'var(--text-md)' }
                      }>
                      <span className="text-sm">💬</span>
                      <span className="truncate flex-1">{chat.title}</span>
                    </button>
                    <button onClick={e => { e.stopPropagation(); setChatMenu(menuOpen ? null : chat.id); }}
                      className="p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-[rgba(0,114,206,0.1)] transition-all shrink-0 ml-0.5"
                      style={{ color: 'var(--text-faint)' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
                      </svg>
                    </button>
                  </div>
                )}
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setChatMenu(null)} />
                    <div className="absolute right-0 top-full mt-0.5 rounded-xl shadow-xl overflow-hidden z-50 min-w-[130px] animate-fade-up"
                      style={{ background: 'rgba(255,255,255,0.96)', border: '1px solid rgba(0,114,206,0.2)', backdropFilter: 'blur(20px)' }}>
                      <button onClick={() => startRename(chat)} className="w-full flex items-center gap-2 px-3 py-2 text-[11px] hover:bg-[rgba(0,114,206,0.05)]" style={{ color: 'var(--text-md)' }}>
                        Rename
                      </button>
                      <button onClick={() => { deleteChat(chat.id); setChatMenu(null); }} className="w-full flex items-center gap-2 px-3 py-2 text-[11px] hover:bg-[var(--red-bg)]" style={{ color: 'var(--red)' }}>
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
        <div className="p-3 border-t border-[rgba(0,114,206,0.10)]">
          <button onClick={() => { createNewChat(); }}
            className="w-full py-2.5 rounded-lg text-xs font-bold transition-all"
            style={{ border: '2px dashed rgba(0,114,206,0.35)', color: 'var(--gold)', background: 'rgba(0,114,206,0.03)' }}>
            + New conversation
          </button>
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex-1 glass-card flex flex-col relative" style={{ boxShadow: 'var(--glass-shadow-lg)' }}>
        <img src="/red_logo.png" alt="" className="chat-watermark" onError={e => e.target.style.display='none'} />

        {/* Header: conversation title + agent dropdown */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-[rgba(0,114,206,0.10)] relative z-[5]">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-[3px] h-4 rounded shrink-0" style={{ background: 'var(--gold-grad)' }} />
            <span className="text-sm font-bold truncate" style={{ color: 'var(--text)' }}>{activeChat?.title || 'New conversation'}</span>
          </div>
          <TargetSelector agents={agents} collections={collections} target={target}
            onChange={setTarget} loading={targetsLoading} error={targetsError} />
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 relative z-[1]">
          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-2.5 animate-fade-up ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
              {/* Avatar */}
              {msg.role === 'user' ? (
                <div className="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center text-xs font-bold"
                  style={{ background: 'rgba(0,114,206,0.12)', border: '1px solid rgba(0,114,206,0.28)', color: 'var(--gold-lo)' }}>
                  You
                </div>
              ) : (
                <div className="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center p-1"
                  style={{ background: 'var(--nav-grad)', border: '1px solid rgba(43,149,232,0.3)' }}>
                  <img src="/logo.png" alt="Assistant" className="w-full h-full object-contain" />
                </div>
              )}
              {/* Bubble */}
              <div className="max-w-[70%]">
                {msg.type === 'structured' ? (
                  <ResponseCard data={msg.data} onOpenSource={(doc) => setSource(doc)} />
                ) : (
                  <div className={`px-4 py-3 text-[13px] leading-[1.75] ${
                    msg.role === 'user' ? 'rounded-2xl rounded-tr-[4px]' : 'msg-bot-bubble'
                  } ${msg.isError ? 'text-[var(--red)]' : ''}`}
                    style={msg.role === 'user' ? {
                      background: 'rgba(0,114,206,0.10)',
                      border: '1px solid rgba(0,114,206,0.22)',
                      color: 'var(--text)',
                    } : { color: 'var(--text)' }}>
                    {msg.content}
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex gap-2.5 animate-fade-up">
              <div className="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center p-1"
                style={{ background: 'var(--nav-grad)', border: '1px solid rgba(43,149,232,0.3)' }}>
                <img src="/logo.png" alt="Assistant" className="w-full h-full object-contain" />
              </div>
              <div className="msg-bot-bubble px-4 py-3">
                <div className="flex gap-1.5">
                  {[0, 1, 2].map(j => (
                    <span key={j} className="w-1.5 h-1.5 rounded-full"
                      style={{ background: 'var(--gold)', opacity: 0.3, animation: `pop 1.4s ease-in-out infinite ${j * 0.15}s` }} />
                  ))}
                </div>
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* Input bar */}
        <div className="px-5 pb-4 pt-2 relative z-[1]">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-xl border border-[rgba(0,114,206,0.20)] transition-all focus-within:border-[var(--gold-hi)] focus-within:shadow-[0_0_0_3px_rgba(0,114,206,0.10)]"
            style={{ background: 'rgba(255,255,255,0.65)', backdropFilter: 'blur(12px)' }}>
            <VoiceInput onTranscript={text => send(text)} disabled={loading} />

            <textarea ref={inputRef} rows="1" value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={target ? `Ask ${target.name} anything…` : 'Select an agent above, then ask anything…'}
              className="flex-1 bg-transparent border-none outline-none text-[13px] py-2 px-2 resize-none leading-relaxed"
              style={{ fontFamily: 'Inter, sans-serif', color: 'var(--text)' }} />

            <button onClick={() => send()}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0 hover:scale-105 transition-transform"
              style={{ background: 'var(--gold-grad)', boxShadow: '0 3px 12px rgba(0,114,206,0.30)' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      {source && <SourceViewer source={source} onClose={() => setSource(null)} />}
    </div>
  );
}
