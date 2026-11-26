"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { bffJson } from "@/lib/api/browser";
import {
  companyProfileEnvelope,
  type CompanyProfile,
  type CompanyProfileInput,
} from "@/lib/api/schemas/company-profile";
import { queryKeys } from "./keys";

const RETRY_ONCE_NOT_AUTH = (failureCount: number, error: unknown) => {
  const kind = (error as { kind?: string })?.kind;
  if (kind === "unauthorized" || kind === "forbidden" || kind === "validation" || kind === "conflict") return false;
  return failureCount < 1;
};

/** F0b: the seller's company profile (defaults with VAT off until first saved). */
export function useCompanyProfile() {
  return useQuery<CompanyProfile>({
    queryKey: queryKeys.companyProfile,
    queryFn: async ({ signal }) => {
      const env = await bffJson("/api/bff/company-profile", companyProfileEnvelope, { signal });
      return env.data;
    },
    staleTime: 60_000,
    retry: RETRY_ONCE_NOT_AUTH,
  });
}

/** Full replacement (PUT). Admin only; the backend writes an audit row. */
export function useUpdateCompanyProfile() {
  const qc = useQueryClient();
  return useMutation<CompanyProfile, unknown, CompanyProfileInput>({
    mutationFn: async (json) => {
      const env = await bffJson("/api/bff/company-profile", companyProfileEnvelope, { method: "PUT", json });
      return env.data;
    },
    retry: false,
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.companyProfile, data);
      void qc.invalidateQueries({ queryKey: queryKeys.audit.all });
    },
  });
}
