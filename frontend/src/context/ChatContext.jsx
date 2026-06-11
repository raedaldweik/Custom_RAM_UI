import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getSessions, getSessionQueries } from '../services/api';

const ChatContext = createContext();

const WELCOME = {
  role: 'assistant',
  type: 'text',
  content: "Welcome. I'm connected to SAS Retrieval Agent Manager. Pick an agent (or collection) from the dropdown above and ask me anything — answers are grounded in the documents indexed on your Viya environment.",
};
const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const NEW_TITLE = 'New conversation';

// Rebuild chat bubbles from RAM's persisted query records
function messagesFromQueries(queries) {
  const msgs = [WELCOME];
  for (const q of queries) {
    msgs.push({ role: 'user', type: 'text', content: q.content });
    if (q.errorCode && q.errorCode !== 0) {
      msgs.push({ role: 'assistant', type: 'text', content: `Error: ${q.errorText || 'query failed'}`, isError: true });
    } else if (q.answer != null) {
      msgs.push({ role: 'assistant', type: 'structured', data: q, query: q.content });
    }
  }
  return msgs;
}

export function ChatProvider({ children }) {
  const [chats, setChats] = useState([{ id: id(), sessionId: null, title: NEW_TITLE, messages: [WELCOME], loaded: true }]);
  const [activeChatId, setActiveChatId] = useState(chats[0].id);

  const activeChat = chats.find(c => c.id === activeChatId) || chats[0];

  // Pull past query sessions from RAM so history survives reloads
  useEffect(() => {
    getSessions().then(sessions => {
      setChats(prev => {
        const known = new Set(prev.map(c => c.sessionId).filter(Boolean));
        const stubs = sessions
          .filter(s => s.id && !known.has(s.id))
          .map(s => ({ id: id(), sessionId: s.id, title: s.title || 'Conversation', messages: [WELCOME], loaded: false }));
        return [...prev, ...stubs];
      });
    }).catch(() => {});
  }, []);

  // Lazy-load a server session's messages the first time it's opened
  useEffect(() => {
    const chat = chats.find(c => c.id === activeChatId);
    if (!chat || chat.loaded || !chat.sessionId) return;
    getSessionQueries(chat.sessionId)
      .then(queries => {
        setChats(prev => prev.map(c => c.id === chat.id ? { ...c, loaded: true, messages: messagesFromQueries(queries) } : c));
      })
      .catch(() => {
        setChats(prev => prev.map(c => c.id === chat.id ? { ...c, loaded: true } : c));
      });
  }, [activeChatId, chats]);

  const createNewChat = useCallback(() => {
    const c = { id: id(), sessionId: null, title: NEW_TITLE, messages: [WELCOME], loaded: true };
    setChats(p => [c, ...p]);
    setActiveChatId(c.id);
  }, []);

  const addMessage = useCallback((chatId, msg) => {
    setChats(p => p.map(c => {
      if (c.id !== chatId) return c;
      const updated = { ...c, messages: [...c.messages, msg] };
      if (msg.role === 'user' && c.title === NEW_TITLE)
        updated.title = msg.content.slice(0, 40) + (msg.content.length > 40 ? '...' : '');
      return updated;
    }));
  }, []);

  // Record the querySessionId RAM assigned on the first reply
  const setChatSession = useCallback((chatId, sessionId) => {
    setChats(p => p.map(c => c.id === chatId && !c.sessionId ? { ...c, sessionId } : c));
  }, []);

  const renameChat = useCallback((chatId, newTitle) => {
    setChats(p => p.map(c => c.id === chatId ? { ...c, title: newTitle } : c));
  }, []);

  const deleteChat = useCallback((chatId) => {
    setChats(p => {
      const filtered = p.filter(c => c.id !== chatId);
      if (filtered.length === 0)
        return [{ id: id(), sessionId: null, title: NEW_TITLE, messages: [WELCOME], loaded: true }];
      return filtered;
    });
    setActiveChatId(prev => {
      if (prev === chatId) {
        const remaining = chats.filter(c => c.id !== chatId);
        return remaining.length > 0 ? remaining[0].id : prev;
      }
      return prev;
    });
  }, [chats]);

  return (
    <ChatContext.Provider value={{ chats, activeChat, activeChatId, setActiveChatId, createNewChat, addMessage, setChatSession, renameChat, deleteChat }}>
      {children}
    </ChatContext.Provider>
  );
}

export const useChat = () => useContext(ChatContext);
