"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  return (
    <div className="grid min-h-dvh place-items-center bg-[var(--bg)] p-6">
      <div className="w-full max-w-[440px] flex flex-col gap-4">
        <ErrorState error={error} />
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => reset()}>
            Try again
          </Button>
          <Button variant="secondary" onClick={() => router.push("/login")}>
            Back to sign in
          </Button>
        </div>
      </div>
    </div>
  );
}
