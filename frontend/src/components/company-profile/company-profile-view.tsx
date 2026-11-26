"use client";

import * as React from "react";
import { toast } from "sonner";
import type { z } from "zod";

import { useSession } from "@/components/session-provider";
import { Button } from "@/components/ui/button";
import { LocalDate } from "@/components/ui/local-date";
import { PageHeader } from "@/components/ui/page-header";
import { Panel, PanelBody, PanelHead } from "@/components/ui/panel";
import { Banner, ErrorState, LoadingState } from "@/components/ui/states";
import { isApiError } from "@/lib/api/errors";
import {
  companyProfileInput,
  companyProfileToForm,
  type CompanyProfile,
  type CompanyProfileForm,
} from "@/lib/api/schemas/company-profile";
import { canShowAction } from "@/lib/auth/permissions";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
import { formMessageText } from "@/lib/master-data-copy";
import { useCompanyProfile, useUpdateCompanyProfile } from "@/lib/query/company-profile";

/**
 * F0b: the seller's company profile. Admins edit it; other roles see it read
 * only. It is printed on quotations, invoices and receipts in later phases.
 * VAT is OFF by default: the business is not VAT-registered (Owner, 26 Nov).
 */

const inputCls =
  "min-h-11 w-full rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[13px] outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--focus)] disabled:opacity-70";

type TextKey = Exclude<keyof CompanyProfileForm, "vat_registered" | "prices_include_vat">;

interface TextField {
  name: TextKey;
  label: MessageKey;
  kind?: "textarea" | "email" | "tel";
  hint?: MessageKey;
  numeric?: boolean;
}

const SELLER_FIELDS: TextField[] = [
  { name: "legal_name_th", label: "finance.legalNameTh" },
  { name: "legal_name_en", label: "finance.legalNameEn" },
  { name: "tax_id", label: "finance.taxId", hint: "finance.taxIdHint", numeric: true },
  { name: "branch_code", label: "finance.branchCode", hint: "finance.branchCodeHint", numeric: true },
  { name: "address_th", label: "finance.addressTh", kind: "textarea" },
  { name: "address_en", label: "finance.addressEn", kind: "textarea" },
  { name: "phone", label: "masterData.phone", kind: "tel" },
  { name: "email", label: "masterData.email", kind: "email" },
];

function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !out[key]) out[key] = issue.message;
  }
  return out;
}

