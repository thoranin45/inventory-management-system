"use client";
import { Button } from "@/components/ui/button";
import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { quantity, type Context, type LifecyclePayload } from "@/lib/fulfillment/contracts";
import { validateRelease } from "@/lib/fulfillment/coordinator";
import { copy, type Locale } from "./copy";
import type { ReleaseSubmit } from "./use-fulfillment";
export function ReleaseDialog({context,locale,onSubmit,onClose}:{context:Context;locale:Locale;onSubmit:ReleaseSubmit;onClose:()=>void}) {
  const t=copy(locale);const [mode,setMode]=useState<"VERIFIED"|"UNVERIFIED">("VERIFIED");
  const [counts,setCounts]=useState<Record<number,{picked:string;packed:string}>>({});const [attested,setAttested]=useState(false);const [reason,setReason]=useState("");const [review,setReview]=useState<LifecyclePayload>();const [busy,setBusy]=useState(false);const [error,setError]=useState(false);
  const prepare=()=>{
    try {
      const payload:LifecyclePayload={kind:"RELEASE",phase:context.phase,expectedEpoch:context.epoch,progressRevision:context.progressRevision,mode,...(mode==="VERIFIED"?{confirmed:attested,counts:context.allocations.map(a=>({allocation_id:a.id,picked:quantity(counts[a.id]?.picked,true),packed:quantity(counts[a.id]?.packed,true)}))}:{reason})};
      validateRelease(payload,context);setReview(payload);setError(false);
    }catch{setError(true);}
  };
  return <Dialog.Root open onOpenChange={open=>{if(!open&&!busy)onClose();}}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 bg-black/40"/><Dialog.Content className="fixed left-1/2 top-1/2 max-h-[90dvh] w-[min(440px,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-lg border bg-[var(--surface)] p-4 text-[var(--foreground)]"><Dialog.Title>{t.release}</Dialog.Title><Dialog.Description>{t.releaseUnknown}</Dialog.Description><fieldset disabled={busy||!!review}>
    <label><input type="radio" name="release-mode" checked={mode==="VERIFIED"} onChange={()=>setMode("VERIFIED")}/>{t.verified}</label><label><input type="radio" name="release-mode" checked={mode==="UNVERIFIED"} onChange={()=>setMode("UNVERIFIED")}/>{t.unverified}</label>
    {mode==="VERIFIED"?<><div>{context.allocations.map(a=><fieldset key={a.id}><legend>{t.allocation} {a.id} — {t.expected}: {a.picked} / {a.packed}</legend>{(["picked","packed"] as const).map(kind=><label key={kind}>{t[kind]} {a.id}<input inputMode="decimal" value={counts[a.id]?.[kind]??""} onChange={e=>{setCounts({...counts,[a.id]:{picked:counts[a.id]?.picked??"",packed:counts[a.id]?.packed??"",[kind]:e.target.value}});setAttested(false);}}/></label>)}</fieldset>)}</div><label><input type="checkbox" checked={attested} onChange={e=>setAttested(e.target.checked)}/>{t.attest}</label></>:<><p>{t.unverifiedWarning}</p><label>{t.reason}<textarea value={reason} maxLength={200} onChange={e=>setReason(e.target.value)}/></label></>}
    <Button onClick={prepare}>{t.review}</Button></fieldset>
    {review&&<><h3>{t.reviewTitle}</h3>{review.counts?<table><thead><tr><th scope="col">{t.allocation}</th><th scope="col">{t.picked}</th><th scope="col">{t.packed}</th></tr></thead><tbody>{review.counts.map(c=><tr key={c.allocation_id}><td>{c.allocation_id}</td><td>{c.picked}</td><td>{c.packed}</td></tr>)}</tbody></table>:<p>{t.reason}: {review.reason}</p>}<p>{mode==="VERIFIED"?t.attest:t.unverifiedWarning}</p><Button disabled={busy} onClick={()=>{setBusy(true);void onSubmit(review).then(onClose).catch(()=>{setError(true);setBusy(false);});}}>{mode==="VERIFIED"?t.confirm:t.confirmUnverified}</Button></>}
    {error&&<p role="alert">{t.invalid} {t.releaseUnknown}</p>}<Button disabled={busy} onClick={onClose}>{t.cancel}</Button>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
