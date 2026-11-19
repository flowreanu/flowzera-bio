// Records a page view or a link click. Called from index.html with navigator.sendBeacon.
const { pipe, dayStr, ip, sha, readBody, P, R_TOK } = require('./_lib');

const LINKS = new Set([
  'mindrush', 'mindrush-buy', 'mindrush-trial', 'partypack', 'nitrorally', 'crust', 'flowmedia', 'vsl', 'ugc', 'shortform', 'docuseries',
  'framebyfear', 'whatsapp', 'social-tiktok', 'social-youtube', 'social-whatsapp', 'social-games',
]);
const BOT = /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|headless|lighthouse|pingdom|uptime|curl|wget|python|axios|node-fetch/i;

function source(ua, ref) {
  if (/musical_ly|BytedanceWebview|TikTok/i.test(ua)) return 'TikTok app';
  if (/Instagram/i.test(ua)) return 'Instagram app';
  if (/FBAN|FBAV/i.test(ua)) return 'Facebook app';
  if (/WhatsApp/i.test(ua)) return 'WhatsApp';
  if (!ref) return 'Direct';
  try {
    const h = new URL(ref).hostname.replace(/^www\.|^m\.|^l\./, '');
    if (/flowzera\.vercel\.app$/.test(h)) return 'Direct';
    if (/tiktok/.test(h)) return 'TikTok';
    if (/instagram/.test(h)) return 'Instagram';
    if (/facebook|fb\.com/.test(h)) return 'Facebook';
    if (/youtube|youtu\.be/.test(h)) return 'YouTube';
    if (/google\./.test(h)) return 'Google';
    if (/t\.co$|twitter|x\.com/.test(h)) return 'X / Twitter';
    if (/linkedin|lnkd/.test(h)) return 'LinkedIn';
    if (/whatsapp/.test(h)) return 'WhatsApp';
    return h.slice(0, 60);
  } catch { return 'Direct'; }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).end();
  const ua = String(req.headers['user-agent'] || '');
  if (!ua || BOT.test(ua)) return res.status(204).end();

  const b = readBody(req);
  const type = b.t === 'click' ? 'click' : b.t === 'view' ? 'view' : null;
  if (!type) return res.status(400).end();

  const day = dayStr();
  const cc = String(req.headers['x-vercel-ip-country'] || 'XX').toUpperCase().slice(0, 2);
  const visitor = sha(ip(req) + '|' + ua + '|' + day + '|' + (R_TOK || '')).slice(0, 24); // anonymous, rotates daily

  try {
    // simple flood protection: max 60 events per visitor per minute
    const rl = P + 'rl:' + visitor;
    const [n] = await pipe([['INCR', rl], ['EXPIRE', rl, '60']]);
    if (n > 60) return res.status(204).end();

    const cmds = [['SADD', P + 'days', day]];
    if (type === 'view') {
      const src = source(ua, String(b.ref || ''));
      const dev = /iPad|Tablet/i.test(ua) ? 'Tablet' : /Mobi|Android|iPhone/i.test(ua) ? 'Mobile' : 'Desktop';
      cmds.push(
        ['HINCRBY', P + 'd:' + day, 'views', '1'], ['HINCRBY', P + 'tot', 'views', '1'],
        ['PFADD', P + 'u:' + day, visitor], ['PFADD', P + 'u:all', visitor],
        ['HINCRBY', P + 'cc:' + day, cc, '1'], ['HINCRBY', P + 'cc:all', cc, '1'],
        ['HINCRBY', P + 'ref:' + day, src, '1'], ['HINCRBY', P + 'ref:all', src, '1'],
        ['HINCRBY', P + 'dev:' + day, dev, '1'], ['HINCRBY', P + 'dev:all', dev, '1'],
      );
    } else {
      const id = String(b.id || '');
      if (!LINKS.has(id)) return res.status(400).end();
      cmds.push(
        ['HINCRBY', P + 'd:' + day, 'clicks', '1'], ['HINCRBY', P + 'tot', 'clicks', '1'],
        ['HINCRBY', P + 'l:' + day, id, '1'], ['HINCRBY', P + 'l:all', id, '1'],
        ['HINCRBY', P + 'ccc:' + day, cc, '1'], ['HINCRBY', P + 'ccc:all', cc, '1'],
      );
    }
    await pipe(cmds);
    return res.status(204).end();
  } catch (e) {
    return res.status(500).json({ error: 'track_failed' });
  }
};
