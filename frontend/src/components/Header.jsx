import { useState, useEffect, useRef } from 'react';
import { getHealth, startDeviceAuth, pollDeviceAuth } from '../services/api';

export default function Header() {
  const [health, setHealth] = useState(null);
  const [signin, setSignin] = useState(null);      // device-flow info while the modal is open
  const [signinError, setSigninError] = useState(null);
  const pollTimer = useRef(null);

  useEffect(() => {
    getHealth().then(setHealth).catch(() => setHealth({ status: 'down' }));
    return () => clearTimeout(pollTimer.current);
  }, []);

  const ok = health?.status === 'ok';
  const needsSignin = health?.status === 'signin_required';

  const beginSignin = async () => {
    setSigninError(null);
    try {
      const info = await startDeviceAuth();
      setSignin(info);
      let interval = Math.max(info.interval || 5, 3) * 1000;
      const tick = async () => {
        try {
          const res = await pollDeviceAuth();
          if (res.ok) {
            // Signed in — reload so agents/collections/history load fresh
            window.location.reload();
            return;
          }
          if (res.slowDown) interval += 2000;
        } catch (e) {
          setSigninError(e.message);
          return; // stop polling on a real error (denied / expired)
        }
        pollTimer.current = setTimeout(tick, interval);
      };
      pollTimer.current = setTimeout(tick, interval);
    } catch (e) {
      setSigninError(e.message);
      setSignin({});
    }
  };

  const cancelSignin = () => {
    clearTimeout(pollTimer.current);
    setSignin(null);
    setSigninError(null);
  };

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
      <div className="flex items-center gap-2">
        <div className="status-pill">
          <span className={`w-2 h-2 rounded-full ${ok ? '' : 'animate-pulse'}`}
            style={{ background: ok ? 'var(--green)' : needsSignin ? 'var(--amber)' : health ? 'var(--red)' : 'var(--amber)' }} />
          <span>
            {health == null ? 'Connecting…'
              : health.mode === 'mock' ? 'Mock mode'
              : ok ? 'Connected'
              : needsSignin ? 'Sign in required'
              : health.status === 'unconfigured' ? 'Not configured'
              : 'Backend offline'}
          </span>
        </div>
        {needsSignin && (
          <button onClick={beginSignin}
            className="px-4 py-1.5 rounded-full text-[11px] font-bold text-white hover:scale-105 transition-transform"
            style={{ background: 'var(--gold-grad)', boxShadow: '0 3px 12px rgba(0,111,207,0.30)' }}>
            Sign in
          </button>
        )}
      </div>

      {/* Device sign-in modal */}
      {signin && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6"
          style={{ background: 'rgba(10,22,40,0.45)', backdropFilter: 'blur(4px)' }}>
          <div className="glass-card w-full max-w-[440px] p-7 animate-slide-up"
            style={{ background: 'rgba(255,255,255,0.95)' }}>
            <div className="flex items-center gap-3 mb-5">
              <img src="/amex_logo.svg" alt="" className="w-10 h-10 rounded-lg" />
              <div>
                <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>Sign in to your assistant</p>
                <p className="text-[11px]" style={{ color: 'var(--text-dim)' }}>Authenticate with your RAM credentials</p>
              </div>
            </div>

            {signinError ? (
              <div className="rounded-lg px-4 py-3 mb-5 text-[12px]"
                style={{ background: 'var(--red-bg)', color: 'var(--red)', border: '1px solid rgba(185,28,44,0.22)' }}>
                {signinError}
              </div>
            ) : (
              <>
                <p className="text-[12.5px] leading-relaxed mb-4" style={{ color: 'var(--text-md)' }}>
                  Open the verification page, sign in (e.g. as <b>AppAdmin</b>), and enter this code:
                </p>
                <div className="rounded-xl py-4 text-center mb-4"
                  style={{ background: 'rgba(0,111,207,0.07)', border: '1px dashed rgba(0,111,207,0.35)' }}>
                  <span className="text-2xl font-extrabold tracking-[0.3em]" style={{ color: 'var(--gold)' }}>
                    {signin.userCode}
                  </span>
                </div>
                <a href={signin.verificationUriComplete || signin.verificationUri} target="_blank" rel="noreferrer"
                  className="block w-full text-center py-2.5 rounded-lg text-[12.5px] font-bold text-white mb-3 hover:opacity-90 transition-opacity"
                  style={{ background: 'var(--gold-grad)', boxShadow: '0 3px 12px rgba(0,111,207,0.30)' }}>
                  Open verification page ↗
                </a>
                <div className="flex items-center justify-center gap-2 text-[11px]" style={{ color: 'var(--text-dim)' }}>
                  <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--gold)' }} />
                  Waiting for approval…
                </div>
              </>
            )}

            <button onClick={cancelSignin}
              className="w-full mt-4 py-2 rounded-lg text-[11.5px] font-semibold transition-all hover:bg-[rgba(15,23,42,0.04)]"
              style={{ border: '1px solid var(--hairline)', color: 'var(--text-dim)' }}>
              {signinError ? 'Close' : 'Cancel'}
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
