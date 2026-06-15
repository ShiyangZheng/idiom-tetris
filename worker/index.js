/**
 * Idiom Tetris — Cloudflare Worker + KV leaderboard.
 *
 * Endpoints
 * ─────────
 *   GET  /healthz              → { ok: true, count, lastTs }
 *   GET  /leaderboard          → { entries: [{rank, name, score, cleared, when}] }  (top 50)
 *   POST /submit               body: {name, score, cleared}
 *                              → 200 { rank, total }
 *                              → 400 { error } | 429 { error } (rate-limited)
 *
 * Storage
 * ───────
 *   SCORES (KV)  key:  "e:" + <epoch-ms>:<random>  value: JSON {name, score, cleared, ts, when, ip}
 *                                                            ts: epoch ms (sort key)
 *                                                            when: ISO 8601 (client display)
 *                                       one entry per accepted submit
 *   RATE  (KV)   key:  "r:" + <ip>             value: JSON {count, windowStart}  (5/h)
 *   META (KV)    key:  "meta"                  value: JSON {count, lastTs, lastId}
 *
 * Anti-spam
 * ─────────
 *   • Per IP: 5 submits per rolling hour (KV read+write of rate:{ip})
 *   • Per score: hard cap score <= 9_999_999; cleared <= 9_999
 *   • Per name: 1..12 chars, must match /^[\p{L}\p{N}_\- ]{1,12}$/u (letters/digits/space/_/-)
 *   • Hard cap on the leaderboard: keep top 200 entries globally.
 *     On submit, we read all entries (we store <200 typical), append, sort by score desc,
 *     trim to 200, and overwrite. KV doesn't support atomic multi-key writes, so we
 *     accept eventual-consistency for the cap; in practice the worker is the only writer
 *     and KV writes are linearized.
 *
 * CORS
 * ────
 *   Allow * origin (the game is a public static page and the worker only writes
 *   public data). We mirror the request Origin back as the response header so the
 *   browser is happy.
 *
 * Deploy
 * ──────
 *   wrangler kv:namespace create LEADERBOARD
 *   wrangler deploy
 */
export default {
  async fetch(request, env, ctx) {
    /* -------- CORS preflight -------- */
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    try {
      if (path === '/healthz' && request.method === 'GET') {
        return jsonOk(await healthz(env), request);
      }
      if (path === '/leaderboard' && request.method === 'GET') {
        return jsonOk(await getLeaderboard(env), request);
      }
      if (path === '/submit' && request.method === 'POST') {
        const out = await submit(request, env, ctx);
        return jsonOk(out.body, request, out.status);
      }
      return jsonOk({ error: 'not found' }, request, 404);
    } catch (e) {
      /* Don't leak stack traces to the client; log the full error to the
       * worker console (visible in `wrangler tail`). */
      console.error('worker error:', e && e.stack || e);
      return jsonOk({ error: 'internal error' }, request, 500);
    }
  },
};

/* ────────────────────────────────────────────────────────────────── */
/* Endpoints                                                          */
/* ────────────────────────────────────────────────────────────────── */

async function healthz(env) {
  const meta = await readMeta(env);
  return { ok: true, count: meta.count || 0, lastTs: meta.lastTs || 0 };
}

async function getLeaderboard(env) {
  const all = await readAllEntries(env);            // [{name, score, cleared, ts, when}, …]
  const sorted = all
    .sort((a, b) => b.score - a.score || a.ts - b.ts) // score desc, then earliest first
    .slice(0, 50)
    .map((e, i) => ({
      rank: i + 1,
      name: e.name,
      score: e.score,
      cleared: e.cleared,
      when: e.when || null,                          // ISO 8601 string; null for legacy entries
    }));
  return { entries: sorted };
}

