"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import { loginInputSchema, type LoginInput } from "@/lib/api/schemas/auth";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

const fieldClass =
  "h-[38px] w-full rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-[10px] text-[14px] text-[var(--foreground)] outline-hidden transition-colors focus-visible:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--focus)]";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const t = useT();
  const [serverError, setServerError] = React.useState<{ message: string; requestId?: string } | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginInputSchema),
    defaultValues: { username: "", password: "" },
  });

  async function onSubmit(values: LoginInput) {
    setServerError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values),
    });
    const body = (await res.json().catch(() => ({}))) as {
      message?: string;
      request_id?: string;
    };
    if (!res.ok) {
      setServerError({
        // backend wording is shown as sent (server messages are not translated in R2)
        message: body.message ?? t("auth.signInFailed"),
        requestId: body.request_id,
      });
      return;
    }
    const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
    router.replace(safeNext);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="mt-5 flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-[5px]">
        <label htmlFor="username" className="text-[12px] font-medium">
          {t("auth.username")}
        </label>
        <input
          id="username"
          autoComplete="username"
          autoFocus
          aria-invalid={!!errors.username}
          className={cn(fieldClass, errors.username && "border-[var(--danger)]")}
          {...register("username")}
        />
        {errors.username ? (
          <span className="text-[11.5px] text-[var(--danger)]">{t("auth.usernameRequired")}</span>
        ) : null}
      </div>

      <div className="flex flex-col gap-[5px]">
        <label htmlFor="password" className="text-[12px] font-medium">
          {t("auth.password")}
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={!!errors.password}
          className={cn(fieldClass, errors.password && "border-[var(--danger)]")}
          {...register("password")}
        />
        {errors.password ? (
          <span className="text-[11.5px] text-[var(--danger)]">{t("auth.passwordRequired")}</span>
        ) : null}
      </div>

      {serverError ? (
        <div
          role="alert"
          className="flex flex-col gap-1 rounded-[var(--r-sm)] border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-[var(--danger-subtle)] px-3 py-2 text-[12px] text-[var(--danger)]"
        >
          <span>{serverError.message}</span>
          {serverError.requestId ? (
            <span className="text-[11px] text-[var(--muted)]">
              {t("common.requestId")} <span className="mono select-all">{serverError.requestId}</span>
            </span>
          ) : null}
        </div>
      ) : null}

      <Button type="submit" variant="primary" size="lg" disabled={isSubmitting} className="w-full">
        {isSubmitting ? t("auth.signingIn") : t("auth.signIn")}
      </Button>
    </form>
  );
}
