/* Ask Claude: a floating button on every tab that opens a chat with the
   dashboard's assistant (POST /api/ask, app/ask.py). Each question carries what
   the user is looking at (tab, dates, comparison, campaign-type view), so "why
   did CVR drop?" means these dates and this view. The answer streams in as
   server-sent events; the conversation stays for the browser session.
   Inlined after range_d1.js, inside the dashboard closure. */

const ASK = { open: false, busy: false, ctrl: null, log: [], el: null };
const ASK_STORE = "asaya-ask-log";
const ASK_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9L12 2.5zM18.5 15l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6z"/></svg>';

const ASK_SUGG = {
  d1: ["Summarise yesterday for the founder in five bullets", "Why did conversion move against the comparison?", "Which channel lost the most sessions, and which campaigns drove it?"],
  overview: ["How are these dates tracking against the comparison?", "What is driving the change in GMV: traffic, conversion or AOV?", "How much did we spend for every rupee of revenue?"],
  funnel: ["Which day in this range was the best, and why?", "Show orders and CVR day by day for the last 7 days", "Which days had data missing?"],
  marketing: ["Which Meta campaigns had the best ROAS on these dates?", "Split Meta spend by funnel stage and product", "How did Google Non-brand PMax do by product?"],
  products: ["Which products grew the most against the comparison?", "How did the basket mix (1, 2, 3+ items) change?", "Top 10 products by revenue on these dates"],
  live: ["How is today tracking against a typical day?", "Is today's spend on pace with yesterday?", "What is today's conversion rate so far?"],
  region: ["Which states grew the most against the comparison?", "What sells best in Bengaluru compared with the rest of India?", "Which cities have the highest AOV with at least 20 orders?"],
  retention: ["Summarise new vs repeat orders for these dates", "How did repeat orders change against the comparison?", "What share of orders came from new customers?"],
};

function askContext() {
  const tab = (state.config && state.config.tabs || []).find((t) => t.id === state.tab);
  const ctx = { tab: state.tab, tab_label: tab ? tab.label : state.tab, view: state.tab === "marketing" || state.tab === "live" ? RG.scope : "perf" };
  try {
    if (RG.eng && RG.from && RG.to) {
      Object.assign(ctx, { from: RG.from, to: RG.to, range_label: rgRangeLabel(), compare: RG.cmp.mode, latest_day: RG.eng.last });
      if (RG.cmp.mode === "custom") Object.assign(ctx, { compare_from: RG.cmp.from, compare_to: RG.cmp.to });
      const c = RG.eng.compare(RG.from, RG.to, RG.cmp);
      ctx.groups = c.groups.map((g) => ({ phase: g.phase, current_days: rgListDays(g.cur), comparison_days: g.prev && g.prev.length ? rgListDays(g.prev) : null }));
    }
  } catch (e) { /* the range is not ready on this tab yet */ }
  // on the Region tab: the state and city that are open, and what the map shows
  try {
    if (state.tab === "region" && typeof RGN !== "undefined" && state.pages.region_days) {
      const P = state.pages.region_days;
      ctx.region = { state: RGN.state != null ? P.states[RGN.state].name : "All India", city: RGN.city != null ? P.cities[RGN.city].name : null, map_metric: RGN.metric };
    }
  } catch (e) { /* not loaded yet */ }
  return ctx;
}
function askCtxLine() {
  const c = askContext(), view = { perf: "Performance", aw: "Awareness", all: "All campaigns" }[c.view] || "";
  if (!c.from) return `Looking at <b>${esc(c.tab_label || "")}</b>`;
  const cmp = c.compare && c.compare !== "none" ? ` vs <b>${esc(rgCmpLabel())}</b>` : "";
  return `Looking at <b>${esc(c.tab_label)}</b> · <b>${esc(c.range_label)}</b>${cmp} · ${esc(view)}`;
}

