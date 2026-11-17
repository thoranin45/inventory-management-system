import { blocksReconciliation, conflictSchema, contextSchema, lifecyclePayloadSchema, orderLockKey, sameScope, type Attempt, type AttemptState, type Context, type Evidence, type LifecyclePayload, type Payload, type Scope, type Submission } from "./contracts";
import { createAttempt, digest, secureKey, transition } from "./attempt";
import { createClaimSession } from "./claim-session";
import { AttemptStore } from "./store";
import { requireSimulation, type FulfillmentTransport } from "./transport";

export interface Coordination {
  locks: Pick<LockManager,"request">;
  channel(name:string): Pick<BroadcastChannel,"postMessage"|"close"|"addEventListener"|"removeEventListener">;
}
export interface WorkflowView {
  status: "INITIALIZATION_REQUIRED"|"PAUSED"|"READY"|"BUSY"|"OUTCOME_UNKNOWN"|"RECONCILIATION_REQUIRED"|"BLOCKED"|"SIGNED_OUT";
  context?: Context;
  attempts: Attempt[];
  lifecyclePending: boolean;
  credentialAvailable: boolean;
  message?: string;
}
export class FulfillmentCoordinator {
  private session=createClaimSession();
  private inputClosed=true;
  private owned=false;
  private initializing=false;
  private stopped=false;
  private releaseLock?:()=>void;
  private channel?:ReturnType<Coordination["channel"]>;
  private listeners=new Set<()=>void>();
  private view:WorkflowView={status:"INITIALIZATION_REQUIRED",attempts:[],lifecyclePending:false,credentialAvailable:false};
  constructor(readonly scope:Scope, private store:AttemptStore, private transport:FulfillmentTransport, private coordination:Coordination, readonly role:"admin"|"warehouse") {
    this.scope=Object.freeze({...scope});
    requireSimulation(transport);
    if(!sameScope(scope,store.scope))throw new Error("OWNERSHIP_MISMATCH");
  }
  getSnapshot=()=>this.view;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private publish(patch:Partial<WorkflowView>) {this.view={...this.view,...patch};this.listeners.forEach(f=>f());}
  private alive(generation:number) {if(this.stopped || !this.owned || generation!==this.session.generation())throw new Error("STALE_ACTOR_RESPONSE");}
  async initialize():Promise<void> {
    // Synchronous guard: a concurrent call is refused before any await, so one attempt owns resources at a time.
    if(this.owned || this.stopped || this.initializing)throw new Error("ALREADY_INITIALIZED");
    this.initializing=true;
    this.inputClosed=true;
    // Resources of THIS attempt; cleanup touches only these, never another attempt's or coordinator's.
    let channel:ReturnType<Coordination["channel"]>|undefined;
    let release:(()=>void)|undefined;
    try {
      if(!this.coordination?.locks?.request || !this.coordination.channel)throw new Error("COORDINATION_UNAVAILABLE");
      channel=this.coordination.channel("r5-safe3-notifications");
      channel.addEventListener("message",this.onMessage);
      this.channel=channel;
      await new Promise<void>((resolve,reject)=>{
        void this.coordination.locks.request(`r5-safe3:${orderLockKey(this.scope)}`,{mode:"exclusive",ifAvailable:true},lock=>{
          if(!lock){reject(new Error("ORDER_OWNED_BY_ANOTHER_TAB"));return;}
          if(this.stopped){reject(new Error("SIGNED_OUT"));return;}
          return new Promise<void>(settleLock=>{release=settleLock;this.releaseLock=settleLock;this.owned=true;resolve();});
        }).catch(()=>reject(new Error("OWNERSHIP_UNAVAILABLE")));
      });
      await this.store.open();
      const context=await this.transport.context(this.scope);
      if(this.stopped)throw new Error("SIGNED_OUT");
      await this.store.initialize(context);
      await this.refresh();
    } catch {
      this.abandonInitialization(channel,release);
      this.publish({status:"BLOCKED",message:"INITIALIZATION_OR_OWNERSHIP_FAILED"});
      throw new Error("INITIALIZATION_OR_OWNERSHIP_FAILED");
    } finally {this.initializing=false;}
  }
  /** Idempotent cleanup of one failed initialization attempt; clears shared fields only if they are still this attempt's. */
  private abandonInitialization(channel:ReturnType<Coordination["channel"]>|undefined,release:(()=>void)|undefined) {
    // Settling our own callback promise is the only way this attempt's lock is released (the browser may
    // release asynchronously after this). A lock held by another attempt or tab is never reachable here.
    release?.();
    if(release && this.releaseLock===release) {this.releaseLock=undefined;this.owned=false;}
    if(channel) {
      channel.removeEventListener("message",this.onMessage);
      channel.close();
      if(this.channel===channel)this.channel=undefined;
    }
    this.store.close();
    this.inputClosed=true;
  }
  private onMessage=(event:MessageEvent)=>{
    const m=event.data;
    if(m?.kind==="ACTOR_LOGOUT" && m.deployment===this.scope.deployment && m.actor===this.scope.actor)this.dispose();
    // Revision announcements are advisory only; they never unlock or settle anything.
  };
  private async refresh(message?:string):Promise<void> {
    const generation=this.session.generation();
    const [snapshot,rawContext]=await Promise.all([this.store.read(),this.transport.context(this.scope)]);
    this.alive(generation);
    const context=contextSchema.parse(rawContext);
    if(!sameScope(context.scope,this.scope))throw new Error("CONTEXT_ACTOR_MISMATCH");
    const credentialAvailable=context.holder===this.scope.actor && this.session.has(this.scope,context.epoch);
    if(!credentialAvailable && this.view.credentialAvailable)this.session.clear();
    const blocked=snapshot.gate.attempt!==undefined || snapshot.gate.lifecycle!==undefined;
    const status=blocksReconciliation(context.reconciliation)?"RECONCILIATION_REQUIRED":blocked?"OUTCOME_UNKNOWN":credentialAvailable?"READY":"PAUSED";
    this.publish({context,attempts:snapshot.attempts,lifecyclePending:!!snapshot.gate.lifecycle,credentialAvailable,status,message});
    this.inputClosed=false;
  }
  private async exclusive(action:()=>Promise<void>):Promise<void> {
    // Synchronous boundary: a second click, scan or Enter is refused before any await.
    if((typeof navigator!=="undefined" && !navigator.onLine) || this.inputClosed || !this.owned || this.stopped)throw new Error("INPUT_GATE_CLOSED");
    this.inputClosed=true;
    this.publish({status:"BUSY",message:undefined});
    try {await action();if(this.stopped || !this.owned)throw new Error("SIGNED_OUT");await this.refresh();this.channel?.postMessage({kind:"JOURNAL_CHANGED",deployment:this.scope.deployment,order:this.scope.order});}
    catch(e) {
      // Programmatic diagnostic only (view.message is not rendered by the UI); kept across the refresh.
      const message=diagnosticCode(e);
      if(!this.stopped){this.publish({status:"BLOCKED",message});try{await this.refresh(message);}catch{this.inputClosed=true;}}
      throw new Error("ACTION_UNRESOLVED",{cause:e});
    }
  }
  private async ready(requireClaim=true):Promise<Context> {
    const generation=this.session.generation();
    const context=contextSchema.parse(await this.transport.context(this.scope));
    this.alive(generation);
    const snapshot=await this.store.read();
    if(!sameScope(context.scope,this.scope) || blocksReconciliation(context.reconciliation) || snapshot.gate.attempt || snapshot.gate.lifecycle)throw new Error("ORDER_BLOCKED");
    if(requireClaim && (context.holder!==this.scope.actor || !this.session.has(this.scope,context.epoch)))throw new Error("CREDENTIAL_LOST");
    return context;
  }
  submit(payload:Payload):Promise<void> {return this.exclusive(async()=>{
    const context=await this.ready();
    if(payload.epoch!==context.epoch || payload.phase!==context.phase)throw new Error("STALE_CONTEXT");
    const attempt=await this.store.create(await createAttempt(this.scope,payload));
    await this.dispatch(attempt,true);
  });}
  /**
   * `fresh` = the attempt was created by this same call, so no earlier operation can have dispatched it.
   * Only then, and only on the two proven pre-dispatch failures below, is it cancelled (CANCELLED_UNSENT).
   */
  private async dispatch(attempt:Attempt,fresh=false):Promise<void> {
    const generation=this.session.generation();
    if(!this.session.has(this.scope,attempt.payload.epoch)) {
      // Proven unsent: transport.submit is unreachable without a credential.
      if(fresh)await this.cancelUnsent(attempt);
      throw new Error("CREDENTIAL_LOST");
    }
    let sending:Attempt;
    try {sending=await this.store.move(attempt.key,attempt.revision,"SENDING");}
    catch(e) {
      // Proven unsent only for an exact domain abort: the SENDING transaction was rolled back (the attempt is
      // still PERSISTED) and transport.submit was never reached. Storage/unknown failures stay blocked.
      if(fresh && e instanceof Error && e.constructor===Error && PRE_DISPATCH_DOMAIN_ABORT.has(e.message))await this.cancelUnsent(attempt);
      throw e;
    }
    this.alive(generation);
    const unresolved=async()=>{if(!this.stopped && generation===this.session.generation())await this.store.move(sending.key,sending.revision,"OUTCOME_UNKNOWN");};
    let response:Submission;
    try {
      // Transport layer: no response, non-OK, unparseable body or a late/changed-actor response.
      response=await this.session.withCredential(this.scope,sending.payload.epoch,token=>this.transport.submit(sending,token));
      this.alive(generation);
    } catch {await unresolved();throw new Error("TRANSPORT_UNCERTAIN");}
    let settlement:[AttemptState,Evidence|undefined];
    try {settlement=correlate(sending,this.scope,response);}
    catch {await unresolved();throw new Error("EVIDENCE_REJECTED");}   // parsed but invalid evidence never settles
    try {await this.store.move(sending.key,sending.revision,settlement[0],settlement[1]);}
    catch(e) {await unresolved();throw e;}
  }
  /** PERSISTED → CANCELLED_UNSENT under CAS; the gate is released in the same committed transaction. Fails closed. */
  private async cancelUnsent(attempt:Attempt):Promise<void> {
    try {await this.store.move(attempt.key,attempt.revision,"CANCELLED_UNSENT");}
    catch { /* not cancelled: the attempt stays PERSISTED and gated (becomes OUTCOME_UNKNOWN on reload) */ }
  }
  retry(key:string):Promise<void> {return this.exclusive(async()=>{
    const snapshot=await this.store.read();
    const attempt=snapshot.attempts.find(a=>a.key===key);
    const context=contextSchema.parse(await this.transport.context(this.scope));
    if(!attempt || !["PERSISTED","OUTCOME_UNKNOWN"].includes(attempt.state) || snapshot.gate.attempt!==key || blocksReconciliation(context.reconciliation) || !sameScope(context.scope,this.scope) || context.epoch!==attempt.payload.epoch || context.holder!==this.scope.actor)throw new Error("RETRY_NOT_PERMITTED");
    await this.dispatch(attempt);
  });}
  recover(key:string):Promise<void> {return this.exclusive(async()=>{
    const generation=this.session.generation();
    const snapshot=await this.store.read();
    const attempt=snapshot.attempts.find(a=>a.key===key);
    if(!attempt || !["SENDING","OUTCOME_UNKNOWN","CONFLICT"].includes(attempt.state))throw new Error("RECOVERY_NOT_PERMITTED");
    const evidence=await this.transport.recover(attempt);
    this.alive(generation);
    if(evidence?.kind==="ABSENT_NOT_FINAL")return;
    let settlement:[AttemptState,Evidence|undefined];
    try {
      if((evidence as {kind?:unknown})?.kind==="PAYLOAD_CONFLICT")throw new Error("EVIDENCE_MISMATCH");
      settlement=correlate(attempt,this.scope,evidence as Submission);
    } catch {throw new Error("EVIDENCE_REJECTED");}               // attempt and revision stay unchanged
    await this.store.move(attempt.key,attempt.revision,settlement[0],settlement[1]);
  });}
  observeContext():Promise<void> {return this.exclusive(async()=>{ /* GET never changes the journal. */ });}
  validate():Promise<void> {return this.exclusive(async()=>{
    const context=await this.ready();
    const result=contextSchema.parse(await this.session.withCredential(this.scope,context.epoch,t=>this.transport.validate(this.scope,context.epoch,t)));
    if(!sameScope(result.scope,this.scope) || result.epoch!==context.epoch || result.holder!==this.scope.actor) {this.session.clear();throw new Error("CLAIM_INVALIDATED");}
  });}
  lifecycle(rawPayload:LifecyclePayload):Promise<void> {return this.exclusive(async()=>{
    const payload=lifecyclePayloadSchema.parse(rawPayload);
    const context=await this.ready(!["ACQUIRE","TAKEOVER"].includes(payload.kind));
    if(payload.expectedEpoch!==context.epoch || payload.phase!==context.phase || payload.progressRevision!==context.progressRevision)throw new Error("STALE_CONTEXT");
    if(payload.kind==="ACQUIRE" && context.holder!==null)throw new Error("TAKEOVER_REQUIRED");
    if(payload.kind==="TAKEOVER" && (!payload.confirmed || !payload.reason?.trim() || (context.holder!==null && context.holder!==this.scope.actor && this.role!=="admin")))throw new Error("TAKEOVER_NOT_PERMITTED");
    if(payload.kind==="RELEASE")validateRelease(payload,context);
    const intent=await this.store.createLifecycle({scope:this.scope,id:secureKey(),payload,fingerprint:await digest({scope:this.scope,payload}),revision:0,state:"PERSISTED"});
    const sending=await this.store.moveLifecycle(intent.id,intent.revision,"SENDING");
    const generation=this.session.generation();
    try {
      const result=payload.kind==="ACQUIRE" || payload.kind==="TAKEOVER" ? await this.transport.lifecycle(sending) : await this.session.withCredential(this.scope,payload.expectedEpoch,t=>this.transport.lifecycle(sending,t));
      this.alive(generation);
      await this.store.moveLifecycle(sending.id,sending.revision,"RESOLVED",result.evidence);
      if(payload.kind==="ACQUIRE" || payload.kind==="TAKEOVER") {
        if(!result.token)throw new Error("CREDENTIAL_LOST");
        this.session.accept(this.scope,result.evidence.epoch,result.token,generation);
      } else this.session.clear();
    }catch{
      if(!this.stopped && generation===this.session.generation()) {
        const snapshot=await this.store.read();
        const current=snapshot.lifecycleIntents.find(i=>i.id===sending.id);
        if(current?.state==="SENDING")await this.store.moveLifecycle(sending.id,sending.revision,"OUTCOME_UNKNOWN");
      }
      throw new Error("LIFECYCLE_UNCERTAIN");
    }
  });}
  recoverLifecycle():Promise<void> {return this.exclusive(async()=>{
    const generation=this.session.generation();
    const snapshot=await this.store.read();
    const intent=snapshot.lifecycleIntents.find(i=>i.id===snapshot.gate.lifecycle);
    if(!intent || intent.state!=="OUTCOME_UNKNOWN")throw new Error("RECOVERY_NOT_PERMITTED");
    const evidence=await this.transport.recoverLifecycle(intent);
    this.alive(generation);
    if(evidence.kind!=="UNKNOWN") {await this.store.moveLifecycle(intent.id,intent.revision,"RESOLVED",evidence);this.session.clear();}
  });}
  logout() {this.channel?.postMessage({kind:"ACTOR_LOGOUT",deployment:this.scope.deployment,actor:this.scope.actor});this.dispose();}
  dispose() {this.stopped=true;this.inputClosed=true;this.session.clear();this.owned=false;this.releaseLock?.();this.channel?.removeEventListener("message",this.onMessage);this.channel?.close();this.store.close();this.publish({status:"SIGNED_OUT",context:undefined,attempts:[],lifecyclePending:false,credentialAvailable:false});}
}
/**
 * Pure pre-validation of a server response against the stored attempt, run BEFORE any journal write.
 * Uses the same transition() checks the store applies under CAS; throws on any malformed or uncorrelated response.
 * Returns the settlement to persist. Its result object (with a fresh updatedAt) is discarded; the store recomputes.
 */
