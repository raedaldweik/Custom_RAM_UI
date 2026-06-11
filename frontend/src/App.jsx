import { useState, useEffect, useRef } from 'react';
import { ChatProvider } from './context/ChatContext';
import ChatPage from './pages/ChatPage';
import { getHealth } from './services/api';

// ═══ Aurora Canvas Background (same as the Health app) ═══
function AuroraCanvas() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const cx = cv.getContext('2d');
    let W, H, t = 0, animId;

    function resize() { W = cv.width = window.innerWidth; H = cv.height = window.innerHeight; }
    resize();
    window.addEventListener('resize', resize);

    const SOURCES = [
      { ox: -.18, oy: -.22, spd: .00018, phase: 0,    rays: 60, spread: 1.05, r1: '0,114,206',  r2: '164,37,72' },
      { ox: 1.22, oy: -.15, spd: .00013, phase: 2.09, rays: 50, spread: .90,  r1: '102,14,40',  r2: '0,114,206' },
      { ox: .55,  oy: 1.28, spd: .00021, phase: 4.19, rays: 45, spread: .80,  r1: '200,164,74', r2: '218,184,102' },
    ];
    const BLOBS = [
      { xF: .15, yF: .25, rx: .55, ry: .40, rot: -.3, spd: { x: .00006, y: .00005, r: .00008 }, phase: { x: 0, y: 1.2, r: 2.1 }, al: .045, col: '0,114,206' },
      { xF: .82, yF: .18, rx: .50, ry: .35, rot: .5,  spd: { x: .00005, y: .00007, r: .00006 }, phase: { x: 3.1, y: 0.8, r: 1.4 }, al: .035, col: '164,37,72' },
      { xF: .65, yF: .75, rx: .60, ry: .38, rot: .2,  spd: { x: .00007, y: .00004, r: .00009 }, phase: { x: 1.5, y: 3.7, r: 0.6 }, al: .035, col: '200,164,74' },
    ];
    const MOTES = Array.from({ length: 50 }, () => ({
      x: Math.random(), y: Math.random(),
      vx: (Math.random() - .5) * .00012, vy: -(Math.random() * .00015 + .00004),
      r: .7 + Math.random() * 2.0, al: .015 + Math.random() * .04,
      ph: Math.random() * Math.PI * 2,
      col: Math.random() > .5 ? '0,114,206' : '164,37,72'
    }));

    function draw() {
      cx.clearRect(0, 0, W, H);
      for (const b of BLOBS) {
        const x = (b.xF + Math.sin(t * b.spd.x + b.phase.x) * .12) * W;
        const y = (b.yF + Math.sin(t * b.spd.y + b.phase.y) * .10) * H;
        const rx = b.rx * W * (1 + Math.sin(t * b.spd.r + b.phase.r) * .08);
        const ry = b.ry * H * (1 + Math.cos(t * b.spd.r + b.phase.r) * .08);
        cx.save(); cx.translate(x, y); cx.rotate(b.rot + Math.sin(t * b.spd.r * .7) * .15);
        const g = cx.createRadialGradient(0, 0, 0, 0, 0, Math.max(rx, ry));
        g.addColorStop(0, `rgba(${b.col},${b.al})`);
        g.addColorStop(.45, `rgba(${b.col},${b.al * .5})`);
        g.addColorStop(1, `rgba(${b.col},0)`);
        cx.scale(1, ry / rx); cx.beginPath(); cx.arc(0, 0, rx, 0, Math.PI * 2);
        cx.fillStyle = g; cx.fill(); cx.restore();
      }
      for (const src of SOURCES) {
        const ang = t * src.spd + src.phase;
        const sx = (src.ox + Math.cos(ang) * .06) * W;
        const sy = (src.oy + Math.sin(ang) * .06) * H;
        const fc = Math.atan2(H * .5 - sy, W * .5 - sx);
        const half = src.spread * .5;
        for (let i = 0; i < src.rays; i++) {
          const frac = i / (src.rays - 1);
          const ra = fc - half + frac * src.spread + Math.sin(t * .00025 * src.spd * 800 + frac * 7.3 + src.phase) * .012;
          const len = Math.hypot(W, H) * 1.4;
          const edgeFade = Math.pow(Math.sin(frac * Math.PI), 1.4);
          const pulse = .7 + .3 * Math.sin(t * .00031 * src.spd * 800 + frac * 3.1);
          const alpha = (0.022 + frac * .008) * edgeFade * pulse;
          const bright = i % 4 === 0;
          cx.beginPath(); cx.moveTo(sx, sy); cx.lineTo(sx + Math.cos(ra) * len, sy + Math.sin(ra) * len);
          cx.strokeStyle = `rgba(${bright ? src.r2 : src.r1},${alpha * (bright ? 1.6 : 1)})`;
          cx.lineWidth = bright ? 1.1 : .45; cx.stroke();
        }
      }
      for (const m of MOTES) {
        m.x += m.vx; m.y += m.vy;
        if (m.y < -.01) m.y = 1.01; if (m.x < 0) m.x = 1; if (m.x > 1) m.x = 0;
        cx.beginPath(); cx.arc(m.x * W, m.y * H, m.r, 0, Math.PI * 2);
        cx.fillStyle = `rgba(${m.col},${m.al * (.5 + .5 * Math.sin(t * .0015 + m.ph))})`; cx.fill();
      }
      t++;
      animId = requestAnimationFrame(draw);
    }
    draw();

    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', resize); };
  }, []);

  return <canvas ref={canvasRef} id="bg-canvas" />;
}

// ═══ Top Navigation ═══
function TopNav() {
  const [health, setHealth] = useState(null);

  useEffect(() => {
    getHealth().then(setHealth).catch(() => setHealth({ status: 'down' }));
  }, []);

  const ok = health?.status === 'ok';

  return (
    <nav className="flex items-center h-[54px] px-8 relative z-[200]"
      style={{ background: 'var(--nav-grad)', boxShadow: '0 2px 20px rgba(0,0,0,0.35)' }}>
      <div className="flex items-center gap-3 mr-10 shrink-0">
        <img src="/logo.png" alt="SAS RAM Assistant" className="h-9 w-auto" />
        <div className="flex flex-col leading-tight">
          <span className="text-[12.5px] font-bold text-white tracking-wide">Retrieval Agent Assistant</span>
          <span className="text-[9px] text-white/60 tracking-widest uppercase">SAS Retrieval Agent Manager</span>
        </div>
      </div>

      <div className="flex-1" />

      {/* Connection status */}
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <span className={`w-2 h-2 rounded-full ${ok ? '' : 'animate-pulse'}`}
          style={{ background: ok ? '#3DDC84' : health ? '#E74C3C' : '#F1C40F' }} />
        <span className="text-white/75 text-[11px] font-medium">
          {health == null ? 'Connecting…'
            : health.mode === 'mock' ? 'Mock mode'
            : ok ? 'RAM connected'
            : health.status === 'unconfigured' ? 'RAM not configured'
            : 'Backend offline'}
        </span>
      </div>
    </nav>
  );
}

export default function App() {
  return (
    <ChatProvider>
      <div className="h-screen flex flex-col overflow-hidden">
        <AuroraCanvas />
        <TopNav />
        <main className="flex-1 relative z-[1] overflow-hidden">
          <ChatPage />
        </main>
      </div>
    </ChatProvider>
  );
}
