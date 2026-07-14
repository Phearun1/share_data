import Link from "next/link";

import { formatBytes } from "@/lib/format";
import { getMeta } from "@/lib/storage";
import { Logo } from "@/app/logo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DownloadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const meta = await getMeta(id);

  if (!meta) {
    return (
      <main className="page">
        <div className="shell">
          <header className="masthead">
            <Logo />
            <h1 className="title">Link expired</h1>
            <p className="eyebrow">
              <span className="dot" />
              One-time download
            </p>
          </header>
          <section className="card">
            <span className="state">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <circle cx="12" cy="12" r="9" />
                <path d="m8 8 8 8" />
              </svg>
            </span>
            <p className="hint">
              This file was already downloaded, or the link is invalid. One-time
              links only work once.
            </p>
            <Link className="btn btn-block" href="/">
              Send a file
            </Link>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="shell">
        <header className="masthead">
          <Logo />
          <h1 className="title">A file for you</h1>
          <p className="eyebrow">
            <span className="dot" />
            One-time download
          </p>
        </header>

        <section className="card">
          <div className="plate">
            <span className="plate-icon">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M14 3v4a1 1 0 0 0 1 1h4" />
                <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" />
              </svg>
            </span>
            <span className="plate-meta">
              <span className="file-name" title={meta.name}>
                {meta.name}
              </span>
              <span className="file-size">{formatBytes(meta.size)}</span>
            </span>
          </div>

          {/* POST (not a link) so scanners/prefetchers can't consume the link. */}
          <form method="post" action={`/api/download/${id}`}>
            <button className="btn btn-primary btn-block" type="submit">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M12 4v12" />
                <path d="m7 11 5 5 5-5" />
                <path d="M5 20h14" />
              </svg>
              Download
            </button>
          </form>

          <p className="hint">
            This link works once — the file is removed as soon as you download it.
          </p>
        </section>
      </div>
    </main>
  );
}
