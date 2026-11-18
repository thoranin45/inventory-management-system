import { copy, type Locale } from "./copy";
import type { Reconciliation } from "@/lib/fulfillment/contracts";
export function ReconciliationStatus({status,locale}:{status:Reconciliation;locale:Locale}) {
  const t=copy(locale);
  const text=status==="REQUIRED"?t.required:status==="CORRECTION_IN_PROGRESS"?t.correction:status==="ESCALATED"?t.escalated:status==="CLEAR"?t.clear:t.resolved;
  return <section aria-label={t.reconcile} role="status"><strong>{t.reconciliation[status]}</strong> <code title={t.reference}>{status}</code><p>{text}</p></section>;
}