// A small, safe Markdown subset: everything is escaped first.
function askMd(src) {
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  const lines = String(src || "").replace(/\r/g, "").split("\n"), out = [];
  let i = 0;
  const isRow = (l) => /^\s*\|.*\|\s*$/.test(l);
  const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (isRow(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = cells(l); i += 2; const body = [];
      while (i < lines.length && isRow(lines[i])) body.push(cells(lines[i++]));
      out.push(`<div class="ask-tw"><table><thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    const h = l.match(/^\s*#{1,6}\s+(.*)$/);
    if (h) { out.push(`<h4>${inline(h[1])}</h4>`); i++; continue; }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(l)) {
      const ordered = /^\s*\d+[.)]\s+/.test(l), items = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
      out.push(`<${ordered ? "ol" : "ul"}>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !isRow(lines[i]) && !/^\s*(#{1,6}\s|[-*•]\s|\d+[.)]\s)/.test(lines[i])) para.push(lines[i++]);
    if (!para.length) { out.push(`<p>${inline(lines[i++])}</p>`); continue; }
    out.push(`<p>${para.map(inline).join("<br>")}</p>`);
  }
  return out.join("");
}

function askSave() {
  try { sessionStorage.setItem(ASK_STORE, JSON.stringify(ASK.log.slice(-30))); } catch (e) { /* storage blocked */ }
}
function askLoad() {
  try { const v = JSON.parse(sessionStorage.getItem(ASK_STORE) || "[]"); if (Array.isArray(v)) ASK.log = v.filter((m) => m && m.text); } catch (e) { ASK.log = []; }
}

function askMsgHtml(m) {
  if (m.role === "user") return `<div class="ask-msg user">${esc(m.text)}</div>`;
  const steps = m.steps && m.steps.length
    ? `<details class="ask-steps"${m.live ? " open" : ""}><summary>${m.live ? "Working" : `Checked ${m.steps.length} thing${m.steps.length === 1 ? "" : "s"} in the data`}</summary><ol>${m.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol></details>` : "";
  const working = m.live ? `<div class="ask-working"><span class="ask-dots" aria-hidden="true"><i></i><i></i><i></i></span><span>${esc(m.status || "Reading the dashboard data…")}</span></div>` : "";
  const err = m.error ? `<div class="ask-err">${esc(m.error)}</div>` : "";
  const meta = !m.live && m.text && m.fallback ? `<div class="ask-meta">Answered by a fallback model after the main model declined.</div>` : "";
  return `<div class="ask-msg bot">${steps}${working}<div class="ask-body">${askMd(m.text || "")}</div>${err}${meta}</div>`;
}

function askRender(scroll) {
  const log = ASK.el.querySelector(".ask-log");
  if (!ASK.log.length) {
    const sugg = ASK_SUGG[state.tab] || ASK_SUGG.overview;
    log.innerHTML = `<div class="ask-empty"><p>Ask anything about the dashboard's numbers. Claude reads the same data as these tabs (Shopify, GoKwik, Meta, Google, Reddit and the team's sheets), does the sums with the dashboard's own rules, and says when something is unavailable.</p><div class="ask-sugg">${sugg.map((s) => `<button type="button" data-q="${esc(s)}">${esc(s)}</button>`).join("")}</div></div>`;
  } else {
    log.innerHTML = ASK.log.map(askMsgHtml).join("");
  }
  if (scroll !== false) log.scrollTop = log.scrollHeight;
  ASK.el.querySelector(".ask-ctx").innerHTML = askCtxLine();
  const send = ASK.el.querySelector(".ask-send");
  send.textContent = ASK.busy ? "Stop" : "Ask";
  send.classList.toggle("stop", ASK.busy);
  send.setAttribute("aria-label", ASK.busy ? "Stop answering" : "Send question");
}

function askToggle(open) {
  ASK.open = open == null ? !ASK.open : open;
  ASK.el.hidden = !ASK.open;
  ASK.fab.setAttribute("aria-expanded", String(ASK.open));
  document.body.classList.toggle("ask-open", ASK.open); // wide screens make room for the panel
  if (ASK.open) { askRender(); ASK.el.querySelector("textarea").focus(); } else ASK.fab.focus();
}

async function askSend(q, voice) {
  q = (q || "").trim();
  if (!q || ASK.busy) return;
  if (embedded) {
    ASK.log.push({ role: "user", text: q }, { role: "assistant", text: "", error: "Ask Claude works on the live dashboard only; this offline preview has no connection to it." });
    return askRender();
  }
  const history = ASK.log.filter((m) => m.text && !m.error).map((m) => ({ role: m.role, text: m.text }));
  const bot = { role: "assistant", text: "", steps: [], live: true, status: "" };
  ASK.log.push({ role: "user", text: q }, bot);
  ASK.busy = true; ASK.ctrl = new AbortController();
  askRender();
  let pending = "";
  const repaint = () => { askRender(); };
  try {
    const r = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q, history, view: askContext(), voice: !!voice }), signal: ASK.ctrl.signal, credentials: "same-origin" });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(r.status === 401 ? "Your session has ended. Reload the page and sign in again." : j.detail || `The assistant is not available (${r.status}).`);
    }
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = "", raf = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let k;
      while ((k = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, k); buf = buf.slice(k + 2);
        const line = chunk.split("\n").find((x) => x.startsWith("data: "));
        if (!line) continue;
        let ev; try { ev = JSON.parse(line.slice(6)); } catch (e) { continue; }
        if (ev.t === "delta") bot.text += ev.text;
        else if (ev.t === "step") { pending = bot.text.trim(); bot.text = ""; }
        else if (ev.t === "status") { if (pending) { bot.steps.push(pending.replace(/\s+/g, " ").slice(0, 200)); pending = ""; } bot.steps.push(ev.text); bot.status = ev.text + "…"; }
        else if (ev.t === "done") { bot.fallback = !!ev.fallback; }
        else if (ev.t === "error") { bot.error = ev.text; }
      }
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; repaint(); });
    }
  } catch (e) {
    bot.error = e.name === "AbortError" ? "Stopped." : e.message || "The assistant could not be reached.";
  }
  bot.live = false; ASK.busy = false; ASK.ctrl = null;
  if (!bot.text.trim() && !bot.error) bot.error = "No answer came back. Try again.";
  askSave(); askRender();
}

