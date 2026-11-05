// Trem Mail v2 – mail.tm ফ্রি API, নিজের পছন্দের নাম + পাসওয়ার্ড দিয়ে একই ইনবক্স বারবার খোলা যায়
const PROVIDERS = [
  { id: "tm", base: "https://api.mail.tm" },
  { id: "gw", base: "https://api.mail.gw" }
];
const provById = (id) => PROVIDERS.find(p => p.id === id) || PROVIDERS[0];
const provByBase = (b) => PROVIDERS.find(p => p.base === b) || PROVIDERS[0];
const $ = (id) => document.getElementById(id);
const ls = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
};
let acc = null;           // {address,password,token,id}
let timer = null, known = new Set(), first = true, openId = null;

function toast(m) { const t = $("toast"); t.textContent = m; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 2600); }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function ago(d) { const s = (Date.now() - new Date(d)) / 1000; if (s < 60) return "এখন"; if (s < 3600) return Math.floor(s / 60) + " মি"; if (s < 86400) return Math.floor(s / 3600) + " ঘ"; return Math.floor(s / 86400) + " দিন"; }
function findCode(s) {
  s = String(s || "");
  let m = s.match(/(?:code|otp|verification|verify|pin|passcode|কোড)[^0-9]{0,40}(\d{4,8})\b/i); if (m) return m[1];
  m = s.match(/\b(\d{4,8})\b[^\n]{0,30}(?:is your|code)/i); if (m) return m[1];
  m = s.match(/\b(\d{6})\b/); if (m) return m[1];
  m = s.match(/\b(\d{4,8})\b/); return m ? m[1] : null;
}


// ক্লিপবোর্ডে কপি (ব্রাউজার + অ্যান্ড্রয়েড অ্যাপ দুটোতেই কাজ করে)
async function copyText(t) {
  try { if (window.AndroidBridge && AndroidBridge.copy) { AndroidBridge.copy(String(t)); return true; } } catch {}
  try { await navigator.clipboard.writeText(t); return true; } catch {}
  try {
    const a = document.createElement("textarea"); a.value = t; a.style.position = "fixed"; a.style.opacity = "0";
    document.body.appendChild(a); a.select(); const ok = document.execCommand("copy"); a.remove(); return ok;
  } catch { return false; }
}

async function http(base, path, opt = {}, token) {
  const headers = { ...(opt.headers || {}) };
  if (opt.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = "Bearer " + token;
  const r = await fetch(base + path, { ...opt, headers });
  if (r.status === 204) return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.message || j["hydra:description"] || ("ত্রুটি " + r.status)); e.status = r.status; throw e; }
  return j;
}

async function loadDomains() {
  const opts = [], errs = [];
  await Promise.all(PROVIDERS.map(async p => {
    try {
      const j = await http(p.base, "/domains");
      (j["hydra:member"] || []).filter(d => d.isActive !== false).forEach(d => opts.push({ v: d.domain + "|" + p.id, t: "@" + d.domain }));
    } catch (e) { errs.push(p.id + ": " + e.message); }
  }));
  if (opts.length) {
    $("domain").innerHTML = opts.map(o => `<option value="${esc(o.v)}">${esc(o.t)}</option>`).join("");
  } else {
    $("domain").innerHTML = '<option value="">ডোমেইন লোড হয়নি</option>';
    $("status").textContent = "ডোমেইন লোড হয়নি (" + (errs.join(" | ") || "অজানা") + "). নেট/ডেটা বদলে আবার চেষ্টা করুন।";
  }
  return opts.length;
}

// লগইন, না থাকলে অ্যাকাউন্ট তৈরি
async function connect(base, address, password) {
  try {
    const t = await http(base, "/token", { method: "POST", body: JSON.stringify({ address, password }) });
    return { address, password, base, token: t.token, id: t.id, created: false };
  } catch (e) {
    if (e.status !== 401) throw e;
  }
  try {
    await http(base, "/accounts", { method: "POST", body: JSON.stringify({ address, password }) });
  } catch (e) {
    if (e.status === 422) throw new Error("এই নামটা অন্য কেউ নিয়েছে, অথবা আগের পাসওয়ার্ড ভুল। অন্য নাম/পাসওয়ার্ড দিন।");
    throw e;
  }
  const t = await http(base, "/token", { method: "POST", body: JSON.stringify({ address, password }) });
  return { address, password, base, token: t.token, id: t.id, created: true };
}

