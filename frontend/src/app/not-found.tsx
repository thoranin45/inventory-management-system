import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-[var(--bg)] p-6 text-center">
      <div>
        <p className="wc-section-label">404</p>
        <h1 className="mt-1 text-[20px] font-semibold">Page not found</h1>
        <p className="mt-1 text-[13px] text-[var(--muted)]">That route does not exist.</p>
        <Link
          href="/dashboard"
          className="mt-4 inline-flex h-[34px] items-center rounded-[var(--r-sm)] bg-[var(--primary)] px-4 text-[13px] font-semibold text-[var(--primary-fg)]"
        >
          Go to dashboard
        </Link>
      </div>
    </main>
  );
}
