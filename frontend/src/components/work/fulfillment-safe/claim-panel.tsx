"use client";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import type { FulfillmentCoordinator, WorkflowView } from "@/lib/fulfillment/coordinator";
import { copy, type Locale } from "./copy";
import type { RunWork } from "./use-fulfillment";
export function ClaimPanel({coordinator,view,locale,run}:{coordinator:FulfillmentCoordinator;view:WorkflowView;locale:Locale;run:RunWork}) {
  const t=copy(locale);const [reason,setReason]=useState("");const [confirmed,setConfirmed]=useState(false);
  const c=view.context;
  if(!c)return null;
  const paused=view.status==="PAUSED";
  const blocked= !paused && view.status!=="READY";
  const takeover=()=>coordinator.lifecycle({kind:"TAKEOVER",phase:c.phase,expectedEpoch:c.epoch,progressRevision:c.progressRevision,reason,confirmed});
  return <section aria-label={t.holder}><p>{t.holder}: {c.holder??t.holderNone} — {t.phase}: {t.phases[c.phase]} — {t.epoch}: {c.epoch}</p><p>{t.tokenPolicy}</p>
    <Button disabled={blocked||c.holder!==null} onClick={()=>run(()=>coordinator.lifecycle({kind:"ACQUIRE",phase:c.phase,expectedEpoch:c.epoch,progressRevision:c.progressRevision}))}>{t.acquire}</Button>
    <Button disabled={!view.credentialAvailable||blocked} onClick={()=>run(()=>coordinator.validate())}>{t.validate}</Button>
    <label>{t.reason}<input value={reason} maxLength={200} onChange={e=>setReason(e.target.value)}/></label>
    <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{t.confirmTakeover}</label>
    <Button disabled={blocked||!confirmed||!reason.trim()||(c.holder!==null&&c.holder!==coordinator.scope.actor&&coordinator.role!=="admin")} onClick={()=>run(takeover)}>{t.takeover}</Button>
  </section>;
}
