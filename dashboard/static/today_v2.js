/* Today tab fixes (flag today_fixes_v2). Inlined into app.html inside the
   dashboard closure, after the Today tab. With the flag off nothing here is
   called and the tab renders exactly as before.

   A1 every hour 00–23, header kept in view · A2 Δ in its own column, coloured
   by the registry · A3 sessions with ATC and ATC rate · A4 the hour under way
   marked "partial", grey, against the same minutes of the comparison hour ·
   A5 Total sales | Order value placed (in the URL) · A6 GoKwik's last load and
   the CSV fallback · A7 Perf ATC rate. */

const TV2 = () => !!(state.features && state.features.today_fixes_v2);
const TATC = () => !!(state.features && state.features.atc_drilldown);
const liveQ = () => new URLSearchParams(location.hash.split("?")[1] || "");
const liveSales = () => (TV2() && liveQ().get("sales") === "placed" ? "placed" : "total");
function liveSetSales(v) {
  const q = liveQ();
  if (v === "placed") q.set("sales", "placed"); else q.delete("sales");
  history.replaceState(null, "", "#live" + (q.toString() ? "?" + q.toString() : ""));
}
function liveLoadV2(p) {
  if (state.pages.live_history_v2 || LIVE.h2Loading || LIVE.h2Err) return;
  LIVE.h2Loading = true;
  loadPage("live_history_v2").catch((e) => { LIVE.h2Err = e.message || String(e); })
    .finally(() => { LIVE.h2Loading = false; if (state.tab === "live") { destroyCharts(); R.live(p); } });
}
const livePer = (c) => (c ? c.map((v, h) => (v == null ? null : h ? v - (c[h - 1] ?? 0) : v)) : null);

/* the comparison's hourly arrays (not running totals) for the v2 table */
function liveCmpHours(p, past, typ) {
  const sh = p.shopify, v2 = p.v2 || {}, H = state.pages.live_history, H2 = state.pages.live_history_v2;
  if (past) {
    const a = H && H.days[LIVE.date];
    if (!a) return null;
    return { orders: a[0], gmv: a[1], sessions: a[2], atc: a[3], placed: (H2 && H2.placed && H2.placed[LIVE.date]) || null };
  }
  const k = typ ? "typical" : "yesterday";
  const run = (key) => (sh.curves.series[key] ? sh.curves.series[key][k] : null);
  return { orders: livePer(run("orders")), gmv: livePer(run("gmv")), sessions: livePer(run("sessions")),
    atc: livePer(v2.curves && v2.curves.atc ? v2.curves.atc[k] : null), placed: livePer(v2.curves && v2.curves.placed ? v2.curves.placed[k] : null) };
}
function liveTodayHours(p) {
  const s = p.shopify.curves.series, v2 = p.v2 || {}, c = v2.curves || {};
  return { orders: livePer(s.orders.today), gmv: livePer(s.gmv.today), sessions: livePer(s.sessions.today),
    atc: livePer(c.atc ? c.atc.today : null), placed: livePer(c.placed ? c.placed.today : null) };
}

