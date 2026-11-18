"use client";
import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState } from "react";
import type { FulfillmentCoordinator } from "@/lib/fulfillment/coordinator";
import { quantity } from "@/lib/fulfillment/contracts";
import { useFulfillment, type RunWork } from "./use-fulfillment";
import { ClaimPanel } from "./claim-panel";
import { RecoveryPanel } from "./recovery-panel";
import { ReleaseDialog } from "./release-dialog";
import { ReconciliationStatus } from "./reconciliation-status";
import { copy, type Locale } from "./copy";

export function SafeWorkflowPanel({coordinator,locale="en",theme="light"}:{coordinator:FulfillmentCoordinator;locale?:Locale;theme?:"light"|"dark"}) {
  const t=copy(locale);const view=useFulfillment(coordinator);const [barcode,setBarcode]=useState("");const [amount,setAmount]=useState("1.000");const [allocation,setAllocation]=useState("");const [newPhysical,setNewPhysical]=useState(false);const [release,setRelease]=useState(false);const [error,setError]=useState(false);const [online,setOnline]=useState(()=>typeof navigator!=="undefined"&&navigator.onLine);const synchronous=useRef(false);
  useEffect(()=>{const update=()=>setOnline(navigator.onLine);window.addEventListener("online",update);window.addEventListener("offline",update);return()=>{window.removeEventListener("online",update);window.removeEventListener("offline",update);};},[]);
  const run:RunWork=work=>{
    if(synchronous.current||!online)return;
    synchronous.current=true;setError(false);
    void work().catch(()=>setError(true)).finally(()=>{synchronous.current=false;});
  };
  const submit=(undo=false)=>{
    const c=view.context;if(!c||view.status!=="READY"||!newPhysical)return;
    run(async()=>{
      const q=quantity(amount);
      if(allocation&&!/^[1-9]\d{0,8}$/.test(allocation))throw new Error("INVALID_ALLOCATION");
      setNewPhysical(false);
      await coordinator.submit({operation:undo?(c.phase==="PICK"?"UNDO_PICK":"UNDO_PACK"):(c.phase==="PICK"?"SCAN_PICK":"SCAN_PACK"),phase:c.phase,epoch:c.epoch,quantity:q,...(!undo?{barcode}:{}),...(allocation?{allocation_id:parseInt(allocation,10)}:{})});
      setBarcode("");
    });
  };
  const status=view.status==="READY"?t.ready:view.status==="PAUSED"?t.paused:view.status==="BUSY"?t.busy:view.status==="OUTCOME_UNKNOWN"?t.unknown:view.status==="INITIALIZATION_REQUIRED"?t.statusInitialization:view.status==="RECONCILIATION_REQUIRED"?t.statusReconciliation:view.status==="SIGNED_OUT"?t.statusSignedOut:t.blocked;
  return <main className={`${theme==="dark"?"dark":""} mx-auto grid max-w-5xl gap-4 bg-background p-4 text-foreground md:grid-cols-2`} data-theme={theme} lang={locale}>
    <header className="md:col-span-2"><strong>{t.simulation}</strong><h1>{t.title}</h1><p>{t.actor}: {coordinator.scope.actor}</p><p role="status" aria-live="polite">{online?status:t.offline}</p>{error&&<p role="alert">{t.actionError}</p>}</header>
    {view.status==="INITIALIZATION_REQUIRED"?<Button onClick={()=>run(()=>coordinator.initialize())}>{t.initialize}</Button>:view.status!=="SIGNED_OUT"&&<>
      <ClaimPanel coordinator={coordinator} view={view} locale={locale} run={run}/>
      <section><fieldset disabled={!online||view.status!=="READY"}><label>{t.barcode}<input autoComplete="off" value={barcode} onChange={e=>setBarcode(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();if(!e.repeat)submit();}}}/></label><label>{t.quantity}<input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)}/></label><label>{t.allocation}<input inputMode="numeric" value={allocation} onChange={e=>setAllocation(e.target.value)}/></label><p>{t.allocationHint}</p><label><input type="checkbox" checked={newPhysical} onChange={e=>setNewPhysical(e.target.checked)}/>{t.confirmNew}</label><Button disabled={!newPhysical} onClick={()=>submit()}>{t.scan}</Button><Button disabled={!newPhysical||!allocation} onClick={()=>submit(true)}>{t.undo}</Button><Button onClick={()=>setRelease(true)}>{t.release}</Button><Button onClick={()=>run(()=>coordinator.lifecycle({kind:"COMPLETE",phase:view.context!.phase,expectedEpoch:view.context!.epoch,progressRevision:view.context!.progressRevision}))}>{t.complete}</Button></fieldset></section>
      <RecoveryPanel coordinator={coordinator} view={view} locale={locale} run={run}/>
      {view.context&&<ReconciliationStatus status={view.context.reconciliation} locale={locale}/>}
      {release&&view.context&&<ReleaseDialog context={view.context} locale={locale} onClose={()=>setRelease(false)} onSubmit={p=>coordinator.lifecycle(p)}/>}
    </>}
    <Button onClick={()=>coordinator.logout()}>{t.logout}</Button>
  </main>;
}