// ------------------------------------------------------------------ voice
/* Click the mic to start talking, click again to stop. The words land in the
   box to check or fix; press Ask to send (click the mic again to add more).
   The recording goes to Google Speech-to-Text in the dashboard's own project
   (POST /api/transcribe, Indian English, the dashboard's vocabulary boosted).
   If that is not set up, the browser's own speech recognition is used
   instead. Questions asked by voice are flagged so Claude reads past any
   word the recognition misheard. Esc while recording cancels. */
const ASK_SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
const ASK_MIC_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3.5"/></svg>';
const ASK_STOP_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>';
const MIC_MAX_S = 59;
const MIC = { on: false, busy: false, engine: null, stop: () => {} };

function askPcm16(chunks, inRate) {
  // mono float chunks at the device rate -> 16 kHz 16-bit PCM, base64
  let n = 0; for (const c of chunks) n += c.length;
  const all = new Float32Array(n); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
  const ratio = inRate / 16000, len = Math.floor(all.length / ratio), out = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    // average the samples this output sample covers (a simple low-pass)
    const a = Math.floor(i * ratio), b = Math.min(all.length, Math.floor((i + 1) * ratio));
    let s = 0; for (let j = a; j < b; j++) s += all[j];
    const v = Math.max(-1, Math.min(1, b > a ? s / (b - a) : all[a] || 0));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  const bytes = new Uint8Array(out.buffer); let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function askMicSetup(el, ta, grow) {
  const btn = el.querySelector(".ask-mic"), note = el.querySelector(".ask-note"), noteText = note.textContent;
  const canRecord = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && (window.AudioContext || window.webkitAudioContext));
  if (embedded || (!canRecord && !ASK_SR)) { btn.hidden = true; return; }
  MIC.engine = canRecord ? "cloud" : "browser";
  const say = (msg, warn) => { note.textContent = msg; note.classList.toggle("warn", !!warn); };
  const reset = () => say(noteText, false);
  const paint = () => {
    btn.classList.toggle("rec", MIC.on); btn.classList.toggle("wait", MIC.busy);
    btn.setAttribute("aria-pressed", String(MIC.on));
    btn.setAttribute("aria-label", MIC.on ? "Stop recording" : "Ask by voice: click to start talking");
    btn.title = MIC.on ? "Click to stop" : "Click to talk";
    btn.innerHTML = MIC.on ? ASK_STOP_ICON : ASK_MIC_ICON;
    btn.disabled = MIC.busy;
  };
  const put = (text) => {
    // add the words after whatever is already in the box
    const t = (text || "").replace(/\s+/g, " ").trim();
    if (!t) return false;
    ta.value = [ta.value.trim(), t].filter(Boolean).join(" ");
    grow(); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    ASK.voice = true;
    return true;
  };
  const done = (ok) => say(ok ? "Check the words, then press Ask. Click the mic to add more." : noteText, false);

  // --- Google Speech-to-Text: record PCM, send when stopped
  let rec = null;
  async function cloudStart() {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      return say(e && e.name === "NotFoundError" ? "No microphone was found." : "Microphone access is blocked. Allow the microphone for this site in the browser's settings, then click the mic again.", true);
    }
    const AC = window.AudioContext || window.webkitAudioContext, ctx = new AC();
    const src = ctx.createMediaStreamSource(stream), proc = ctx.createScriptProcessor(4096, 1, 1);
    rec = { stream, ctx, src, proc, chunks: [], rate: ctx.sampleRate, t0: Date.now(), timer: 0 };
    proc.onaudioprocess = (ev) => {
      const d = ev.inputBuffer.getChannelData(0); rec.chunks.push(new Float32Array(d));
      let s = 0; for (let i = 0; i < d.length; i += 16) s += d[i] * d[i];
      btn.style.setProperty("--lvl", Math.min(1, Math.sqrt(s / (d.length / 16)) * 6).toFixed(2));
    };
    src.connect(proc); proc.connect(ctx.destination);
    MIC.on = true; paint();
    const tick = () => {
      const s = Math.floor((Date.now() - rec.t0) / 1000);
      say(`Listening… ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} · click the mic to stop · Esc to cancel`);
      if (s >= MIC_MAX_S) stop(false);
    };
    tick(); rec.timer = setInterval(tick, 500);
  }
  async function cloudStop(cancel) {
    const r = rec; rec = null;
    clearInterval(r.timer);
    try { r.src.disconnect(); r.proc.disconnect(); } catch (e) { /* already gone */ }
    r.stream.getTracks().forEach((t) => t.stop());
    r.ctx.close().catch(() => {});
    btn.style.removeProperty("--lvl");
    MIC.on = false;
    if (cancel) { paint(); return reset(); }
    if ((Date.now() - r.t0) < 600) { paint(); return say("That was too short. Click the mic, speak, then click it again to stop.", true); }
    MIC.busy = true; paint(); say("Turning your words into text…");
    try {
      const resp = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ audio: askPcm16(r.chunks, r.rate) }) });
      const j = await resp.json().catch(() => ({}));
      if (resp.ok) {
        if (put(j.text)) done(true);
        else say("Didn't catch any words. Click the mic and try again, a little closer to the microphone.", true);
      }
      else if ((resp.status === 503 || resp.status === 502) && ASK_SR) {
        MIC.engine = "browser";
        say(`Server speech-to-text is not available (${j.detail || resp.status}), so the browser's own recognition will be used. Click the mic and speak again.`, true);
      } else say(resp.status === 401 ? "Your session has ended. Reload the page and sign in again." : j.detail || `Speech-to-text failed (${resp.status}).`, true);
    } catch (e) {
      say("Could not reach the dashboard to turn speech into text. Try again.", true);
    }
    MIC.busy = false; paint();
  }

  // --- fallback: the browser's own speech recognition, live in the box
  let sr = null;
  function browserStart() {
    const base = ta.value.trim();
    sr = { base, finals: "", sess: "", interim: "", err: null, cancel: false, r: null };
    const show = () => { ta.value = [sr.base, (sr.finals + sr.sess + sr.interim).trim()].filter(Boolean).join(" "); grow(); };
    const listen = () => {
      const r = new ASK_SR(); sr.r = r; sr.sess = ""; sr.interim = ""; sr.err = null;
      r.lang = "en-IN"; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
      r.onresult = (ev) => { let f = "", it = ""; for (let i = 0; i < ev.results.length; i++) { const t = ev.results[i][0].transcript; if (ev.results[i].isFinal) f += t; else it += t; } sr.sess = f; sr.interim = it; show(); };
      r.onerror = (ev) => { sr.err = ev.error; };
      r.onend = () => {
        sr.finals += sr.sess + sr.interim + " "; sr.sess = ""; sr.interim = "";
        if (MIC.on && (!sr.err || sr.err === "no-speech")) { try { return listen(); } catch (e) { /* stop below */ } }
        const s = sr; sr = null; MIC.on = false; paint();
        if (s.err === "not-allowed" || s.err === "service-not-allowed") { ta.value = s.base; grow(); return say("Microphone access is blocked. Allow the microphone for this site in the browser's settings, then click the mic again.", true); }
        if (s.cancel) { ta.value = s.base; grow(); return reset(); }
        const text = s.finals.replace(/\s+/g, " ").trim();
        ta.value = s.base; grow();
        if (!put(text)) return say(s.err === "network" ? "Speech recognition needs an internet connection." : "Didn't catch any words. Click the mic and try again.", true);
        done(true);
      };
      r.start();
    };
    try { listen(); } catch (e) { sr = null; return say("Speech recognition could not start in this browser.", true); }
    MIC.on = true; paint();
    say("Listening… click the mic to stop · Esc to cancel");
  }
  function browserStop(cancel) {
    if (!sr) return;
    MIC.on = false; sr.cancel = !!cancel;
    try { if (cancel) sr.r.abort(); else sr.r.stop(); } catch (e) { /* ended already */ }
  }

  function stop(cancel) {
    if (!MIC.on) return;
    if (rec) cloudStop(cancel); else browserStop(cancel);
  }
  MIC.stop = stop;
  btn.addEventListener("click", () => {
    if (MIC.busy) return;
    if (MIC.on) return stop(false);
    reset();
    if (MIC.engine === "cloud") cloudStart(); else browserStart();
  });
  window.addEventListener("pagehide", () => stop(true));
  paint();
}