/* A1–A5: the hour-by-hour table */
function liveHoursV2(p, t, past, typ, cmpLabel) {
  const T = liveTodayHours(p), C = liveCmpHours(p, past, typ);
  if (!C) return '<p class="na">The comparison day is not loaded yet.</p>';
  const sales = liveSales() === "placed" ? "placed" : "gmv", salesId = sales === "placed" ? "order_value_placed" : "total_sales";
  const hNow = Math.min(23, Math.floor(t)), mins = Math.round((t - hNow) * 60), frac = Math.min(1, t - hNow);
  const part = (p.v2 || {}).partial;
  const realMin = !past && !typ && part && part.hour === hNow && part.yesterday; // yesterday's own minutes
  const cAt = (k, h) => {
    if (!C[k] || C[k][h] == null) return null;
    if (h !== hNow) return C[k][h];
    return realMin && realMin[k] != null ? realMin[k] : C[k][h] * frac;
  };
  const lbl = (h) => `${String(h).padStart(2, "0")}:00 · ${h % 12 || 12} ${h < 12 ? "am" : "pm"}`;
  const rate = (a, s) => (a != null && s ? a / s : null);
  const rows = [];
  for (let h = 0; h < 24; h++) {
    const has = h <= hNow, partial = h === hNow && mins > 0;
    const tv = (k) => (has && T[k] ? T[k][h] : null);
    rows.push({ h, partial, label: lbl(h), t: { s: tv(sales), o: tv("orders"), n: tv("sessions"), a: tv("atc") },
      c: { s: cAt(sales, h), o: cAt("orders", h), n: cAt("sessions", h), a: cAt("atc", h) } });
  }
  const sum = (arr, k, upto) => arr.slice(0, upto + 1).reduce((x, r) => (r[k] == null ? x : (x ?? 0) + r[k]), null);
  const so = { label: `So far (to ${String(hNow).padStart(2, "0")}:${String(mins).padStart(2, "0")})`, total: true,
    t: Object.fromEntries(["s", "o", "n", "a"].map((k) => [k, sum(rows.map((r) => r.t), k, hNow)])),
    c: Object.fromEntries(["s", "o", "n", "a"].map((k) => [k, sum(rows.map((r) => r.c), k, hNow)])) };
  const fullC = (k) => (C[k] ? C[k].reduce((x, v) => x + (v || 0), 0) : null);
  const full = { label: "Full day", total: true, t: {}, c: { s: fullC(sales), o: fullC("orders"), n: fullC("sessions"), a: fullC("atc") } };
  const na = '<span class="na">–</span>';
  const num = (v, f) => (v == null ? na : esc(mFormat(f, v)));
  const pct = (r, a, b, id) => {
    if (r.t[a] == null || r.c[a] == null) return '<td class="dl"></td>';
    if (r.partial) return `<td class="dl" title="Partial hour: not coloured">${mDeltaHtml(id, r.c[a] ? r.t[a] / r.c[a] - 1 : null, { dir: "neutral" })}</td>`;
    return `<td class="dl">${mDeltaHtml(id, r.c[a] ? r.t[a] / r.c[a] - 1 : null, { small: id !== "sessions" && (r.c.o ?? 0) < 5 && !r.total })}</td>`;
  };
  const pp = (r) => {
    const a = rate(r.t.a, r.t.n), b = rate(r.c.a, r.c.n);
    if (a == null || b == null) return '<td class="dl"></td>';
    return `<td class="dl">${mPpHtml(a - b, r.partial ? "neutral" : "higher")}</td>`;
  };
  const body = [...rows, so, full].map((r) => `<tr class="${r.total ? "total" : ""}${r.partial ? " partial" : ""}">
    <td class="text">${esc(r.label)}${r.partial ? ` <span class="chip pending" title="The hour under way, set against the same ${mins} minutes of the comparison hour${realMin ? " (yesterday's own minutes)" : " (its hour, pro rata)"}">partial · ${mins} min</span>` : ""}</td>
    <td>${num(r.t.s, "currency")}</td><td class="cmp">${num(r.c.s, "currency")}</td>${pct(r, "s", null, salesId)}
    <td>${num(r.t.o, "count")}</td><td class="cmp">${num(r.c.o, "count")}</td>${pct(r, "o", null, "orders")}
    <td>${num(r.t.n, "count")}</td><td class="cmp">${num(r.c.n, "count")}</td>${pct(r, "n", null, "sessions")}
    <td>${num(r.t.a, "count")}</td><td class="cmp">${num(r.c.a, "count")}</td>
    <td>${num(rate(r.t.a, r.t.n), "percent")}</td><td class="cmp">${num(rate(r.c.a, r.c.n), "percent")}</td>${pp(r)}</tr>`).join("");
  const grp = (id, label, n) => `<th colspan="${n}" class="grp-h">${mHead(id, label)}</th>`;
  const sub3 = `<th>Today</th><th>${esc(cmpLabel)}</th><th>Δ</th>`;
  return `<div class="table-wrap lh2" style="max-height:62vh"><table>
    <thead><tr><th rowspan="2" class="text">Hour (IST)</th>${grp(salesId, sales === "placed" ? "Order value placed" : "Total sales", 3)}${grp("orders", "Orders", 3)}${grp("sessions", "Sessions", 3)}${grp("atc", "Sessions with ATC", 2)}${grp("atc_rate", "ATC rate", 3)}</tr>
    <tr>${sub3}${sub3}${sub3}<th>Today</th><th>${esc(cmpLabel)}</th><th>Today</th><th>${esc(cmpLabel)}</th><th>Δ pp</th></tr></thead>
    <tbody>${body}</tbody></table></div>
    <p class="legend-note">Counts compare as Δ %, the ATC rate as Δ percentage points; colours follow each metric's direction in the registry. The hour under way is grey and never coloured. ATC rate = sessions with an add-to-cart ÷ sessions (Shopify).</p>`;
}

/* A5: the headline sales card when Order value placed is picked */
function liveSalesCard(p, past, typ, t) {
  const v2 = p.v2 || {}, H2 = state.pages.live_history_v2;
  const id = "order_value_placed";
  if (v2.placed_today == null) return kpiCard(id, { value: null, na: "not read yet: the next live run reads it" });
  const tip = "Order value placed: order totals of orders created so far today, before returns processed today. Total sales: Shopify's Total sales, which takes off returns on the day they are processed (e.g. from Uniware), so a return landing today can look like a sales drop.";
  if (past) {
    const a = H2 && H2.placed && H2.placed[LIVE.date];
    const v = a ? liveCum(a, t) : null, f = a ? a.reduce((x, y) => x + y, 0) : null;
    return kpiCard(id, { value: v2.placed_today, prev: v, change: v ? v2.placed_today / v - 1 : null, tipExtra: tip,
      sub: f != null ? `${liveDay(LIVE.date)} full day: ${mVal(id, f, true)}` : "" });
  }
  const prev = typ ? v2.placed_typical : v2.placed_yesterday;
  return kpiCard(id, { value: v2.placed_today, prev: prev ?? null, change: prev ? v2.placed_today / prev - 1 : null, tipExtra: tip });
}
/* A7: Perf ATC rate */
function livePerfAtcCard(p, past, t) {
  const pa = (p.v2 || {}).perf_atc, H = state.pages.live_history, H2 = state.pages.live_history_v2;
  if (!pa || pa.value == null) return kpiCard("perf_atc_rate", { value: null, na: "Perf sessions are not available yet" });
  let prev = LIVE.base === "yesterday" ? pa.yesterday : pa.typical, note = "";
  if (past) {
    const a = liveSnapAt(((H2 && H2.perf_atc) || {})[LIVE.date], t), s = liveSnapAt(((H && H.perf) || {})[LIVE.date], t);
    prev = a != null && s ? a / s : null;
    if (prev == null) note = `Perf ATC so far was not saved for ${liveDay(LIVE.date, true)} (kept from the day this went live).`;
  }
  return kpiCard("perf_atc_rate", { value: pa.value, prev: prev ?? null, change: prev ? pa.value / prev - 1 : null,
    tipExtra: note || "Compared at the same time of day.", sub: `${inGroup.format(pa.atc)} of ${inGroup.format(pa.sessions)} Perf sessions` });
}
/* the Diagnose → link on a health tile (shown once the drill-down is switched on) */
function liveDiagnose(p, t) {
  if (!TATC()) return "";
  const h = Math.floor(t), from = Math.max(0, h - 3);
  const q = new URLSearchParams({ sub: "hourly", date: p.today, from: String(from), to: String(h), scope: "perf",
    cmp: LIVE.base === "past" && LIVE.date ? "date:" + LIVE.date : LIVE.base === "yesterday" ? "yesterday" : "typical" });
  return `<a class="live-diag" href="#funnel?${q.toString()}">Diagnose →</a>`;
}

/* A6: GoKwik: when the last load landed; today's numbers from an upload when the load has none */
const GK_LOAD = { ok: ["ok", "Loaded"], amber: ["late", "Late"], red: ["down", "Very late"] };
function liveGokwikV2(p, oldPanel) {
  const v2 = p.v2 || {}, L = v2.gokwik_load || {};
  const [cls, word] = GK_LOAD[L.state] || GK_LOAD.red;
  const when = L.last_at ? new Date(L.last_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }) : null;
  const chip = `<div class="ck gk-load"><span class="spill ${cls}"><i></i>${word}</span><span class="why">${when ? `Last successful load at ${esc(when)}${L.age_minutes != null ? ` (${L.age_minutes} min ago)` : ""}.` : "No GoKwik load found."} Amber after ${(state.config.today_v2 || {}).amber ?? 60} min, red after ${(state.config.today_v2 || {}).red ?? 180} min.</span>${state.admin ? '<button type="button" class="pf-btn" id="gk-up">Upload GoKwik CSV</button><input type="file" id="gk-file" accept=".csv" hidden>' : ""}</div>`;
  if (L.today_rows) return chip + oldPanel;
  const S = LIVE.gkcsv;
  if (!S || S.day !== p.today || Date.now() - S.at > 300000) {
    if (!LIVE.gkLoading) {
      LIVE.gkLoading = true;
      getJSON(`/api/gokwik/csv?date=${p.today}`).then((j) => { LIVE.gkcsv = { day: p.today, at: Date.now(), data: j }; })
        .catch((e) => { LIVE.gkcsv = { day: p.today, at: Date.now(), err: e.message }; })
        .finally(() => { LIVE.gkLoading = false; if (state.tab === "live") { destroyCharts(); R.live(p); } });
    }
    return chip + '<p class="na">Looking for an uploaded GoKwik file for today…</p>';
  }
  if (S.err) return chip + `<p class="na">Uploaded GoKwik files could not be read: ${esc(S.err)}</p>`;
  const d = S.data;
  if (!d || d.none) return chip + `<p class="na">No GoKwik data for today yet: the automated load has no rows for today${state.admin ? ". Upload GoKwik's checkout export (checkoutAnalyticsFunnelWithMarketingParams-report…csv)" : "; an admin can upload GoKwik's checkout export"}.</p>`;
  const up = new Date(d.upload.uploaded_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
  const stg = [["checkout_started", "Checkout started", null], ["address_landed", "Address landed", "checkout_started"], ["payment_step", "Payment step", "address_landed"], ["method_selected", "Method selected", "payment_step"], ["converted", "Order", "method_selected"]];
  const flagAt = { method_selected: 0.62, converted: 0.85 };
  const r = (x, k, prev) => (prev && x[prev] ? x[k] / x[prev] : null);
  const inc = d.since_last;
  const cellR = (x, k, prev) => { const v = r(x, k, prev); if (v == null) return '<span class="na">–</span>'; const bad = flagAt[k] != null && v < flagAt[k]; return `<span class="${bad ? "down" : ""}" ${bad ? `title="Below ${Math.round(flagAt[k] * 100)}%"` : ""}>${esc(mFormat("percent", v))}</span>`; };
  const rowsT = stg.map(([k, l, prev]) => `<tr><td class="text">${esc(l)}</td><td>${inGroup.format(d.tagged[k])}</td><td>${cellR(d.tagged, k, prev)}</td><td>${inGroup.format(d.all[k])}</td><td>${cellR(d.all, k, prev)}</td>${inc ? `<td>${inGroup.format(inc.tagged[k])}</td><td>${cellR(inc.tagged, k, prev)}</td>` : ""}</tr>`).join("");
  const e2e = (x) => (x.checkout_started ? esc(mFormat("percent", x.converted / x.checkout_started)) : "–");
  return chip + `<div class="ck"><span class="spill pending"><i></i>From CSV upload, ${esc(up)}</span><span class="why">${esc(d.upload.file_name)} · ${d.uploads_for_day} upload${d.uploads_for_day === 1 ? "" : "s"} today. Shown because the automated load has no rows for today; it never mixes with that load.</span></div>
    <div class="table-wrap"><table><thead><tr><th class="text">Stage</th><th>Tagged</th><th>Step rate</th><th>All</th><th>Step rate</th>${inc ? `<th>Since last snapshot</th><th>Step rate</th>` : ""}</tr></thead>
    <tbody>${rowsT}<tr class="total"><td class="text">${mHead("gk_conv_tagged", "End to end")}</td><td></td><td>${e2e(d.tagged)}</td><td></td><td>${e2e(d.all)}</td>${inc ? `<td></td><td>${e2e(inc.tagged)}</td>` : ""}</tr></tbody></table></div>
    <p class="legend-note">Tagged = a UTM source other than direct. Flags: method selected → order under 85%, payment step → method selected under 62%.${inc ? ` Since last snapshot: ${esc(new Date(inc.from).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }))} → ${esc(up)}.` : ""}</p>`;
}
function liveBindV2(p) {
  document.getElementById("live-hview")?.addEventListener("click", (ev) => { const b = ev.target.closest("button[data-h]"); if (b) { liveSetHview(b.dataset.h); destroyCharts(); R.live(p); } });
  document.getElementById("live-sales")?.addEventListener("click", (ev) => { const b = ev.target.closest("button[data-s]"); if (b) { liveSetSales(b.dataset.s); destroyCharts(); R.live(p); } });
  const btn = document.getElementById("gk-up"), inp = document.getElementById("gk-file");
  if (btn && inp) {
    btn.addEventListener("click", () => inp.click());
    inp.addEventListener("change", async () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      btn.disabled = true; btn.textContent = `Uploading ${f.name}…`;
      try {
        const r = await fetch("/api/gokwik/upload", { method: "POST", credentials: "same-origin", headers: { "X-File-Name": f.name, "Content-Type": "text/csv" }, body: f });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
        if (j.duplicate) alert("This exact file was uploaded before; nothing new was added.");
        LIVE.gkcsv = null; destroyCharts(); R.live(p);
      } catch (e) { btn.disabled = false; btn.textContent = "Upload GoKwik CSV"; alert(`Not uploaded: ${e.message}`); }
    });
  }
}

