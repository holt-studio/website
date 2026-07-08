# RFQ form backend — deploy guide

The website is static (GitHub Pages), so the contact form posts to this small
Cloudflare Worker. The Worker holds a GitHub token as a **secret** and appends
each submission as one row to `submissions.csv` in a **private** repo.

```
Browser form ──POST JSON──▶ Cloudflare Worker ──GitHub API──▶ rfq-submissions/submissions.csv (PRIVATE)
```

## One-time setup (~15 min)

### 1. Create the private submissions repo
On GitHub: **New repository** → owner `holt-studio`, name `rfq-submissions`,
visibility **Private** → Create. Leave it empty (the Worker creates the CSV with
a header on the first submission).

### 2. Create a token scoped to that repo
https://github.com/settings/tokens?type=beta → **Generate new token**
- Resource owner: `holt-studio`
- Repository access → **Only select repositories** → `rfq-submissions`
- Permissions → **Contents: Read and write**
- Generate, copy the `github_pat_…` value.

### 3. Deploy the Worker
```bash
npm install -g wrangler          # if not already installed
cd "worker"
wrangler login                   # opens browser, approve
wrangler secret put GH_TOKEN     # paste the token from step 2
wrangler deploy
```
`wrangler deploy` prints a URL like `https://holt-studio-rfq.<you>.workers.dev`.

### 4. Wire the site to the Worker
Put that URL into `js/main.js`:
```js
const RFQ_ENDPOINT = 'https://holt-studio-rfq.<you>.workers.dev';
```
Then commit + push:
```bash
git add js/main.js && git commit -m "Wire RFQ form to Worker" && git push
```

## Config (`wrangler.toml`)
- `GH_OWNER`, `GH_REPO`, `GH_FILE` — where the CSV lives.
- `ALLOWED_ORIGINS` — comma-separated origins allowed to POST. Add your custom
  domain here when you add one (e.g. `https://holt-studio.github.io,https://holtstudio.com`).

## Notes
- **Spam:** a hidden honeypot field silently drops bots. Add Cloudflare Turnstile
  later if spam appears.
- **Concurrency:** simultaneous submissions retry on sha conflict (fine for RFQ volume).
- **CSV safety:** cells are RFC-4180 escaped and formula-injection–neutralized, so
  the file is safe to open in Excel/Sheets.