function saveAccount(a) {
  const list = [{ address: a.address, password: a.password, base: a.base }, ...ls.get("tm_accounts", []).filter(x => x.address !== a.address)].slice(0, 12);
  ls.set("tm_accounts", list); ls.set("tm_current", a.address);
  chips();
}
function chips() {
  const cur = acc && acc.address;
  $("chips").innerHTML = ls.get("tm_accounts", []).map(x =>
    `<span class="chip ${x.address === cur ? "on" : ""}" data-a="${esc(x.address)}">${esc(x.address.split("@")[0])}<b data-x="${esc(x.address)}">✕</b></span>`).join("");
}

async function openAccount(address, password, base) {
  base = base || PROVIDERS[0].base;
  $("status").textContent = "খোলা হচ্ছে…";
  try {
    acc = await connect(base, address, password);
  } catch (e) { $("status").textContent = "ব্যর্থ"; toast(e.message); return; }
  saveAccount(acc);
  $("user").value = address.split("@")[0]; $("pass").value = password;
  const dv = address.split("@")[1] + "|" + provByBase(base).id; if ([...$("domain").options].some(o => o.value === dv)) $("domain").value = dv;
  known = new Set(); first = true; render([]);
  $("status").textContent = address + (acc.created ? " (নতুন তৈরি হলো)" : " (খোলা হলো)") + " – অটো-রিফ্রেশ চালু";
  await refresh();
  clearInterval(timer); timer = setInterval(() => refresh(true), 10000);
}

async function openFromForm() {
  const u = $("user").value.toLowerCase().trim().replace(/@.*$/, "");
  const p = $("pass").value;
  if (!/^[a-z0-9._-]{3,30}$/.test(u)) return toast("নাম: ৩–৩০ অক্ষর, শুধু a-z, 0-9, . _ -");
  if (p.length < 6) return toast("পাসওয়ার্ড কমপক্ষে ৬ অক্ষর দিন");
  if (!$("domain").value) { toast("ডোমেইন আবার লোড করছি…"); if (!(await loadDomains())) return; }
  const [d, pid] = $("domain").value.split("|");
  openAccount(u + "@" + d, p, provById(pid).base);
}

async function refresh(silent) {
  if (!acc) return;
  const mine = acc;
  try {
    let j;
    try { j = await http(mine.base, "/messages?page=1", {}, mine.token); }
    catch (e) {
      if (e.status === 401) { const t = await http(mine.base, "/token", { method: "POST", body: JSON.stringify({ address: mine.address, password: mine.password }) }); mine.token = t.token; j = await http(mine.base, "/messages?page=1", {}, mine.token); }
      else throw e;
    }
    if (mine !== acc) return;
    const msgs = j["hydra:member"] || [];
    if (!first) msgs.filter(m => !known.has(m.id)).forEach(m => toast("নতুন মেইল: " + (m.subject || "(বিষয় নেই)")));
    msgs.forEach(m => known.add(m.id)); first = false;
    render(msgs);
  } catch (e) { if (!silent) toast("রিফ্রেশ ব্যর্থ: " + e.message); }
}

function render(msgs) {
  $("count").textContent = msgs.length;
  $("empty").style.display = msgs.length ? "none" : "block";
  $("list").innerHTML = msgs.map(m => {
    const n = (m.from && (m.from.name || m.from.address)) || "?";
    const code = findCode((m.subject || "") + " " + (m.intro || ""));
    return `<li class="item ${m.seen ? "" : "unseen"}" data-id="${esc(m.id)}">
      <div class="avatar">${esc(n[0].toUpperCase())}</div>
      <div class="info"><div class="from"><span>${esc(n)}</span><small>${ago(m.createdAt)}</small></div>
      <div class="subj">${esc(m.subject || "(বিষয় নেই)")}</div>
      <div class="intro">${esc(m.intro || "")}</div>
      ${code ? `<div class="code" data-code="${esc(code)}">${esc(code)} <small>কপি কোড</small></div>` : ""}
      </div></li>`;
  }).join("");
}

