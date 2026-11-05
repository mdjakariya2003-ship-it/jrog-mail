import PostalMime from "postal-mime";
import { INDEX_HTML, STYLE_CSS, APP_JS, SW_JS, MANIFEST, ICON_SVG, ICON_192, ICON_512 } from "./ui.js";

const KEEP_DAYS = 30;
const BOX_RE = /^[a-z0-9._-]{1,64}$/;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// মেইল থেকে ভেরিফিকেশন কোড খুঁজে বের করা
function findCode(subject, text) {
  const s = `${subject || ""}\n${text || ""}`;
  let m = s.match(/(?:code|otp|verification|verify|pin|passcode|কোড)[^0-9]{0,40}(\d{4,8})\b/i);
  if (m) return m[1];
  m = s.match(/\b(\d{4,8})\b[^\n]{0,30}(?:is your|code)/i);
  if (m) return m[1];
  m = s.match(/\b(\d{6})\b/);
  if (m) return m[1];
  m = s.match(/\b(\d{4,8})\b/);
  return m ? m[1] : null;
}


// mail.tm / mail.gw এর জন্য প্রক্সি (ফোনে সরাসরি ব্লক থাকলে এই পথে যায়)
const UPSTREAM = { tm: "https://api.mail.tm", gw: "https://api.mail.gw" };
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "authorization,content-type,accept",
  "access-control-max-age": "86400",
};
async function proxy(request, url) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const m = url.pathname.match(/^\/proxy\/(tm|gw)(\/.*)?$/);
  if (!m) return new Response("Not found", { status: 404, headers: CORS });
  const headers = new Headers();
  for (const h of ["authorization", "content-type", "accept"]) {
    const v = request.headers.get(h); if (v) headers.set(h, v);
  }
  const hasBody = !["GET", "HEAD"].includes(request.method);
  try {
    const r = await fetch(UPSTREAM[m[1]] + (m[2] || "/") + url.search, {
      method: request.method, headers, body: hasBody ? request.body : undefined, redirect: "follow",
    });
    const out = new Headers(CORS);
    out.set("content-type", r.headers.get("content-type") || "application/json");
    out.set("cache-control", "no-store");
    return new Response(r.status === 204 ? null : r.body, { status: r.status, headers: out });
  } catch (e) {
    return new Response(JSON.stringify({ message: "proxy error: " + String((e && e.message) || e) }), {
      status: 502, headers: { ...CORS, "content-type": "application/json" },
    });
  }
}

async function api(request, env, url) {
  const path = url.pathname;

  if (path === "/api/config") return json({ domain: env.DOMAIN, protected: !!env.APP_PASSWORD });

  if (env.APP_PASSWORD && request.headers.get("x-pass") !== env.APP_PASSWORD) {
    return json({ error: "unauthorized" }, 401);
  }

  if (path === "/api/messages") {
    const box = (url.searchParams.get("box") || "").toLowerCase();
    if (!BOX_RE.test(box)) return json({ error: "bad box" }, 400);

    if (request.method === "GET") {
      const { results } = await env.DB.prepare(
        "SELECT id, from_addr, from_name, subject, substr(text,1,3000) AS head, created, seen FROM messages WHERE mailbox = ? ORDER BY created DESC LIMIT 100"
      ).bind(box).all();
      const messages = results.map((r) => ({
        id: r.id,
        from_addr: r.from_addr,
        from_name: r.from_name,
        subject: r.subject,
        intro: (r.head || "").replace(/\s+/g, " ").trim().slice(0, 140),
        code: findCode(r.subject, r.head),
        created: r.created,
        seen: r.seen,
      }));
      return json({ messages });
    }
    if (request.method === "DELETE") {
      await env.DB.prepare("DELETE FROM messages WHERE mailbox = ?").bind(box).run();
      return json({ ok: true });
    }
  }

  const m = path.match(/^\/api\/messages\/([A-Za-z0-9-]{10,60})$/);
  if (m) {
    const id = m[1];
    if (request.method === "GET") {
      const row = await env.DB.prepare("SELECT * FROM messages WHERE id = ?").bind(id).first();
      if (!row) return json({ error: "not found" }, 404);
      await env.DB.prepare("UPDATE messages SET seen = 1 WHERE id = ?").bind(id).run();
      return json(row);
    }
    if (request.method === "DELETE") {
      await env.DB.prepare("DELETE FROM messages WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }
  }

  return json({ error: "not found" }, 404);
}

export default {
  // ১) ওয়েব অ্যাপ + API
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    if (p.startsWith("/proxy/") || request.method === "OPTIONS") return proxy(request, url);
    if (p.startsWith("/api/")) {
      try { return await api(request, env, url); }
      catch (e) { return json({ error: String(e && e.message || e) }, 500); }
    }
    const domain = env.DOMAIN || "jrog.com";
    const page = (body, type) => new Response(body, { headers: { "content-type": type, "cache-control": "no-cache" } });
    if (p === "/" || p === "/index.html") return page(INDEX_HTML.replaceAll("__DOMAIN__", domain), "text/html; charset=utf-8");
    if (p === "/style.css") return page(STYLE_CSS, "text/css; charset=utf-8");
    if (p === "/app.js") return page(APP_JS, "text/javascript; charset=utf-8");
    if (p === "/manifest.json") return page(MANIFEST.replaceAll("__DOMAIN__", domain), "application/manifest+json");
    if (p === "/sw.js") return page(SW_JS, "text/javascript");
    if (p === "/icon.svg") return page(ICON_SVG, "image/svg+xml");
    if (p === "/icon-192.png") return page(b64ToBytes(ICON_192), "image/png");
    if (p === "/icon-512.png") return page(b64ToBytes(ICON_512), "image/png");
    return new Response("Not found", { status: 404 });
  },

  // ২) Cloudflare Email Routing থেকে আসা মেইল
  async email(message, env) {
    if (message.rawSize > 10 * 1024 * 1024) { message.setReject("Message too large"); return; }
    const box = String(message.to || "").split("@")[0].split("+")[0].toLowerCase();
    if (!BOX_RE.test(box)) { message.setReject("Invalid mailbox"); return; }

    const raw = await new Response(message.raw).arrayBuffer();
    let p;
    try { p = await PostalMime.parse(raw); }
    catch { p = { subject: "(পড়া যায়নি)", text: "মেইলটি পার্স করা যায়নি।" }; }

    await env.DB.prepare(
      "INSERT INTO messages (id, mailbox, from_addr, from_name, subject, text, html, created, seen) VALUES (?,?,?,?,?,?,?,?,0)"
    ).bind(
      crypto.randomUUID(),
      box,
      (p.from && p.from.address) || message.from || "",
      (p.from && p.from.name) || "",
      p.subject || "",
      (p.text || "").slice(0, 100000),
      (p.html || "").slice(0, 400000),
      Date.now()
    ).run();
  },

  // ৩) পুরোনো মেইল পরিষ্কার
  async scheduled(event, env) {
    await env.DB.prepare("DELETE FROM messages WHERE created < ?")
      .bind(Date.now() - KEEP_DAYS * 86400000).run();
  },
};
