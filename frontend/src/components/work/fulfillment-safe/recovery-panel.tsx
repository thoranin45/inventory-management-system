import { Button } from "@/components/ui/button";
import type { FulfillmentCoordinator, WorkflowView } from "@/lib/fulfillment/coordinator";
import { terminal } from "@/lib/fulfillment/attempt";
import { copy, type Locale } from "./copy";
import type { RunWork } from "./use-fulfillment";
export function RecoveryPanel({coordinator,view,locale,run}:{coordinator:FulfillmentCoordinator;view:WorkflowView;locale:Locale;run:RunWork}) {
  const t=copy(locale);const busy=view.status==="BUSY"||view.status==="SIGNED_OUT";
  return <section aria-label={t.recovery}><h2>{t.history}</h2>
    {view.attempts.map(a=><article key={a.key}><p><code>{a.key}</code> — {t.operations[a.payload.operation]} — {a.payload.quantity} — <strong>{t.states[a.state]}</strong> <code title={t.reference} data-state={a.state}>{a.state}</code>{a.evidence?.kind==="RECORDED"&&a.evidence.historical?<> — {t.historical}</>:null}</p>
      {!terminal(a.state)&&<><p>{t.unknown}</p><Button disabled={busy||!view.credentialAvailable||!["PERSISTED","OUTCOME_UNKNOWN"].includes(a.state)} onClick={()=>run(()=>coordinator.retry(a.key))}>{t.retry}</Button><Button disabled={busy||!["SENDING","OUTCOME_UNKNOWN","CONFLICT"].includes(a.state)} onClick={()=>run(()=>coordinator.recover(a.key))}>{t.recover}</Button></>}
    </article>)}
    {view.lifecyclePending&&<><p>{t.lifecycleUnknown}</p><Button disabled={busy} onClick={()=>run(()=>coordinator.recoverLifecycle())}>{t.recoverLifecycle}</Button></>}
    <Button disabled={busy} onClick={()=>run(()=>coordinator.observeContext())}>{t.refresh}</Button>
  </section>;
}