function ProfileForm({ profile, canEdit }: { profile: CompanyProfile; canEdit: boolean }) {
  const t = useT();
  const update = useUpdateCompanyProfile();
  const [values, setValues] = React.useState<CompanyProfileForm>(() => companyProfileToForm(profile));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<{ message: string; requestId?: string } | null>(null);

  const set = <K extends keyof CompanyProfileForm>(name: K, v: CompanyProfileForm[K]) => {
    setValues((s) => ({ ...s, [name]: v }));
    setErrors((e) => (e[name] ? { ...e, [name]: "" } : e));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = companyProfileInput.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    try {
      await update.mutateAsync(parsed.data);
      toast.success(t("finance.profileSaved"));
    } catch (error) {
      if (isApiError(error) && error.kind === "validation" && error.details.length) {
        const fieldErrs: Record<string, string> = {};
        for (const d of error.details) if (d.field) fieldErrs[d.field] = d.message;
        setErrors((prev) => ({ ...prev, ...fieldErrs }));
        if (Object.keys(fieldErrs).length) return;
      }
      setFormError({
        message: isApiError(error) ? error.userMessage : t("common.somethingWrong"),
        requestId: isApiError(error) ? error.requestId : undefined,
      });
    }
  };

  const renderText = (f: TextField) => {
    const id = `company-${f.name}`;
    const value = String(values[f.name] ?? "");
    return (
      <label key={f.name} className="flex flex-col gap-1" htmlFor={id}>
        <span className="text-[12px] font-semibold text-[var(--muted)]">{t(f.label)}</span>
        {f.kind === "textarea" ? (
          <textarea
            id={id}
            className={`${inputCls} min-h-[76px] py-2`}
            disabled={!canEdit}
            value={value}
            onChange={(e) => set(f.name, e.currentTarget.value)}
          />
        ) : (
          <input
            id={id}
            type={f.kind ?? "text"}
            inputMode={f.numeric ? "numeric" : undefined}
            autoComplete="off"
            className={inputCls}
            disabled={!canEdit}
            value={value}
            onChange={(e) => set(f.name, e.currentTarget.value)}
          />
        )}
        {f.hint && !errors[f.name] ? <span className="text-[11px] text-[var(--faint)]">{t(f.hint)}</span> : null}
        {errors[f.name] ? (
          <span className="text-[11px] text-[var(--danger)]">{formMessageText(t, errors[f.name])}</span>
        ) : null}
      </label>
    );
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <Panel>
        <PanelHead title={t("finance.sellerSection")} />
        <PanelBody className="grid gap-4 md:grid-cols-2">{SELLER_FIELDS.map(renderText)}</PanelBody>
      </Panel>

      <Panel>
        <PanelHead title={t("finance.vatSection")} />
        <PanelBody className="flex flex-col gap-4">
          <label className="flex items-start gap-2 text-[13px]" htmlFor="company-vat_registered">
            <input
              id="company-vat_registered"
              type="checkbox"
              className="mt-[3px]"
              disabled={!canEdit}
              checked={values.vat_registered}
              onChange={(e) => set("vat_registered", e.currentTarget.checked)}
            />
            <span>
              <span className="font-semibold">{t("finance.vatRegistered")}</span>
              <span className="block text-[11px] text-[var(--faint)]">{t("finance.vatRegisteredHint")}</span>
            </span>
          </label>

          {values.vat_registered ? (
            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-1" htmlFor="company-vat_rate">
                <span className="text-[12px] font-semibold text-[var(--muted)]">{t("finance.vatRate")}</span>
                <input
                  id="company-vat_rate"
                  inputMode="decimal"
                  autoComplete="off"
                  className={inputCls}
                  disabled={!canEdit}
                  value={values.vat_rate}
                  onChange={(e) => set("vat_rate", e.currentTarget.value)}
                />
                {errors.vat_rate ? (
                  <span className="text-[11px] text-[var(--danger)]">{formMessageText(t, errors.vat_rate)}</span>
                ) : null}
              </label>
              <label className="flex items-start gap-2 self-end text-[13px]" htmlFor="company-prices_include_vat">
                <input
                  id="company-prices_include_vat"
                  type="checkbox"
                  className="mt-[3px]"
                  disabled={!canEdit}
                  checked={values.prices_include_vat}
                  onChange={(e) => set("prices_include_vat", e.currentTarget.checked)}
                />
                <span>
                  <span className="font-semibold">{t("finance.pricesIncludeVat")}</span>
                  <span className="block text-[11px] text-[var(--faint)]">{t("finance.pricesIncludeVatHint")}</span>
                </span>
              </label>
            </div>
          ) : (
            <p className="text-[12px] text-[var(--muted)]">{t("finance.vatOffNote")}</p>
          )}
        </PanelBody>
      </Panel>

      {formError ? (
        <p role="alert" className="rounded-[var(--r-sm)] bg-[var(--danger-subtle)] p-2 text-[12px] text-[var(--danger)]">
          {formError.message}
          {formError.requestId ? (
            <span className="mt-1 block text-[11px] text-[var(--muted)]">
              {t("common.requestId")} <span className="mono select-all">{formError.requestId}</span>
            </span>
          ) : null}
        </p>
      ) : null}

      {canEdit ? (
        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={update.isPending}>
            {update.isPending ? t("masterData.saving") : t("masterData.saveChanges")}
          </Button>
        </div>
      ) : null}
    </form>
  );
}

export function CompanyProfileView() {
  const t = useT();
  const { user } = useSession();
  const canEdit = canShowAction(user.role, "company-profile:write");
  const { data, isLoading, isError, error, refetch } = useCompanyProfile();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("finance.profileTitle")}
        subtitle={
          data?.updated_at ? (
            <>
              {t("finance.profileUpdated")} <LocalDate iso={data.updated_at} />
            </>
          ) : (
            t("finance.profileSubtitle")
          )
        }
      />
      {!canEdit ? <Banner tone="info" title={t("finance.readOnly")} /> : null}
      {isLoading ? <LoadingState label={t("pages.loadingCompanyProfile")} /> : null}
      {isError ? <ErrorState error={error} onRetry={() => void refetch()} /> : null}
      {data ? (
        // keyed on updated_at so a fresh server copy resets the form
        <ProfileForm key={data.updated_at ?? "new"} profile={data} canEdit={canEdit} />
      ) : null}
    </div>
  );
}
