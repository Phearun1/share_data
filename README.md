# Send a file — one-time share links

A tiny web app to transfer a file between devices:

1. Open the app, **upload a file** (up to **4 MB**).
2. It gives you a **share link** (e.g. `https://your-site.netlify.app/f/abc123`). Copy it.
3. Send the link to anyone. They open it and click **Download**.
4. The file is **deleted after the first download** — the link only works once.

Built with Next.js. Storage uses **Netlify Blobs** in production and falls back to
local disk for development, so it runs the same way in both.

> **Why 4 MB?** On Netlify's free plan the file passes through a serverless
> function, whose request payload is capped (~4.5 MB for binary). This app caps
> uploads at 4 MB for headroom. For larger files you'd need direct-to-storage
> uploads (e.g. Cloudflare R2) — ask if you want that.

## Deploy to Netlify (free)

Netlify hosts Next.js with **zero configuration**, and **Netlify Blobs** (the file
store) is included on the free plan — no separate account or API keys.

1. Put this project in a Git repo (GitHub/GitLab/Bitbucket):

   ```bash
   cd share-web
   git init && git add -A && git commit -m "Send a file"
   # create a repo on GitHub, then:
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```

2. Go to <https://app.netlify.com> → **Add new site → Import an existing project**.
3. Pick your repo. Netlify auto-detects Next.js — leave the build settings as they
   are (build command `next build`) and click **Deploy**.
4. When it finishes you get a URL like `https://<name>.netlify.app`. Open it,
   upload a file, and share the link.

That's the whole thing — no env vars, no config files. (You can rename the site or
add a custom domain later in the Netlify dashboard.)

### Deploy from the terminal instead (optional)

```bash
npm i -g netlify-cli
netlify deploy --build --prod
```

## Run locally

```bash
cd share-web
npm install
npm run dev        # http://localhost:3000
```

Locally there is no Netlify Blobs environment, so uploads are stored in a local
`storage/` folder (git-ignored) instead. Everything else behaves the same.

To exercise the **real** Netlify Blobs store locally, use the Netlify CLI:

```bash
npm i -g netlify-cli
netlify dev        # provides a sandboxed Blobs store
```

## How it works

- `app/api/upload/route.ts` — receives the file, enforces the 4 MB cap, and stores
  it with `saveUpload()`.
- `app/f/[id]/page.tsx` — the page a recipient opens: shows the file name/size and
  a Download button. Opening this page does **not** consume the link.
- `app/api/download/[id]/route.ts` — a `POST` handler that reads the file and
  deletes it in one step (so it downloads exactly once). It's a POST, not a link,
  so chat/email link scanners can't accidentally burn the one-time download.
- `lib/storage.ts` — Netlify Blobs backend with a local-disk fallback.
- `lib/limits.ts` — the shared 4 MB size cap (used by both the browser and server).

## Notes & limits

- **4 MB per file** (see above). Oversized uploads are rejected before they start.
- **One-time links:** the file is removed on first download; the link then shows
  "Link expired".
- **No authentication** by design: the random link id is the secret.
- **Netlify Blobs free tier** covers personal use; heavy usage may exceed free
  limits (see Netlify's pricing).
# share_data
