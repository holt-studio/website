/**
 * Holt Studio — RFQ form backend (Cloudflare Worker)
 *
 * Receives a form submission (POST JSON) and appends it as one row to
 * `submissions.csv` in a PRIVATE GitHub repo via the Contents API.
 * The GitHub token lives ONLY here, as a Worker secret — never in the page.
 *
 * Configure in wrangler.toml:
 *   [vars] GH_OWNER, GH_REPO, GH_FILE, ALLOWED_ORIGINS
 *   secret: GH_TOKEN  (fine-grained PAT, Contents: Read/Write on the private repo)
 */

const CSV_HEADER = 'timestamp,name,business,phone\n';

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, cors);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON' }, 400, cors);
    }

    // Honeypot: real users leave this empty; bots fill it.
    if (body.website) return json({ ok: true }, 200, cors);

    const name = clean(body.name);
    const business = clean(body.business);
    const phone = clean(body.phone);
    if (!name || !business || !phone) {
      return json({ error: 'Missing required fields' }, 422, cors);
    }

    const row =
      [new Date().toISOString(), name, business, phone].map(csvCell).join(',') + '\n';

    try {
      await appendRow(env, row);
    } catch (err) {
      return json({ error: 'Could not save', detail: String(err) }, 502, cors);
    }
    return json({ ok: true }, 200, cors);
  },
};

/* ---------- GitHub Contents API append (with one retry on sha conflict) ---------- */
async function appendRow(env, row, attempt = 0) {
  const api = `https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/contents/${env.GH_FILE}`;
  const headers = {
    Authorization: `Bearer ${env.GH_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'holt-studio-rfq-worker',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  // Read current file (if it exists) to get its sha + content.
  let sha;
  let content = CSV_HEADER;
  const getRes = await fetch(`${api}?ref=main`, { headers });
  if (getRes.status === 200) {
    const data = await getRes.json();
    sha = data.sha;
    content = b64decode(data.content.replace(/\n/g, ''));
    if (!content.endsWith('\n')) content += '\n';
  } else if (getRes.status !== 404) {
    throw new Error(`GET ${getRes.status}`);
  }

  const putRes = await fetch(api, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'RFQ submission',
      content: b64encode(content + row),
      branch: 'main',
      ...(sha ? { sha } : {}),
    }),
  });

  if (putRes.status === 409 && attempt < 2) {
    // Someone else committed between our GET and PUT — retry from a fresh sha.
    return appendRow(env, row, attempt + 1);
  }
  if (!putRes.ok) throw new Error(`PUT ${putRes.status}`);
}

/* ---------- helpers ---------- */
function clean(v) {
  return typeof v === 'string' ? v.trim().slice(0, 200) : '';
}
function csvCell(v) {
  // Escape per RFC 4180; neutralize spreadsheet formula injection.
  let s = String(v);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim());
  const ok = allowed.includes(origin) || allowed.includes('*');
  return {
    'Access-Control-Allow-Origin': ok ? origin : allowed[0] || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}
function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}
function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