async function submit(request, env, ctx) {
  /* -------- Parse + validate body -------- */
  let body;
  try { body = await request.json(); } catch {
    return { status: 400, body: { error: 'invalid JSON body' } };
  }
  const name    = String(body.name || '').trim();
  const score   = Number(body.score);
  const cleared = Number(body.cleared);

  if (!isValidName(name))       return { status: 400, body: { error: 'name must be 1-12 letters/digits/space/_/-' } };
  if (!Number.isInteger(score) || score < 0 || score > 9_999_999)
                                return { status: 400, body: { error: 'score must be an integer in [0, 9999999]' } };
  if (!Number.isInteger(cleared) || cleared < 0 || cleared > 9_999)
                                return { status: 400, body: { error: 'cleared must be an integer in [0, 9999]' } };

  /* -------- Rate limit (5 / hour / IP) --------
   * KV doesn't have atomic increment, so we do a read-modify-write.
   * Two concurrent submits from the same IP can both pass the check, which
   * is acceptable for a hobby leaderboard (worst case: 10/hour, not 5). */
  const ip = (request.headers.get('CF-Connecting-IP') || 'unknown').slice(0, 64);
  const now = Date.now();
  const HOUR = 60 * 60 * 1000;
  const RATE_LIMIT = 5;
  const rateKey = `r:${ip}`;
  const rateRaw = await env.RATE.get(rateKey);
  let rate = rateRaw ? safeJson(rateRaw, { count: 0, windowStart: now }) : { count: 0, windowStart: now };
  if (now - rate.windowStart > HOUR) { rate = { count: 0, windowStart: now }; }
  if (rate.count >= RATE_LIMIT) {
    return { status: 429, body: { error: 'rate limit: max 5 submissions per hour' } };
  }
  rate.count += 1;
  await env.RATE.put(rateKey, JSON.stringify(rate), { expirationTtl: 60 * 60 * 2 });

  /* -------- Write the new entry -------- */
  const ts = now;
  const when = new Date(now).toISOString();
  const id = `e:${ts}:${Math.random().toString(36).slice(2, 8)}`;
  const entry = { name, score, cleared, ts, when, ip };  // ip kept for moderation; never sent to clients
  await env.SCORES.put(id, JSON.stringify(entry));

  /* -------- Recompute top 200 + rank of this entry --------
   * `ctx.waitUntil` lets us do the trim in the background so the response
   * can return immediately with the rank. We still need the rank synchronously,
   * so we do a single read of all entries here (small N; KV is fast). */
  const all = await readAllEntries(env);
  all.push(entry);
  const sorted = all.sort((a, b) => b.score - a.score || a.ts - b.ts);
  const rank = sorted.findIndex(e => e.ts === ts && e.ip === ip) + 1;
  const total = sorted.length;

  // Update META
  const meta = { count: total, lastTs: ts, lastId: id };
  await env.META.put('meta', JSON.stringify(meta));

  // Trim to top 200 (background, ok to be eventually-consistent)
  ctx.waitUntil(trimToTop200(env, sorted));

  return { status: 200, body: { rank, total } };
}

/* ────────────────────────────────────────────────────────────────── */
/* Storage helpers                                                    */
/* ────────────────────────────────────────────────────────────────── */

async function readMeta(env) {
  const raw = await env.META.get('meta');
  return raw ? safeJson(raw, { count: 0, lastTs: 0 }) : { count: 0, lastTs: 0 };
}

async function readAllEntries(env) {
  /* KV list with prefix returns {keys, ...}; for each key we get a `get`.
   * With <200 entries this is cheap. */
  const out = [];
  let cursor;
  do {
    const page = await env.SCORES.list({ prefix: 'e:', cursor });
    const reads = page.keys.map(k => env.SCORES.get(k.name));
    const values = await Promise.all(reads);
    for (const v of values) {
      if (!v) continue;
      const e = safeJson(v, null);
      if (e) out.push(e);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

async function trimToTop200(env, sorted) {
  if (sorted.length <= 200) return;
  const toDelete = sorted.slice(200).map(e => `e:${e.ts}:${extractSuffix(e)}`);
  // We need to find the actual KV keys; `list` to enumerate again and drop by ts.
  let cursor;
  do {
    const page = await env.SCORES.list({ prefix: 'e:', cursor });
    for (const k of page.keys) {
      const v = await env.SCORES.get(k.name);
      if (!v) continue;
      const e = safeJson(v, null);
      if (!e) continue;
      if (sorted.slice(200).some(x => x.ts === e.ts && x.ip === e.ip && x.name === e.name)) {
        await env.SCORES.delete(k.name);
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  void toDelete; // (we use the list-based path above for correctness)
}

/* The random suffix is part of the key. We don't actually need it for trim —
 * the list-based path above is correct. */
function extractSuffix(_e) { return ''; }

/* ────────────────────────────────────────────────────────────────── */
/* Validation                                                         */
/* ────────────────────────────────────────────────────────────────── */

function isValidName(s) {
  if (typeof s !== 'string') return false;
  if (s.length < 1 || s.length > 12) return false;
  // Letters (any script), digits, emojis, space, _, -
  // Emoji range covers the standard emoji blocks (Misc Symbols, Pictographs,
  // Transport, Supplemental Symbols & Pictographs, etc.)
  return /^[\p{L}\p{N}_\- \p{Extended_Pictographic}]{1,12}$/u.test(s);
}

function safeJson(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

/* ────────────────────────────────────────────────────────────────── */
/* CORS                                                               */
/* ────────────────────────────────────────────────────────────────── */

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin':  origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age':       '86400',
    'Vary': 'Origin',
  };
}

function jsonOk(body, request, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': status === 200 ? 'public, max-age=10' : 'no-store',
      ...corsHeaders(request),
    },
  });
}
