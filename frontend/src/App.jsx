import { ChatProvider } from './context/ChatContext';
import Header from './components/Header';
import ChatPage from './pages/ChatPage';

export default function App() {
  return (
    <ChatProvider>
      <div className="app-shell">
        {/* Atmospheric bokeh — same layer as the dashboards */}
        <div className="bokeh-layer">
          <div className="bokeh-dot mega-teal   a1"></div>
          <div className="bokeh-dot mega-cyan   a2"></div>
          <div className="bokeh-dot mega-purple a3"></div>
          <div className="bokeh-dot mega-amber  a4"></div>
          <div className="bokeh-dot mega-cyan mega-teal-2 a5"></div>
          <div className="bokeh-dot teal-blob   m1"></div>
          <div className="bokeh-dot cyan-blob   m2"></div>
          <div className="bokeh-dot teal-blob   m3"></div>
          <div className="bokeh-dot cyan-blob   m4"></div>
          <div className="bokeh-dot teal-blob   m5"></div>
          <div className="bokeh-dot purple-blob m6"></div>
          <div className="bokeh-dot teal-blob   m7"></div>
          <div className="bokeh-dot amber-blob  m8"></div>
          <div className="bokeh-dot cyan-blob   m9"></div>
          <div className="bokeh-dot teal-blob   m10"></div>
          <div className="bokeh-dot amber-blob  m11"></div>
          <div className="bokeh-dot teal-blob   m12"></div>
          <div className="bokeh-dot purple-blob m13"></div>
          <div className="bokeh-dot cyan-blob   m14"></div>
          <div className="bokeh-dot teal-blob   m15"></div>
        </div>

        <Header />
        <div className="flex-1 min-h-0 relative z-[1]">
          <ChatPage />
        </div>
      </div>
    </ChatProvider>
  );
}