async function openMsg(id) {
  try {
    const m = await http(acc.base, "/messages/" + encodeURIComponent(id), {}, acc.token);
    openId = id;
    $("mSubject").textContent = m.subject || "(বিষয় নেই)";
    $("mMeta").innerHTML = `From: ${esc(m.from && m.from.address)}<br>${new Date(m.createdAt).toLocaleString()}`;
    const body = (m.html && m.html.join("")) || `<pre style="white-space:pre-wrap;font-family:inherit">${esc(m.text)}</pre>`;
    $("mFrame").srcdoc = `<base target="_blank"><meta name="referrer" content="no-referrer"><body style="font-family:sans-serif;word-break:break-word">${body}</body>`;
    $("modal").classList.remove("hidden");
    http(acc.base, "/messages/" + encodeURIComponent(id), { method: "PATCH", headers: { "Content-Type": "application/merge-patch+json" }, body: JSON.stringify({ seen: true }) }, acc.token).then(() => refresh(true)).catch(() => {});
  } catch (e) { toast(e.message); }
}

$("list").onclick = async e => {
  const c = e.target.closest(".code");
  if (c) { e.stopPropagation(); if (await copyText(c.dataset.code)) toast("কোড কপি হয়েছে ✔"); else toast(c.dataset.code); return; }
  const li = e.target.closest(".item"); if (li) openMsg(li.dataset.id);
};
$("chips").onclick = e => {
  const x = e.target.closest("[data-x]");
  if (x) { e.stopPropagation(); ls.set("tm_accounts", ls.get("tm_accounts", []).filter(a => a.address !== x.dataset.x)); chips(); return; }
  const c = e.target.closest(".chip");
  if (c) { const a = ls.get("tm_accounts", []).find(z => z.address === c.dataset.a); if (a) openAccount(a.address, a.password, a.base); }
};
$("openBtn").onclick = openFromForm;
$("pass").onkeydown = $("user").onkeydown = e => { if (e.key === "Enter") openFromForm(); };
$("eyeBtn").onclick = () => { const p = $("pass"); p.type = p.type === "password" ? "text" : "password"; };
$("refreshBtn").onclick = () => refresh();
$("copyBtn").onclick = async () => { if (!acc) return toast("আগে খুলুন"); if (await copyText(acc.address)) toast("কপি হয়েছে ✔"); else toast("কপি করা যায়নি"); };
$("randBtn").onclick = () => {
  const c = "abcdefghjkmnpqrstuvwxyz23456789"; let s = "", p = "";
  for (let i = 0; i < 10; i++) s += c[Math.floor(Math.random() * c.length)];
  for (let i = 0; i < 12; i++) p += c[Math.floor(Math.random() * c.length)];
  $("user").value = s; $("pass").value = p; $("pass").type = "text";
  toast("র‍্যান্ডম নাম ও পাসওয়ার্ড বসেছে, 'খুলুন' চাপুন");
};
$("closeBtn").onclick = () => { $("modal").classList.add("hidden"); $("mFrame").srcdoc = ""; openId = null; };
$("delBtn").onclick = async () => {
  if (!openId || !confirm("এই মেইল ডিলিট করবেন?")) return;
  try { await http(acc.base, "/messages/" + encodeURIComponent(openId), { method: "DELETE" }, acc.token); $("closeBtn").onclick(); refresh(true); } catch (e) { toast(e.message); }
};
$("themeBtn").onclick = () => { const r = document.documentElement; const d = r.dataset.theme === "dark" ? "light" : "dark"; r.dataset.theme = d; localStorage.setItem("tm_theme", d); };
document.documentElement.dataset.theme = localStorage.getItem("tm_theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

(async function init() {
  chips();
  await loadDomains();
  const cur = ls.get("tm_current", null);
  const a = ls.get("tm_accounts", []).find(x => x.address === cur);
  if (a) openAccount(a.address, a.password, a.base);
})();
