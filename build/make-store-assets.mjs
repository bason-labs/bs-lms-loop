// Generates Chrome Web Store graphic-asset HTML (brand-matched to popup.css),
// written to docs/store-assets/src/. Render to PNG with build/render-store-assets.sh.
import { mkdirSync, writeFileSync } from 'node:fs';

const SRC = 'docs/store-assets/src';
mkdirSync(SRC, { recursive: true });

const FONTS = `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Be+Vietnam+Pro:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">`;

// Brand tokens lifted from popup/popup.css (dark theme).
const BRAND = `
  --bg:#06100f; --panel:#0b1a18; --panel-2:#0e211e; --line:rgba(125,249,255,.12);
  --fg:#e0ffff; --muted:#7fb8b8; --brand:#008b8b; --brand-2:#006d6f;
  --accent:#40e0d0; --accent-deep:#0d98ba;
  --grad:linear-gradient(135deg,#008b8b 0%,#006d6f 55%,#0d98ba 100%);
  --glow:0 0 40px -6px rgba(64,224,208,.5);
  --display:'Space Grotesk',ui-sans-serif,system-ui,sans-serif;
  --sans:'Be Vietnam Pro',ui-sans-serif,system-ui,sans-serif;
  --mono:'JetBrains Mono',ui-monospace,monospace;`;

const GRAIN = `background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.05'/></svg>");`;

const mark = (size = 27, fs = 13, r = 8) =>
  `<span style="width:${size}px;height:${size}px;border-radius:${r}px;display:grid;place-items:center;
   font-family:var(--display);font-weight:700;font-size:${fs}px;letter-spacing:-.03em;color:#eafeff;
   background:var(--grad);box-shadow:0 1px 0 rgba(125,249,255,.35) inset, var(--glow)">BS</span>`;

// A faithful, populated popup card (no JS; values shown inline).
const popup = (variant = 'app') => {
  if (variant === 'gate') return `
  <div class="popup">
    <div class="grain"></div>
    <div class="gate">
      ${mark(44, 18, 12)}
      <h1 class="gate-title">Sign in</h1>
      <p class="gate-sub">Use your authorized Google account to continue.</p>
      <button class="power"><span>Sign in with Google</span></button>
    </div>
  </div>`;
  return `
  <div class="popup">
    <div class="grain"></div>
    <header class="topbar">
      <div class="brand">${mark()}<span class="wordmark">LMS&nbsp;Loop</span></div>
      <div class="tools">
        <div class="seg-mini"><span class="on">EN</span><span>VI</span></div>
        <span class="iconbtn">☾</span>
      </div>
    </header>
    <section class="hero">
      <div class="hero-top">
        <p class="eyebrow">Autopilot</p>
        <div class="chip running"><span class="dot"></span>running</div>
      </div>
      <h1 class="hero-status">Playing lesson 4</h1>
      <p class="hero-sub">Video · advancing automatically at ×8</p>
      <button class="power"><span class="glyph"></span><span>Stop automating</span></button>
      <div class="seg"><span class="on">Auto&nbsp;loop</span><span>Step</span></div>
    </section>
    <section class="card">
      <div class="card-head"><h2 class="label">Intelligence</h2><span class="note">used for quizzes</span></div>
      <div class="pills"><span class="pill on">OpenAI</span><span class="pill">Anthropic</span><span class="pill">Gemini</span><span class="pill">Custom</span></div>
      <div class="field"><label>API key</label><div class="input mono">••••••••••••••••</div></div>
    </section>
    <section class="card">
      <div class="card-head"><h2 class="label">Behavior</h2><span class="rate">×8</span></div>
      <div class="rangewrap"><div class="range"><i style="left:46%"></i></div></div>
    </section>
    <footer class="foot">Runs on the active tab · state survives reloads</footer>
  </div>`;
};

