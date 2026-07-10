import Link from "next/link";

import { formatBytes } from "@/lib/format";
import { getUploadMeta } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DownloadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const meta = await getUploadMeta(id);

  if (!meta) {
    return (
      <main className="page">
        <section className="card">
          <div className="icon icon-muted" aria-hidden>
            ∅
          </div>
          <h1 className="title">Link expired</h1>
          <p className="subtitle">
            This file was already downloaded or the link is invalid. One-time
            links work only once.
          </p>
          <Link className="btn" href="/">
            Send a file
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <section className="card">
        <div className="icon" aria-hidden>
          ↓
        </div>
        <h1 className="title">A file was shared with you</h1>
        <div className="file-row">
          <span className="file-name" title={meta.name}>
            {meta.name}
          </span>
          <span className="file-size">{formatBytes(meta.size)}</span>
        </div>
        {/* POST (not a link) so link scanners / prefetchers can't consume the
            one-time download; the browser still streams the file inline. */}
        <form method="post" action={`/api/download/${id}`}>
          <button className="btn btn-primary btn-block" type="submit">
            Download
          </button>
        </form>
        <p className="hint">
          Heads up: this is a one-time link. Once you download it, the file is
          removed and the link stops working.
        </p>
      </section>
    </main>
  );
}