/* Today only, hour by hour, in the team's sheet's columns (up to Sessions → ATC %):
   what is working and what is not, hour against hour of the same day. */
const liveHview = () => (liveQ().get("hours") === "cmp" ? "cmp" : "today");
function liveSetHview(v) {
  const q = liveQ();
  if (v === "cmp") q.set("hours", "cmp"); else q.delete("hours");
  history.replaceState(null, "", "#live" + (q.toString() ? "?" + q.toString() : ""));
}
function liveIcToday(p) {
  // IC = GoKwik checkouts started (all traffic), as in the team's sheet: the automated
  // load when it has today, else the newest upload; GoKwik gives one total per day
  const gk = p.gokwik, v2 = p.v2 || {};
  if (gk && !gk.na && v2.gokwik_load && v2.gokwik_load.today_rows && gk.steps) return { v: gk.steps[0].count, src: "GoKwik load" };
  const S = LIVE.gkcsv;
  if (S && S.day === p.today && S.data && !S.data.none) {
    const at = new Date(S.data.upload.uploaded_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
    return { v: S.data.all.checkout_started, src: `GoKwik upload, ${at}` };
  }
  return null;
}
function liveHoursToday(p, t) {
  const T = liveTodayHours(p), v2 = p.v2 || {}, ph = v2.perf_hours;
  const hNow = Math.min(23, Math.floor(t)), mins = Math.round((t - hNow) * 60);
  const sales = liveSales() === "placed" ? "placed" : "gmv";
  const v = (k, h) => (T[k] ? T[k][h] : null);
  const rows = [];
  for (let h = 0; h <= hNow; h++) {
    const n = v("sessions", h), a = v("atc", h), o = v("orders", h), r = v(sales, h);
    rows.push({ h, partial: h === hNow && mins > 0, label: `${String(h).padStart(2, "0")}:00 · ${h % 12 || 12} ${h < 12 ? "am" : "pm"}`,
      n, perf: ph ? ph.sessions[h] : null, a, o, r, aov: o ? r / o : null, atcR: n ? a / n : null });
  }
  const sum = (k) => rows.reduce((x, r) => (r[k] == null ? x : (x ?? 0) + r[k]), null);
  const tot = { label: `So far (to ${String(hNow).padStart(2, "0")}:${String(mins).padStart(2, "0")})`, total: true,
    n: sum("n"), perf: ph ? sum("perf") : null, a: sum("a"), o: sum("o"), r: sum("r") };
  tot.aov = tot.o ? tot.r / tot.o : null; tot.atcR = tot.n ? tot.a / tot.n : null;
  const ic = liveIcToday(p);
  // the sheet's colouring: each column against the day's full hours so far (green above, red below)
  const done = rows.filter((r) => !r.partial && r.n >= 200);
  const tint = (k, val) => {
    if (val == null || done.length < 3) return "";
    const xs = done.map((r) => r[k]).filter((x) => x != null).sort((a, b) => a - b);
    const med = xs[Math.floor(xs.length / 2)];
    if (!med) return "";
    const d = val / med - 1;
    if (Math.abs(d) < 0.1) return "";
    const s = Math.min(0.45, Math.abs(d) * 0.9).toFixed(2);
    return ` style="background:${d > 0 ? `rgba(46,160,67,${s})` : `rgba(207,34,46,${s})`}"`;
  };
  const f = (val, fm) => (val == null ? '<span class="na">–</span>' : esc(mFormat(fm, val)));
  const cell = (r, k, fm, heat) => `<td${heat && !r.partial && !r.total ? tint(k, r[k]) : ""}>${f(r[k], fm)}</td>`;
  const body = [...rows, tot].map((r) => `<tr class="${r.total ? "total" : ""}${r.partial ? " partial" : ""}">
    <td class="text">${esc(r.label)}${r.partial ? ` <span class="chip pending" title="The hour under way">partial · ${mins} min</span>` : ""}</td>
    ${cell(r, "n", "count")}${cell(r, "perf", "count")}${cell(r, "a", "count")}
    <td>${r.total ? (ic ? `${esc(mFormat("count", ic.v))} <span class="sub" title="${esc(ic.src)}">day total</span>` : '<span class="na" title="No GoKwik numbers for today yet: upload the export on the Checkout card">–</span>') : '<span class="na" title="GoKwik gives checkouts started as one total per day">–</span>'}</td>
    ${cell(r, "o", "count")}${cell(r, "r", "currency")}${cell(r, "aov", "currency", true)}${cell(r, "atcR", "percent", true)}</tr>`).join("");
  const H = (id, l, tip) => `<th>${id ? mHead(id, l) : `${esc(l)}${tip ? ` <span class="tip" tabindex="0" role="note" data-tip="${esc(tip)}" aria-label="${esc(tip)}">i</span>` : ""}`}</th>`;
  return `<div class="table-wrap lh2 lht" style="max-height:66vh"><table><thead><tr><th class="text">Hour (IST)</th>
    ${H("sessions", "Overall Sessions")}${H(null, "Perf. Sessions", "The team's paid, affiliate and CRM sources with a UTM campaign; awareness and Reach left out: the Perf Sessions card, hour by hour.")}${H("atc", "ATC")}${H(null, "IC", "Checkouts started in GoKwik (all traffic), as in the team's sheet. GoKwik gives one total per day, so it shows on the So far row only: from the automated load when it has today, else the newest uploaded export.")}
    ${H("orders", "Orders")}${H(sales === "placed" ? "order_value_placed" : "total_sales", sales === "placed" ? "Order value placed" : "Revenue")}${H("aov", "AOV")}${H("atc_rate", "Sessions to ATC %")}</tr></thead>
    <tbody>${body}</tbody></table></div>
    <p class="legend-note">Today only. AOV and Sessions to ATC % are coloured against the day's middle hour so far (hours with at least 200 sessions): green above, red below; the hour under way is never coloured. Volumes are not coloured: nights are always quieter.${ph ? "" : " Perf. Sessions by hour: " + esc(v2.perf_hours_error || "not read yet (the next live run reads them)") + "."}${ph && ph.truncated ? " Perf. Sessions may be slightly low: the breakdown hit Shopify's row limit." : ""} Revenue follows the sales headline switch above.</p>`;
}
function liveHoursBlock(p, t, past, typ, cmpLabel) {
  const seg = `<div class="seg" id="live-hview" role="group" aria-label="Hour table">${[["today", "Today only"], ["cmp", `Against ${cmpLabel}`]].map(([k, l]) => `<button type="button" data-h="${k}" aria-pressed="${liveHview() === k}">${esc(l)}</button>`).join("")}</div>`;
  return `<div class="live-v2-bar">${seg}</div>` + (liveHview() === "cmp" ? liveHoursV2(p, t, past, typ, cmpLabel) : liveHoursToday(p, t));
}
