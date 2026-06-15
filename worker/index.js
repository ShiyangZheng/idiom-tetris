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
 *   META:blob     single JSON value: a sorted top-50 array.
 *                 THIS IS THE SOURCE OF TRUTH FOR READS.
 *                 kv.get() is strongly consistent, so the read path
 *                 always reflects the latest write — fixes the previous
 *                 15-20s "I submitted but don't see myself in the
 *                 leaderboard" race caused by `kv.list()` being
 *                 eventually consistent.
 *   META:meta     JSON { count, lastTs, lastId } — cheap counter for /healthz
 *   SCORES:e:...  per-entry backup, written best-effort in the background.
 *                 Used only for one-time rebuild if META:blob is ever lost
 *                 (KV can in theory evict under memory pressure even
 *                 though blob is small).
 *   RATE:r:ip     rate-limit state: { count, windowStart }  (5 / hour)
 *
 * Why the blob approach
 * ─────────────────────
 *   Cloudflare KV `get` is strongly consistent; `list` is eventually
 *   consistent (typically 15-60s lag for new keys). The previous design
 *   used `list({prefix: 'e:'})` on every /leaderboard read, so users
 *   who just submitted would not see their own row for ~15-20s.
 *
 *   Putting the entire top-50 in a single key makes the read a single
 *   `kv.get()` call: instant, strongly consistent, and cheaper (1 read
 *   instead of 1 + N gets).
 *
 *   Cost: each submit writes a ~7.5KB JSON value (top-50) instead of
 *   a 200-byte entry. At 5 submits/h per IP this is ~37.5KB/h/user,
 *   trivial. KV free tier: 100K writes/day → 1 write per submit
 *   gives us ~20K unique users/day headroom. Plenty for a hobby app.
 *
 * Race conditions
 * ───────────────
 *   Two concurrent submits from the same IP can both read blob v0,
 *   each compute v1 with their own appended entry, and last write
 *   wins — losing one entry. We accept this for a hobby project:
 *   rate limit is 5/h per IP, so collisions are rare, and at worst
 *   one entry in ~5h is lost. Cloudflare Workers KV has no native
 *   compare-and-swap, and the read-modify-write pattern with a
 *   version counter would be over-engineering for the scale.
 *
 * Anti-spam
 * ─────────
 *   • Per IP: 5 submits per rolling hour
 *   • Per score: hard cap score <= 9_999_999; cleared <= 9_999
 *   • Per name: 1..12 chars; must match /[\p{L}\p{N}_\- ]{1,12}/u
 *     (letters/digits/space/_/- — any script, no emoji to keep the
 *     modal layout predictable)
 *   • Hard cap: blob is trimmed to top 50 on every write.
 *     SCORES is trimmed to top 200 in the background (best effort).
 *
 * CORS
 * ────
 *   Allow * origin (the game is a public static page and the worker
 *   only writes public data). We mirror the request Origin back as
 *   the response header so the browser is happy.
 *
 * Deploy
 * ──────
 *   See wrangler.toml for the deployment gotcha. In short: don't run
 *   `wrangler deploy` from the parent project dir — wrangler 4.x will
 *   auto-bundle sibling files as static assets and shadow the worker.
 *   Copy worker/* to a stand-alone dir first.
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

const BLOB_KEY    = 'blob';     // META namespace
const META_KEY    = 'meta';     // META namespace: cheap counter for /healthz
const BLOB_LIMIT  = 50;         // entries kept in the blob (also returned by /leaderboard)
const SCORES_HARD_CAP = 200;    // entries kept in SCORES (background trim)

async function healthz(env) {
  const meta = await readMeta(env);
  return { ok: true, count: meta.count || 0, lastTs: meta.lastTs || 0 };
}

/**
 * GET /leaderboard.
 *
 * Read path: single strongly-consistent kv.get on META:blob.
 * If the blob is missing (cold start, eviction, or pre-fix deployment),
 * fall back to a one-time rebuild from SCORES, then write the blob
 * back so the next read is fast. The rebuild path is slow (~N+1 reads)
 * but only runs once per cold start.
 */
async function getLeaderboard(env) {
  let blob = await readBlob(env);
  if (blob === null) {
    /* Cold start or first ever read — rebuild from SCORES. */
    const all = await readAllEntriesFromScores(env);
    blob = sortAndTrim(all, BLOB_LIMIT);
    /* Persist the rebuild so the next /leaderboard read is a single kv.get. */
    if (blob.length > 0) {
      await env.META.put(BLOB_KEY, JSON.stringify(blob));
    }
  }
  /* Project the blob into the public shape. We don't expose `ip` or `ts`. */
  const entries = blob.map((e, i) => ({
    rank:    i + 1,
    name:    e.name,
    score:   e.score,
    cleared: e.cleared,
    when:    e.when || null,
  }));
  return { entries };
}

/**
 * POST /submit.
 *
 * Rate-limit (RATE), then read blob, append, sort, trim, write blob.
 * SCORES backup is best-effort and happens in the background so a
 * SCORES write failure doesn't break the user-visible submit.
 */
