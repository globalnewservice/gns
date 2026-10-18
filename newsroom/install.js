/* "Add to Home Screen" for GNS sites.
   Shows a small banner on phones (and wherever the browser offers a one-tap install), and a sheet with the
   right steps for the visitor's device. Any element with [data-install-app] opens the sheet.
   Settings come from this script tag's data attributes:
     data-name="GNS+"  data-icon="apple-touch-icon.png"  data-accent="#b5161f"  data-theme="dark|light|auto"
     data-tagline="..."  data-banner="on|off"  */
(function () {
  "use strict";
  const me = document.currentScript || {};
  const ds = me.dataset || {};
  const NAME = ds.name || document.title || "this app";
  const ICON = ds.icon || "apple-touch-icon.png";
  const ACCENT = ds.accent || "#b5161f";
  const THEME = ds.theme || "auto";
  const TAGLINE = ds.tagline || "Add it to your Home Screen";
  const KEY = "gns-install-dismissed:" + NAME;

  const ua = navigator.userAgent || "";
  const iPadOS = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  const iOS = /iPhone|iPad|iPod/.test(ua) || iPadOS;
  const iPad = /iPad/.test(ua) || iPadOS;
  const android = /Android/.test(ua);
  const samsung = /SamsungBrowser/.test(ua);
  const inApp = /FBAN|FBAV|Instagram|Line\/|Snapchat|TikTok|GSA\//.test(ua);
  const iosOther = iOS && /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  const firefox = /Firefox\/|FxiOS/.test(ua);
  const edge = /Edg(e|A|iOS)?\//.test(ua);
  const chromium = /Chrome\/|Chromium\//.test(ua) && !samsung;
  const safariMac = !iOS && /Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg/.test(ua);
  const mobile = iOS || android;
  const mq = q => window.matchMedia && window.matchMedia(q).matches;
  const standalone = () => mq("(display-mode: standalone)") || mq("(display-mode: fullscreen)") || mq("(display-mode: minimal-ui)") || navigator.standalone === true;

  let deferred = null;   // the browser's own install prompt, when it offers one
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferred = e; maybeBanner(150); refreshSheet(); });
  window.addEventListener("appinstalled", () => { deferred = null; hideBanner(); closeSheet(); dismiss(3650); });

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => {}); });
  }

  /* ---------- styles ---------- */
  const css = `
  .gi-root { --gi-accent: ${ACCENT}; --gi-bg: #ffffff; --gi-ink: #121212; --gi-muted: #5d5d5d; --gi-line: rgba(0,0,0,.12); --gi-chip: #f1f1f3; --gi-shadow: 0 18px 50px rgba(0,0,0,.28);
    font-family: "Fira Sans", -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .gi-dark { --gi-bg: #1e1617; --gi-ink: #f6f1ec; --gi-muted: #b6a8a5; --gi-line: rgba(255,255,255,.14); --gi-chip: rgba(255,255,255,.08); --gi-shadow: 0 18px 50px rgba(0,0,0,.6); }
  @media (prefers-color-scheme: dark) { .gi-auto { --gi-bg: #1c1c1e; --gi-ink: #f2f2f2; --gi-muted: #a8a8a8; --gi-line: rgba(255,255,255,.14); --gi-chip: rgba(255,255,255,.08); --gi-shadow: 0 18px 50px rgba(0,0,0,.6); } }
  .gi-root[hidden] { display: none !important; }
  .gi-banner { position: fixed; left: 12px; right: 12px; bottom: calc(env(safe-area-inset-bottom, 0px) + 12px); z-index: 28; margin: 0 auto; max-width: 520px;
    display: flex; align-items: center; gap: 12px; padding: 12px 12px 12px 14px; border-radius: 14px; background: var(--gi-bg); color: var(--gi-ink);
    box-shadow: var(--gi-shadow); border: 1px solid var(--gi-line); animation: giUp .35s cubic-bezier(.2,.8,.2,1) both; }
  @keyframes giUp { from { transform: translateY(24px); opacity: 0; } to { transform: none; opacity: 1; } }
  .gi-banner img { width: 46px; height: 46px; border-radius: 11px; flex: none; }
  .gi-banner .gi-txt { flex: 1; min-width: 0; line-height: 1.3; }
  .gi-banner strong { display: block; font-size: 15px; }
  .gi-banner span { display: block; font-size: 13px; color: var(--gi-muted); }
  .gi-btn { appearance: none; border: 0; border-radius: 999px; padding: 9px 16px; font-family: inherit; font-weight: 700; font-size: 14px; line-height: 1; background: var(--gi-accent); color: #fff; cursor: pointer; white-space: nowrap; }
  .gi-btn:hover { filter: brightness(1.08); }
  .gi-x { appearance: none; border: 0; background: none; color: var(--gi-muted); width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; cursor: pointer; flex: none; }
  .gi-x:hover { background: var(--gi-chip); color: var(--gi-ink); }
  .gi-x svg { width: 18px; height: 18px; }
  .gi-scrim { position: fixed; inset: 0; z-index: 95; background: rgba(0,0,0,.55); display: flex; align-items: flex-end; justify-content: center; animation: giFade .2s ease both; }
  @keyframes giFade { from { opacity: 0; } }
  .gi-sheet { position: relative; width: min(560px, 100%); max-height: calc(100% - 24px); overflow-y: auto; background: var(--gi-bg); color: var(--gi-ink);
    border-radius: 18px 18px 0 0; padding: 22px 22px calc(env(safe-area-inset-bottom, 0px) + 22px); box-shadow: var(--gi-shadow); animation: giUp .3s cubic-bezier(.2,.8,.2,1) both; }
  @media (min-width: 700px) { .gi-scrim { align-items: center; padding: 24px; } .gi-sheet { border-radius: 18px; padding-bottom: 24px; } }
  .gi-head { display: flex; align-items: center; gap: 14px; margin: 0 40px 18px 0; }
  .gi-head img { width: 64px; height: 64px; border-radius: 15px; box-shadow: 0 4px 14px rgba(0,0,0,.25); flex: none; }
  .gi-head h2 { margin: 0; font-size: 21px; line-height: 1.2; font-weight: 700; }
  .gi-head p { margin: 3px 0 0; color: var(--gi-muted); font-size: 14px; }
  .gi-sheet > .gi-x { position: absolute; top: 14px; right: 14px; }
  .gi-note { margin: 0 0 14px; padding: 10px 12px; border-radius: 10px; background: var(--gi-chip); font-size: 14px; line-height: 1.45; }
  .gi-install { display: flex; width: 100%; justify-content: center; padding: 14px 18px; font-size: 16px; margin: 0 0 16px; }
  .gi-or { margin: 0 0 10px; color: var(--gi-muted); font-size: 13px; text-transform: uppercase; letter-spacing: .05em; font-weight: 600; }
  .gi-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; counter-reset: gi; }
  .gi-steps li { counter-increment: gi; display: grid; grid-template-columns: 30px 1fr; gap: 12px; align-items: start; font-size: 16px; line-height: 1.45; }
  .gi-steps li::before { content: counter(gi); width: 30px; height: 30px; border-radius: 50%; background: var(--gi-accent); color: #fff; font-weight: 700; font-size: 15px; display: grid; place-items: center; }
  .gi-steps b { font-weight: 700; }
  .gi-ico { display: inline-grid; place-items: center; vertical-align: -6px; width: 26px; height: 26px; margin: 0 2px; border-radius: 7px; background: var(--gi-chip); color: var(--gi-accent); }
  .gi-ico svg { width: 17px; height: 17px; }
  .gi-dark .gi-ico { color: var(--gi-ink); }
  @media (prefers-color-scheme: dark) { .gi-auto .gi-ico { color: var(--gi-ink); } }
  .gi-foot { margin: 18px 0 0; color: var(--gi-muted); font-size: 13px; line-height: 1.45; }
  @media (prefers-reduced-motion: reduce) { .gi-banner, .gi-sheet, .gi-scrim { animation: none; } }`;
  const style = document.createElement("style"); style.textContent = css; document.head.appendChild(style);

  /* ---------- icons ---------- */
  const svg = (p, fill) => `<svg viewBox="0 0 24 24" ${fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'} aria-hidden="true">${p}</svg>`;
  const I = {
    share: svg('<path d="M12 15V3M8 7l4-4 4 4"/><path d="M7 10H5.5A1.5 1.5 0 0 0 4 11.5v8A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 18.5 10H17"/>'),
    add: svg('<rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><path d="M12 8v8M8 12h8"/>'),
    dotsV: svg('<circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/>', true),
    dotsH: svg('<circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/>', true),
    menu: svg('<path d="M4 6h16M4 12h16M4 18h16"/>'),
    install: svg('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 7v6M9.5 10.5 12 13l2.5-2.5M8 20h8"/>'),
    x: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  };
  const ic = k => `<span class="gi-ico">${I[k]}</span>`;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ---------- the right steps for this device ---------- */
  function guide() {
    const n = esc(NAME);
    if (iOS) {
      const note = inApp ? `<p class="gi-note">This page is open inside another app. Open it in <b>Safari</b> first (tap ${ic("dotsH")} or the share menu, then <b>Open in Safari</b>), then follow these steps.</p>` : "";
      if (iosOther && !inApp) return { note, steps: [
        `Tap the Share button ${ic("share")} in the address bar${/CriOS/.test(ua) ? " (top right in Chrome)" : ""}.`,
        `Tap ${ic("add")} <b>Add to Home Screen</b>. If you don't see it, tap <b>More</b> first.`,
        `Tap <b>Add</b>. ${n} shows up on your Home Screen with its logo.`] };
      return { note, steps: [
        iPad ? `Tap the Share button ${ic("share")} at the top of Safari.` : `Tap the Share button ${ic("share")} in Safari's toolbar. Don't see it? Tap ${ic("dotsH")} first, then <b>Share</b>.`,
        `Scroll down and tap ${ic("add")} <b>Add to Home Screen</b>.`,
        `Keep <b>Open as Web App</b> on if you see it, then tap <b>Add</b>. ${n} shows up on your Home Screen with its logo.`] };
    }
    if (android) {
      if (samsung) return { steps: [`Tap the menu ${ic("menu")} at the bottom right.`, `Tap <b>Add page to</b>, then <b>Home screen</b>.`, `Tap <b>Add</b>. ${n} shows up on your Home screen with its logo.`] };
      if (firefox) return { steps: [`Tap the menu ${ic("dotsV")}.`, `Tap <b>Install</b> (or <b>Add to Home screen</b>).`, `Tap <b>Add</b>. ${n} shows up on your Home screen with its logo.`] };
      return { steps: [`Tap the menu ${ic("dotsV")} at the top right.`, `Tap <b>Add to Home screen</b> (or <b>Install app</b>).`, `Tap <b>Install</b>. ${n} shows up on your Home screen with its logo.`] };
    }
    if (safariMac) return { steps: [`In the menu bar, choose <b>File</b> → <b>Add to Dock</b>.`, `Click <b>Add</b>. ${n} opens from your Dock in its own window.`] };
    if (firefox) return { note: `<p class="gi-note">Firefox can't install websites as apps. Open this page in <b>Chrome</b>, <b>Edge</b> or <b>Safari</b> to install ${n}, or bookmark it here with <b>${/Mac/.test(ua) ? "⌘" : "Ctrl+"}D</b>.</p>`, steps: [] };
    if (edge) return { steps: [`Open the menu ${ic("dotsH")} at the top right.`, `Choose <b>Apps</b> → <b>Install this site as an app</b>.`, `Click <b>Install</b>. ${n} opens in its own window with its logo.`] };
    if (chromium) return { steps: [`Click the install button ${ic("install")} at the right end of the address bar.`, `Click <b>Install</b>. ${n} opens in its own window with its logo.`, `No button? Open the menu ${ic("dotsV")}, then <b>Cast, save, and share</b> → <b>Install page as app</b>.`] };
    return { steps: [`Open your browser's menu.`, `Choose <b>Add to Home Screen</b> or <b>Install</b>.`] };
  }

  /* ---------- sheet ---------- */
  let scrim = null, lastFocus = null;
  function themeClass() { return "gi-root " + (THEME === "dark" ? "gi-dark" : THEME === "light" ? "" : "gi-auto"); }
  function sheetHtml() {
    const g = guide();
    const can = !!deferred;
    const where = mobile ? "Home Screen" : "computer";
    return `<div class="gi-sheet" role="dialog" aria-modal="true" aria-labelledby="giTitle">
      <button type="button" class="gi-x" data-gi-close aria-label="Close">${I.x}</button>
      <div class="gi-head"><img src="${esc(ICON)}" alt=""><div><h2 id="giTitle">Get the ${esc(NAME)} app</h2><p>${standalone() ? "You're already using the app." : `Put ${esc(NAME)} on your ${where}, with its own icon.`}</p></div></div>
      ${g.note || ""}
      ${can ? `<button type="button" class="gi-btn gi-install" data-gi-install>Install ${esc(NAME)}</button>${g.steps.length ? `<p class="gi-or">Or do it yourself</p>` : ""}` : ""}
      ${g.steps.length ? `<ol class="gi-steps">${g.steps.map(s => `<li><span>${s}</span></li>`).join("")}</ol>` : ""}
      <p class="gi-foot">It opens full screen, like any other app. Your sign-in and settings stay on this device.</p>
    </div>`;
  }
  function openSheet() {
    if (scrim) return;
    lastFocus = document.activeElement;
    scrim = document.createElement("div");
    scrim.className = themeClass() + " gi-scrim";
    scrim.innerHTML = sheetHtml();
    document.body.appendChild(scrim);
    hideBanner();
    scrim.querySelector("[data-gi-close]").focus();
  }
  function refreshSheet() { if (scrim) scrim.innerHTML = sheetHtml(); }
  function closeSheet() {
    if (!scrim) return;
    scrim.remove(); scrim = null;
    if (lastFocus && document.contains(lastFocus) && lastFocus.focus) lastFocus.focus();
  }
  async function promptInstall() {
    if (!deferred) return;
    const e = deferred; deferred = null;
    try { e.prompt(); const r = await e.userChoice; if (r && r.outcome === "accepted") { closeSheet(); dismiss(3650); return; } } catch (err) {}
    refreshSheet();
  }

  /* ---------- banner ---------- */
  let banner = null, bannerTimer = 0;
  function dismissed() { try { return Number(localStorage.getItem(KEY) || 0) > Date.now(); } catch (e) { return false; } }
  function dismiss(days) { try { localStorage.setItem(KEY, String(Date.now() + days * 864e5)); } catch (e) {} }
  function maybeBanner(delay) {
    if (ds.banner === "off" || standalone() || dismissed() || banner || scrim) return;
    if (!mobile && !deferred) return;           // on computers, only when the browser can install in one click
    if (window.GNS_INSTALL_PAUSED) return;      // a page can hold the banner back (for example during sign-in screens)
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => {
      if (banner || scrim || standalone() || dismissed() || window.GNS_INSTALL_PAUSED) return;
      banner = document.createElement("div");
      banner.className = themeClass() + " gi-banner";
      banner.setAttribute("role", "region"); banner.setAttribute("aria-label", "Get the app");
      banner.innerHTML = `<img src="${esc(ICON)}" alt=""><div class="gi-txt"><strong>Get the ${esc(NAME)} app</strong><span>${esc(TAGLINE)}</span></div>
        <button type="button" class="gi-btn" data-gi-open>${deferred ? "Install" : "How"}</button>
        <button type="button" class="gi-x" data-gi-dismiss aria-label="Not now">${I.x}</button>`;
      document.body.appendChild(banner);
    }, delay);
  }
  function hideBanner() { clearTimeout(bannerTimer); if (banner) { banner.remove(); banner = null; } }

  /* ---------- events ---------- */
  document.addEventListener("click", e => {
    const t = e.target;
    if (t.closest("[data-install-app]")) { e.preventDefault(); openSheet(); return; }
    if (t.closest("[data-gi-open]")) { if (deferred) promptInstall(); else openSheet(); return; }
    if (t.closest("[data-gi-dismiss]")) { hideBanner(); dismiss(14); return; }
    if (t.closest("[data-gi-install]")) { promptInstall(); return; }
    if (scrim && (t === scrim || t.closest("[data-gi-close]"))) { closeSheet(); dismiss(14); }
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && scrim) { e.stopPropagation(); closeSheet(); } }, true);

  window.GNSInstall = { open: openSheet, close: closeSheet, standalone, showBanner: () => maybeBanner(0), hideBanner };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => maybeBanner(2500)); else maybeBanner(2500);
})();
