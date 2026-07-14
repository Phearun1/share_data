# Send a file — one-time share links

A tiny web app to transfer a file between devices:

1. Open the app, **upload a file** (up to **50 MB**).
2. It gives you a **share link** (e.g. `https://your-site.netlify.app/f/abc123`). Copy it.
3. Send the link to anyone. They open it and click **Download**.
4. The file is **deleted after the first download** — the link only works once.

Built with Next.js, hosted free on **Netlify**, with files stored in **Supabase
Storage**. The file uploads directly from the browser to Supabase (via a one-time
signed URL), so it never passes through Netlify's small serverless limit — that's
how you get 50 MB instead of ~4 MB.

## One-time setup

### 1. Create a Supabase project (free, no credit card)

1. Sign up at <https://supabase.com> and create a **New project** (any name/region).
2. In the project sidebar go to **Storage → New bucket**:
   - Name it **`upload`**
   - Keep **Public** turned **OFF** (private bucket — files are only reachable
     through the temporary links this app creates).
3. Go to **Project Settings → API** and copy three values:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role** key (secret) → `SUPABASE_SERVICE_ROLE_KEY`

### 2. Add those values to Netlify

In your Netlify site: **Site configuration → Environment variables → Add a
variable**, and add all three (plus optionally `SUPABASE_BUCKET=upload`). Then
**redeploy** (Deploys → Trigger deploy → Deploy site) so the new values take
effect — `NEXT_PUBLIC_*` values are baked in at build time.

That's it. Open your `.netlify.app` URL, upload a file, and share the link.

> **File size:** 50 MB is Supabase's free-tier per-file limit; total free storage
> is 1 GB. Downloaded/old files are auto-removed daily (see below), so space is
> reclaimed automatically.

## How it works

- **Upload:** the browser asks `POST /api/create-upload` for a one-time signed
  upload URL, then uploads the file **directly to Supabase** — the bytes never go
  through Netlify, so the 4 MB function limit doesn't apply.
- **Landing page** (`app/f/[id]`): shows the file name/size and a Download button.
  Opening it does **not** consume the link.
- **Download** (`POST /api/download/[id]`): mints a short-lived signed URL and
  `302`-redirects the browser straight to Supabase, then deletes the metadata so
  the link is one-time. It's a POST (not a link) so chat/email scanners can't burn
  the link.
- **Cleanup** (`netlify/functions/cleanup.mts`): a free daily scheduled function
  that deletes Supabase objects older than 24h.
- `lib/storage.ts` keeps tiny metadata records in Netlify Blobs (with a local-disk
  fallback for dev). `lib/supabase.ts` holds the server-side Supabase helpers.

## Local mode — send files on the same network (no internet)

Use this when the cloud version is **blocked** by someone's network (office/school
Wi‑Fi and work laptops often block uploads to outside services). Local mode runs
the app **on your Mac**; the other person connects over the **same Wi‑Fi**, and the
file uploads straight to your Mac — nothing goes to the internet, so nothing gets
blocked. Files up to **2 GB**.

1. On your Mac, in this folder:

   ```bash
   npm install        # first time only
   npm run local      # starts the app on your network
   ```

2. Find your Mac's Wi‑Fi IP address:

   ```bash
   ipconfig getifaddr en0
   ```

   (e.g. `192.168.1.24`. If that's blank, try `en1`.)

3. Make sure **both devices are on the same Wi‑Fi**. The other person opens
   **`http://<your-ip>:3000`** in their browser (e.g. `http://192.168.1.24:3000`).

4. They upload a file → get a link → share it → download. All on the local network.

Notes:
- Keep the Terminal running `npm run local` open — closing it stops the app.
- macOS may ask to **allow incoming connections** the first time — click Allow.
- Files are saved in `share-web/storage/` on your Mac and deleted after download.

## Run locally (development)

```bash
cd share-web
npm install
npm run dev                           # http://localhost:3000 (local mode)
```

For the cloud (Supabase) flow locally, copy `.env.local.example` to `.env.local`,
fill in your Supabase values, and use `npm run dev`.

## Notes & limits

- **50 MB per file**, **1 GB** total free storage.
- **One-time links:** removed on first download; the link then shows "Link expired".
- **No authentication** by design: the random link id is the secret.
- **Free tier caveat:** Supabase pauses a project after ~7 days with no activity;
  if that happens, open the Supabase dashboard and resume it.
