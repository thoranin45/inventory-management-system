import { BrandMark } from "@/components/shell/brand-mark";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const reason = typeof sp.reason === "string" ? sp.reason : undefined;
  const next = typeof sp.next === "string" ? sp.next : "/dashboard";

  return (
    <main className="grid min-h-dvh place-items-center bg-[var(--bg)] p-6">
      <div className="w-full max-w-[380px]">
        <div className="mb-6">
          <BrandMark variant="full" className="[&_span:last-child]:text-[16px]" />
        </div>

        <div className="wc-panel p-6">
          <h1 className="text-[18px] font-semibold">Sign in</h1>
          <p className="mt-1 text-[12.5px] text-[var(--muted)]">
            Use your account. Sessions are held in a secure server-side cookie.
          </p>

          {reason === "expired" ? (
            <p
              role="status"
              className="mt-3 rounded-[var(--r-sm)] border border-[color-mix(in_srgb,var(--warning)_32%,transparent)] bg-[var(--warning-subtle)] px-3 py-2 text-[12px] text-[var(--warning)]"
            >
              Your session expired. Please sign in again.
            </p>
          ) : null}

          <LoginForm next={next} />
        </div>
      </div>
    </main>
  );
}
