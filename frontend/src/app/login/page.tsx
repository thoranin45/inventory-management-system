import { BrandMark } from "@/components/shell/brand-mark";
import { LanguageSwitch } from "@/components/shell/language-switch";
import { LoginForm } from "./login-form";
import { LoginIntro } from "./login-intro";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const reason = typeof sp.reason === "string" ? sp.reason : undefined;
  const next = typeof sp.next === "string" ? sp.next : "/dashboard";

  return (
    <main className="grid min-h-dvh place-items-center bg-[var(--bg)] p-6">
      <div className="w-full max-w-[380px]">
        <div className="mb-6 flex items-center justify-between gap-3">
          <BrandMark variant="full" className="[&_span:last-child]:text-[16px]" />
          {/* D6: compact language switch, available before sign-in */}
          <LanguageSwitch />
        </div>

        <div className="wc-panel p-6">
          <LoginIntro expired={reason === "expired"} />
          <LoginForm next={next} />
        </div>
      </div>
    </main>
  );
}
