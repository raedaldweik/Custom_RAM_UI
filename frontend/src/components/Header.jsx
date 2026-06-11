import { useState, useEffect } from 'react';
import { getHealth } from '../services/api';

export default function Header() {
  const [health, setHealth] = useState(null);

  useEffect(() => {
    getHealth().then(setHealth).catch(() => setHealth({ status: 'down' }));
  }, []);

  const ok = health?.status === 'ok';

  return (
    <header className="app-header">
      {/* American Express logo — left */}
      <img className="brand-logo" src="/amex_logo.svg" alt="American Express"
        onError={e => { e.target.style.display = 'none'; }} />

      {/* Title + blue accent line */}
      <div className="title-block">
        <div className="title-row">
          <h1 className="app-title">American Express Smart Assistant</h1>
          <div className="accent-line" />
        </div>
      </div>

      {/* Connection status — right */}
      <div className="status-pill">
        <span className={`w-2 h-2 rounded-full ${ok ? '' : 'animate-pulse'}`}
          style={{ background: ok ? 'var(--green)' : health ? 'var(--red)' : 'var(--amber)' }} />
        <span>
          {health == null ? 'Connecting…'
            : health.mode === 'mock' ? 'Mock mode'
            : ok ? 'Connected'
            : health.status === 'unconfigured' ? 'Not configured'
            : 'Backend offline'}
        </span>
      </div>
    </header>
  );
}