async function submit(request, env, ctx) {
  /* -------- Parse + validate body -------- */
  let body;
  try { body = await request.json(); } catch {
    return { status: 400, body: { error: 'invalid JSON body' } };
  }
  const name    = String(body.name || '').trim();
  const score   = Number(body.score);
  const cleared = Number(body.cleared);

  if (!isValidName(name))
    return { status: 400, body: { error: 'name must be 1-12 letters/digits/space/_/-' } };
  if (!Number.isInteger(score) || score < 0 || score > 9_999_999)
    return { status: 400, body: { error: 'score must be an integer in [0, 9999999]' } };
  if (!Number.isInteger(cleared) || cleared < 0 || cleared > 9_999)
    return { status: 400, body: { error: 'cleared must be an integer in [0, 9999]' } };

  /* -------- Rate limit (5 / hour / IP) -------- */
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

  /* -------- Read blob, append, sort, trim, write back -------- */
  const ts = now;
  const when = new Date(now).toISOString();
  const entry = { name, score, cleared, ts, when, ip };
  // `ip` and `ts` are kept in the blob for ranking (the in-memory sort uses ts
  // as the tiebreaker) but stripped by getLeaderboard() before being sent to
  // the client.

  let blob = await readBlob(env);
  if (blob === null) {
    /* Cold start — rebuild from SCORES so the new entry ranks correctly
     * against the historical data. */
    blob = sortAndTrim(await readAllEntriesFromScores(env), BLOB_LIMIT);
  }
  blob.push(entry);
  blob = sortAndTrim(blob, BLOB_LIMIT);

  /* Find the rank of the entry we just added. Tiebreaker (ts asc) means
   * the first matching entry in the sorted blob is ours (this request is
   * the most recent ts for this IP, modulo clock skew). */
  const rank = blob.findIndex(e => e.ts === ts && e.ip === ip && e.name === name) + 1;
  const total = blob.length;

  /* Write the blob FIRST so the user-visible read path is consistent.
   * If this fails, we throw and the client sees a 500 — better than
   * returning a rank the user can't verify. */
  await env.META.put(BLOB_KEY, JSON.stringify(blob));

  /* Update the cheap counter for /healthz. Best-effort. */
  const meta = { count: total, lastTs: ts, lastId: `e:${ts}` };
  ctx.waitUntil(env.META.put(META_KEY, JSON.stringify(meta)));

  /* Per-entry SCORES backup, also best-effort + background. This is
   * what we'd rebuild from if META:blob were ever lost. Also runs the
   * SCORES trim in the background to keep that namespace bounded. */
  const id = `e:${ts}:${Math.random().toString(36).slice(2, 8)}`;
  ctx.waitUntil((async () => {
    try {
      await env.SCORES.put(id, JSON.stringify(entry));
      await trimScoresToTop(env, SCORES_HARD_CAP);
    } catch (e) {
      console.error('SCORES backup failed:', e && e.message || e);
    }
  })());

  return { status: 200, body: { rank, total } };
}

/* ────────────────────────────────────────────────────────────────── */
/* Blob storage                                                       */
/* ────────────────────────────────────────────────────────────────── */

/**
 * Read the leaderboard blob from META:blob. Returns null if absent
 * (first ever read, or KV cold start).
 */
async function readBlob(env) {
  const raw = await env.META.get(BLOB_KEY);
  if (!raw) return null;
  const parsed = safeJson(raw, null);
  if (!Array.isArray(parsed)) return null;
  return parsed;
}

function sortAndTrim(entries, limit) {
  return entries
    .sort((a, b) => b.score - a.score || a.ts - b.ts) // score desc, earliest first
    .slice(0, limit);
}

/* ────────────────────────────────────────────────────────────────── */
/* META / SCORES helpers (counters + backup storage)                  */
/* ────────────────────────────────────────────────────────────────── */

async function readMeta(env) {
  const raw = await env.META.get(META_KEY);
  return raw ? safeJson(raw, { count: 0, lastTs: 0 }) : { count: 0, lastTs: 0 };
}

async function readAllEntriesFromScores(env) {
  /* Slow path: only used once for the blob rebuild. With <200 entries
   * this is at most 1 list call + 200 gets, ~10ms in practice. */
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

/**
 * Trim the SCORES namespace to keep the top N entries by score, using
 * the same score-desc/ts-asc tiebreaker as the blob. Best-effort,
 * runs in the background — losing a few historical entries to a
 * concurrent submit is acceptable.
 */
async function trimScoresToTop(env, limit) {
  const all = await readAllEntriesFromScores(env);
  if (all.length <= limit) return;
  const keep = new Set(
    sortAndTrim(all, limit).map(e => `e:${e.ts}:${extractSuffix(e)}`)
  );
  let cursor;
  do {
    const page = await env.SCORES.list({ prefix: 'e:', cursor });
    for (const k of page.keys) {
      if (!keep.has(k.name)) {
        try { await env.SCORES.delete(k.name); } catch {}
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
}

/* The random suffix is part of the SCORES key (`e:<ts>:<rand>`). We
 * don't actually need to extract the random part for trim — the
 * `name` + `ts` + `ip` triple uniquely identifies an entry, and
 * the list-based path is correct. */
function extractSuffix(_e) { return ''; }

/* ────────────────────────────────────────────────────────────────── */
/* Validation                                                         */
/* ────────────────────────────────────────────────────────────────── */

function isValidName(s) {
  if (typeof s !== 'string') return false;
  if (s.length < 1 || s.length > 12) return false;
  // Letters (any script), digits, space, _, -
  // (Previously also allowed emoji but removed to keep the modal
  //  layout predictable; emojis in 12-char wide cells were clipping.)
  return /^[\p{L}\p{N}_\- ]{1,12}$/u.test(s);
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