const POPUP_CSS = `
  .popup{position:relative;width:360px;border-radius:20px;overflow:hidden;
    background:linear-gradient(180deg,var(--panel),var(--bg));border:1px solid var(--line);
    box-shadow:0 30px 80px -20px rgba(0,0,0,.7), var(--glow);padding:16px 16px 14px;color:var(--fg);font-family:var(--sans)}
  .popup .grain{position:absolute;inset:0;${GRAIN};pointer-events:none}
  .popup>*{position:relative}
  .topbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
  .brand{display:flex;align-items:center;gap:9px}
  .wordmark{font-family:var(--display);font-weight:600;font-size:15px;letter-spacing:-.01em}
  .tools{display:flex;align-items:center;gap:8px}
  .seg-mini{display:flex;border:1px solid var(--line);border-radius:8px;overflow:hidden;font-size:11px}
  .seg-mini span{padding:4px 8px;color:var(--muted)} .seg-mini .on{background:var(--accent-tint,rgba(64,224,208,.13));color:var(--fg)}
  .iconbtn{width:26px;height:26px;border:1px solid var(--line);border-radius:8px;display:grid;place-items:center;color:var(--muted);font-size:13px}
  .eyebrow{margin:0;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}
  .hero-top{display:flex;align-items:center;justify-content:space-between}
  .chip{display:inline-flex;align-items:center;gap:6px;font-size:11px;padding:4px 9px;border-radius:999px;border:1px solid var(--line);color:var(--muted)}
  .chip.running{color:var(--accent);border-color:rgba(64,224,208,.4);background:rgba(64,224,208,.08)}
  .chip .dot{width:7px;height:7px;border-radius:50%;background:var(--accent);box-shadow:0 0 8px var(--accent)}
  .hero-status{font-family:var(--display);font-weight:600;font-size:25px;margin:8px 0 2px}
  .hero-sub{margin:0 0 14px;font-size:12.5px;color:var(--muted)}
  .power{width:100%;border:none;border-radius:13px;padding:13px;font-family:var(--display);font-weight:600;font-size:14px;
    color:#06100f;background:var(--grad);box-shadow:var(--glow);display:flex;align-items:center;justify-content:center;gap:9px;cursor:default}
  .power .glyph{width:11px;height:11px;border-radius:3px;background:#06100f}
  .seg{display:flex;gap:4px;background:var(--bg);border:1px solid var(--line);border-radius:11px;padding:4px;margin-top:10px}
  .seg span{flex:1;text-align:center;padding:7px;border-radius:8px;font-size:12.5px;color:var(--muted)}
  .seg .on{background:var(--panel-2);color:var(--fg);box-shadow:0 1px 0 rgba(125,249,255,.08) inset}
  .card{margin-top:12px;background:var(--panel-2);border:1px solid var(--line);border-radius:14px;padding:13px}
  .card-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
  .label{font-family:var(--display);font-weight:600;font-size:13px;margin:0;letter-spacing:.02em}
  .note{font-size:11px;color:var(--muted)} .rate{font-family:var(--mono);font-size:12px;color:var(--accent)}
  .pills{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:11px}
  .pill{font-size:12px;padding:6px 11px;border-radius:9px;border:1px solid var(--line);color:var(--muted)}
  .pill.on{border-color:rgba(64,224,208,.45);color:var(--fg);background:rgba(64,224,208,.08)}
  .field label{display:block;font-size:11px;color:var(--muted);margin-bottom:6px}
  .input{background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:12px;color:var(--fg)}
  .input.mono{font-family:var(--mono);letter-spacing:2px}
  .rangewrap{padding:6px 2px}
  .range{position:relative;height:4px;border-radius:999px;background:linear-gradient(90deg,var(--accent) 46%,var(--line) 46%)}
  .range i{position:absolute;top:50%;transform:translate(-50%,-50%);width:15px;height:15px;border-radius:50%;background:var(--accent);box-shadow:0 0 10px var(--accent)}
  .gate{display:flex;flex-direction:column;align-items:center;text-align:center;padding:30px 10px 26px;gap:6px}
  .gate-title{font-family:var(--display);font-weight:600;font-size:22px;margin:8px 0 0}
  .gate-sub{margin:0 0 14px;font-size:12px;color:var(--muted);max-width:240px}
  .gate .power{width:auto;padding:11px 18px}`;

// page(width,height, innerHTML) → full HTML doc sized exactly to the viewport.
const page = (w, h, body, extra = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8">${FONTS}
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:${w}px;height:${h}px;overflow:hidden}
  body{${BRAND}font-family:var(--sans);color:var(--fg);background:
    radial-gradient(120% 100% at 85% 10%, rgba(13,152,186,.22), transparent 55%),
    radial-gradient(90% 90% at 5% 100%, rgba(0,139,139,.20), transparent 60%), var(--bg);position:relative}
  body::after{content:"";position:absolute;inset:0;${GRAIN};pointer-events:none}
  .wrap{position:relative;width:100%;height:100%}
  ${POPUP_CSS}
  ${extra}
