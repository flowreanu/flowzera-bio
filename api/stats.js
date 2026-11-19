// Password-protected stats for /stats. The password is chosen by the owner on first visit
// and stored only as a salted scrypt hash.
const crypto = require('crypto');
const { pipe, hash, lastDays, ip, sha, readBody, P } = require('./_lib');

function hashPw(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
function checkPw(pw, stored) {
  const [salt, h] = String(stored).split(':');
  if (!salt || !h) return false;
  const a = Buffer.from(h, 'hex');
  const b = crypto.scryptSync(pw, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function sum(into, from) { for (const k in from) into[k] = (into[k] || 0) + from[k]; return into; }

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (req.method !== 'POST') return res.status(405).end();
  const b = readBody(req);
  const pw = String(b.pw || '');
  const failKey = P + 'fail:' + sha(ip(req)).slice(0, 24);

  try {
    const [stored, fails] = await pipe([['GET', P + 'admin'], ['GET', failKey]]);

    // first visit: owner sets the password
    if (!stored) {
      if (!b.setup) return res.status(200).json({ needsSetup: true });
      if (pw.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
      const [ok] = await pipe([['SET', P + 'admin', hashPw(pw), 'NX']]);
      if (ok !== 'OK') return res.status(409).json({ error: 'Password already set.' });
    } else {
      if (!pw) return res.status(200).json({ needsLogin: true });
      if (Number(fails) >= 10) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
      if (!checkPw(pw, stored)) {
        await pipe([['INCR', failKey], ['EXPIRE', failKey, '900']]);
        return res.status(401).json({ error: 'Wrong password.' });
      }
      if (b.newPw) {
        if (String(b.newPw).length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
        await pipe([['SET', P + 'admin', hashPw(String(b.newPw))]]);
      }
    }

    const range = ['1', '7', '30', 'all'].includes(String(b.range)) ? String(b.range) : '30';
    let chartDays;
    if (range === 'all') {
      const [days] = await pipe([['SMEMBERS', P + 'days']]);
      chartDays = (days || []).sort();
      if (!chartDays.length) chartDays = lastDays(1);
      // fill gaps between first and last recorded day (max 365)
      const first = new Date(chartDays[0] + 'T12:00:00Z'), n = Math.min(365, Math.round((Date.now() - first) / 86400000) + 1);
      chartDays = lastDays(Math.max(n, 1));
    } else {
      chartDays = lastDays(range === '1' ? 1 : Number(range));
    }

    // per-day totals for the chart
    const dayCmds = [];
    chartDays.forEach((d) => dayCmds.push(['HGETALL', P + 'd:' + d], ['PFCOUNT', P + 'u:' + d]));
    const dayRes = await pipe(dayCmds);
    const days = chartDays.map((d, i) => {
      const h = hash(dayRes[i * 2]);
      return { date: d, views: h.views || 0, clicks: h.clicks || 0, uniques: Number(dayRes[i * 2 + 1]) || 0 };
    });

    let out;
    if (range === 'all') {
      const [tot, uAll, l, cc, ccc, ref, dev] = await pipe([
        ['HGETALL', P + 'tot'], ['PFCOUNT', P + 'u:all'], ['HGETALL', P + 'l:all'], ['HGETALL', P + 'cc:all'],
        ['HGETALL', P + 'ccc:all'], ['HGETALL', P + 'ref:all'], ['HGETALL', P + 'dev:all'],
      ]);
      const t = hash(tot);
      out = { views: t.views || 0, clicks: t.clicks || 0, uniques: Number(uAll) || 0,
        links: hash(l), countries: hash(cc), clickCountries: hash(ccc), sources: hash(ref), devices: hash(dev) };
    } else {
      const cmds = [['PFCOUNT', ...chartDays.map((d) => P + 'u:' + d)]];
      chartDays.forEach((d) => cmds.push(['HGETALL', P + 'l:' + d], ['HGETALL', P + 'cc:' + d], ['HGETALL', P + 'ccc:' + d], ['HGETALL', P + 'ref:' + d], ['HGETALL', P + 'dev:' + d]));
      const r = await pipe(cmds);
      const links = {}, countries = {}, clickCountries = {}, sources = {}, devices = {};
      chartDays.forEach((d, i) => {
        const o = 1 + i * 5;
        sum(links, hash(r[o])); sum(countries, hash(r[o + 1])); sum(clickCountries, hash(r[o + 2]));
        sum(sources, hash(r[o + 3])); sum(devices, hash(r[o + 4]));
      });
      out = { views: days.reduce((a, d) => a + d.views, 0), clicks: days.reduce((a, d) => a + d.clicks, 0),
        uniques: Number(r[0]) || 0, links, countries, clickCountries, sources, devices };
    }

    return res.status(200).json({ ok: true, range, days, ...out, generated: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ error: 'Stats unavailable: ' + e.message });
  }
};