export function correlate(attempt:Attempt,scope:Scope,response:Submission):[AttemptState,Evidence|undefined] {
  if(response?.kind==="PAYLOAD_CONFLICT") {
    const conflict=conflictSchema.parse(response);
    if(!sameScope(conflict.scope,scope)||conflict.key!==attempt.key||conflict.fingerprint!==attempt.fingerprint)throw new Error("EVIDENCE_MISMATCH");
    transition(attempt,"CONFLICT");
    return ["CONFLICT",undefined];
  }
  const evidence=response as Evidence;
  const target:AttemptState=evidence.kind==="RECORDED"?evidence.outcome:"NOT_APPLIED_FENCED";
  transition(attempt,target,evidence);
  return [target,evidence];
}
/** Store domain aborts of the SENDING move that prove the transaction rolled back (see store.ts DOMAIN). */
const PRE_DISPATCH_DOMAIN_ABORT=new Set(["STALE_REVISION","INVALID_TRANSITION"]);
/** Exposes an error's code (e.g. EVIDENCE_REJECTED, STALE_REVISION) without leaking arbitrary text. */
function diagnosticCode(e:unknown):string {
  return e instanceof Error && /^[A-Z][A-Z0-9_]{2,63}$/.test(e.message)?e.message:"ACTION_UNRESOLVED";
}
export function validateRelease(payload:LifecyclePayload,context:Context):void {
  if(payload.mode==="UNVERIFIED") {if(!payload.reason?.trim() || payload.counts!==undefined || payload.confirmed)throw new Error("INVALID_UNVERIFIED_RELEASE");return;}
  if(payload.mode!=="VERIFIED" || payload.confirmed!==true || !payload.counts || payload.counts.length!==context.allocations.length)throw new Error("ATTESTATION_REQUIRED");
  const ids=new Set(payload.counts.map(c=>c.allocation_id));
  if(ids.size!==payload.counts.length)throw new Error("DUPLICATE_COUNT");
  for(const allocation of context.allocations) {
    const count=payload.counts.find(c=>c.allocation_id===allocation.id);
    if(!count || count.picked!==allocation.picked || count.packed!==allocation.packed)throw new Error("COUNTS_CHANGED_OR_MISMATCHED");
    if(BigInt(count.packed.replace(".",""))>BigInt(count.picked.replace(".","")) || BigInt(count.picked.replace(".",""))>BigInt(allocation.allocated.replace(".","")) || (payload.phase==="PICK" && count.packed!=="0.000"))throw new Error("INVALID_COUNTS");
  }
}