</style></head><body><div class="wrap">${body}</div></body></html>`;

// ---- Screenshot 1 — overview (1280×800) ----
const shot = (headline, sub, bullets, variant, eyebrow) => page(1280, 800, `
  <div style="display:grid;grid-template-columns:1.05fr .95fr;height:100%;align-items:center;gap:40px;padding:0 84px">
    <div>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:26px">${mark(40,18,11)}
        <span style="font-family:var(--display);font-weight:600;font-size:22px">LMS Loop</span></div>
      <p style="font-size:13px;letter-spacing:.2em;text-transform:uppercase;color:var(--accent);margin-bottom:14px">${eyebrow}</p>
      <h1 style="font-family:var(--display);font-weight:700;font-size:52px;line-height:1.05;letter-spacing:-.02em">${headline}</h1>
      <p style="font-size:19px;color:var(--muted);margin-top:18px;max-width:520px;line-height:1.5">${sub}</p>
      <ul style="list-style:none;margin-top:30px;display:grid;gap:14px">
        ${bullets.map(b => `<li style="display:flex;align-items:center;gap:13px;font-size:16.5px">
          <span style="width:24px;height:24px;border-radius:7px;display:grid;place-items:center;background:rgba(64,224,208,.13);color:var(--accent);font-size:13px">✓</span>${b}</li>`).join('')}
      </ul>
    </div>
    <div style="display:flex;justify-content:center;transform:rotate(-1.2deg)">${popup(variant)}</div>
  </div>`);

writeFileSync(`${SRC}/01-overview.html`, shot(
  'Auto-progress your<br>Open&nbsp;edX course',
  'LMS Loop watches each lesson, handles it, and clicks Next — hands-free.',
  ['Plays videos to a real completion', 'Archives documents to a local KB', 'Solves or skips quizzes'],
  'app', 'Hands-free coursework'));

writeFileSync(`${SRC}/02-quizzes.html`, shot(
  'Bring your own<br>AI for quizzes',
  'Add an OpenAI, Anthropic, or Gemini key to solve quizzes — or leave it blank to skip them.',
  ['Your key, stored locally only', 'OpenAI · Anthropic · Gemini', 'Tunable video speed up to ×16'],
  'app', 'Configurable'));

writeFileSync(`${SRC}/03-signin.html`, shot(
  'Private by design,<br>gated by sign-in',
  'Google sign-in with an allow-list. Emails are hashed — never stored in plain text.',
  ['No analytics, no tracking', 'No backend collects your data', 'Open source · zero dependencies'],
  'gate', 'Secure access'));

// ---- Small promo tile (440×280) ----
writeFileSync(`${SRC}/promo-small.html`, page(440, 280, `
  <div style="height:100%;display:flex;flex-direction:column;justify-content:center;padding:0 34px;gap:14px">
    ${mark(52,24,14)}
    <h1 style="font-family:var(--display);font-weight:700;font-size:34px;line-height:1.05;letter-spacing:-.02em">LMS&nbsp;Loop</h1>
    <p style="font-size:15px;color:var(--muted);line-height:1.45;max-width:330px">Auto-progress your Open&nbsp;edX lessons — videos, docs &amp; quizzes, hands-free.</p>
  </div>`));

// ---- Marquee promo tile (1400×560) ----
writeFileSync(`${SRC}/promo-marquee.html`, page(1400, 560, `
  <div style="display:grid;grid-template-columns:1fr 1fr;height:100%;align-items:center;padding:0 96px;gap:60px">
    <div>
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:24px">${mark(60,28,16)}
        <span style="font-family:var(--display);font-weight:700;font-size:40px;letter-spacing:-.02em">LMS Loop</span></div>
      <h1 style="font-family:var(--display);font-weight:700;font-size:60px;line-height:1.04;letter-spacing:-.02em">Coursework<br>on autopilot.</h1>
      <p style="font-size:22px;color:var(--muted);margin-top:22px;max-width:560px;line-height:1.5">Detects each lesson, plays videos to completion, archives docs, solves quizzes — then clicks Next.</p>
    </div>
    <div style="display:flex;justify-content:center;transform:rotate(-1.5deg)">${popup('app')}</div>
  </div>`));

console.log('✓ wrote asset HTML to', SRC);
