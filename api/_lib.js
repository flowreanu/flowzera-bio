// Shared helpers for the FlowZera stats functions (files starting with "_" are not routes on Vercel).
const crypto = require('crypto');

const R_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const R_TOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const P = 'fzbio:'; // every key of this site lives under this prefix

async function pipe(cmds) {
  if (!R_URL || !R_TOK) throw new Error('Redis is not configured');
  const r = await fetch(R_URL.replace(/\/$/, '') + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + R_TOK, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error('Redis error ' + r.status);
  const j = await r.json();
  return j.map((x) => (x && 'result' in x ? x.result : null));
}

// Upstash returns HGETALL as a flat [k, v, k, v] array.
function hash(arr) {
  const o = {};
  if (Array.isArray(arr)) for (let i = 0; i < arr.length; i += 2) o[arr[i]] = Number(arr[i + 1]) || 0;
  else if (arr && typeof arr === 'object') for (const k in arr) o[k] = Number(arr[k]) || 0;
  return o;
}

const TZ = 'Europe/Berlin';
function dayStr(d = new Date()) {
  return d.toLocaleDateString('sv-SE', { timeZone: TZ }); // YYYY-MM-DD
}
function lastDays(n) {
  const out = [];
  const now = Date.now();
  for (let i = n - 1; i >= 0; i--) out.push(dayStr(new Date(now - i * 86400000)));
  return [...new Set(out)];
}

function ip(req) {
  return String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '').split(',')[0].trim();
}
function sha(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function readBody(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  if (Buffer.isBuffer(b)) { try { b = JSON.parse(b.toString('utf8')); } catch { b = {}; } }
  return b && typeof b === 'object' ? b : {};
}

module.exports = { pipe, hash, dayStr, lastDays, ip, sha, readBody, P, R_TOK };
