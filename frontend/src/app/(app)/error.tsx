"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";
import { useT } from "@/lib/i18n/client";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const t = useT();
  return (
    <div className="grid min-h-dvh place-items-center bg-[var(--bg)] p-6">
      <div className="w-full max-w-[440px] flex flex-col gap-4">
        <ErrorState error={error} />
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => reset()}>
            {t("common.tryAgain")}
          </Button>
          <Button variant="secondary" onClick={() => router.push("/login")}>
            {t("pages.backToSignIn")}
          </Button>
        </div>
      </div>
    </div>
  );
}