function askMount() {
  if (ASK.el) return;
  askLoad();
  const fab = document.createElement("button");
  fab.type = "button"; fab.className = "ask-fab"; fab.setAttribute("aria-haspopup", "dialog"); fab.setAttribute("aria-expanded", "false");
  fab.innerHTML = `${ASK_ICON}<span>Ask Claude</span>`;
  const el = document.createElement("section");
  el.className = "ask-panel"; el.hidden = true; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Ask Claude");
  el.innerHTML = `<div class="ask-head"><div class="ask-title"><h2>${ASK_ICON}Ask Claude</h2><p>Answers from the dashboard's own data</p></div>
      <button type="button" class="ask-iconbtn" data-act="new" title="Start a new conversation">New chat</button>
      <button type="button" class="ask-iconbtn x" data-act="close" aria-label="Close">×</button></div>
    <div class="ask-ctx"></div>
    <div class="ask-log" aria-live="polite"></div>
    <div class="ask-foot"><form class="ask-form"><textarea rows="1" placeholder="Ask about any number on the dashboard…" aria-label="Your question" maxlength="2000"></textarea><button type="button" class="ask-mic" aria-pressed="false">${ASK_MIC_ICON}</button><button type="submit" class="ask-send">Ask</button></form>
      <p class="ask-note">Uses the tab, dates and view you're on. Enter to send, or click the mic to talk.</p></div>`;
  // docked in the header (never over the page's tables); the panel opens as a side panel
  const slot = document.getElementById("ask-slot");
  if (slot) { fab.classList.add("docked"); slot.append(fab); document.body.append(el); } else document.body.append(fab, el);
  ASK.el = el; ASK.fab = fab;
  fab.addEventListener("click", () => askToggle(true));
  const ta = el.querySelector("textarea");
  const grow = () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 160) + "px"; };
  ta.addEventListener("input", () => { grow(); if (!ta.value.trim()) ASK.voice = false; });
  askMicSetup(el, ta, grow);
  ta.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); el.querySelector("form").requestSubmit(); } });
  el.querySelector("form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    if (ASK.busy) { if (ev.submitter && ev.submitter.classList.contains("ask-send")) ASK.ctrl && ASK.ctrl.abort(); return; }
    if (MIC.on) MIC.stop(false);
    const q = ta.value, voice = !!ASK.voice; ta.value = ""; ASK.voice = false; grow(); askSend(q, voice);
  });
  el.addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    if (b.dataset.act === "close") askToggle(false);
    else if (b.dataset.act === "new") { if (ASK.ctrl) ASK.ctrl.abort(); ASK.log = []; askSave(); askRender(); ta.focus(); }
    else if (b.dataset.q) askSend(b.dataset.q);
  });
  el.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    if (MIC.on) { ev.preventDefault(); MIC.stop(true); return; } // Esc cancels a recording first
    askToggle(false);
  });
  // the context line follows the tab, dates and view
  window.addEventListener("hashchange", () => { if (ASK.open) setTimeout(() => askRender(false), 50); });
}
