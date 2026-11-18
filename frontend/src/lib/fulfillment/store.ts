import { z } from "zod";
import { attemptSchema, contextSchema, lifecycleSchema, lifecycleEvidenceSchema, sameScope, scopeKey, type Attempt, type AttemptState, type Context, type Evidence, type LifecycleIntent, type LifecycleEvidence, type Scope } from "./contracts";
import { digest, immutable, terminal, transition, verifyAttempt } from "./attempt";

const names = ["attempts","orderGates","lifecycleIntents","metadata"] as const;
const gateSchema = z.object({ revision:z.number().int().nonnegative(), attempt:z.string().uuid().optional(), lifecycle:z.string().uuid().optional() }).strict();
type Gate = z.infer<typeof gateSchema>;
interface Snapshot { attempts: Attempt[]; lifecycleIntents: LifecycleIntent[]; gate: Gate; }
interface Row { id:string; partition:string; value:unknown; }
/** Exact codes thrown by update callbacks that abort cleanly and leave the handle usable. */
const DOMAIN = new Set(["ORDER_BLOCKED","STALE_REVISION","INVALID_TRANSITION","EVIDENCE_MISMATCH","UNEXPECTED_EVIDENCE","JOURNAL_RECOVERY_REQUIRED"]);
/** Exact codes that mean the stored journal itself cannot be trusted. */
const INTEGRITY = new Set(["CORRUPT","GATE_CORRUPT","OWNERSHIP_MISMATCH","JOURNAL_ERASED"]);
type Fault = { kind:"domain"|"integrity"|"unknown"; error:unknown };
/** Plain Errors with an exact allowlisted message only; anything else is unknown and fails closed. */
function classify(e:unknown):Fault {
  const code=e instanceof Error && e.constructor===Error ? e.message : undefined;
  return { kind: code && DOMAIN.has(code) ? "domain" : code && INTEGRITY.has(code) ? "integrity" : "unknown", error:e };
}

/** One pinned actor/order per handle. All promises resolve after transaction completion, never request success. */
export class AttemptStore {
  private db?: IDBDatabase;
  private authorized = false;
  private failed = false;
  readonly partition: string;
  constructor(readonly scope: Scope, private factory: IDBFactory, private databaseName = "r5-safe3-journal") { this.scope = Object.freeze({...scope}); this.partition=scopeKey(scope); }
  async open(): Promise<void> {
    if (this.failed || !this.factory) throw new Error("STORAGE_UNAVAILABLE");
    await new Promise<void>((resolve,reject) => {
      const request=this.factory.open(this.databaseName,1);
      request.onupgradeneeded=()=>{
        const db=request.result;
        for (const name of names) { const store=db.createObjectStore(name,{keyPath:"id"}); store.createIndex("partition","partition"); }
      };
      request.onblocked=()=>{ this.failed=true; reject(new Error("JOURNAL_VERSION_BLOCKED")); };
      request.onerror=()=>{ this.failed=true; reject(new Error("JOURNAL_OPEN_FAILED")); };
      request.onsuccess=()=>{
        if(this.failed) {request.result.close();return;}
        this.db=request.result;
        this.db.onversionchange=()=>{this.failed=true;this.authorized=false;this.db?.close();};
        this.db.onclose=()=>{this.failed=true;this.authorized=false;};
        if(names.some(name=>!this.db!.objectStoreNames.contains(name))) {this.failed=true;this.db.close();reject(new Error("JOURNAL_CORRUPT"));return;}
        resolve();
      };
    });
  }
  private transaction<T>(write:boolean, update:(snapshot:Snapshot|undefined,tx:IDBTransaction)=>T):Promise<T> {
    if(!this.db || this.failed) return Promise.reject(new Error("STORAGE_UNAVAILABLE"));
    return new Promise<T>((resolve,reject)=>{
      let result:T;
      let fault:Fault|undefined;
      let settled=false;
      const settle=(finish:()=>void)=>{if(!settled){settled=true;finish();}};
      let tx:IDBTransaction;
      try { tx=this.db!.transaction([...names],write?"readwrite":"readonly",write?{durability:"strict"}:undefined); }
      catch { this.failed=true; reject(new Error("STORAGE_TRANSACTION_FAILED"));return; }
      tx.oncomplete=()=>settle(()=>fault?reject(new Error("STORAGE_TRANSACTION_ABORTED")):resolve(result));
      // The fault is recorded synchronously before tx.abort(), so this asynchronous callback can tell an
      // intentional domain abort (rolled back, handle still valid) from a genuine storage failure.
      tx.onabort=()=>settle(()=>{
        if(fault?.kind==="domain") {reject(fault.error);return;}
        this.failed=true;this.authorized=false;
        const code=fault?.kind==="integrity"?(fault.error as Error).message:undefined;
        reject(new Error(code===undefined?"STORAGE_TRANSACTION_ABORTED":code==="CORRUPT"?"JOURNAL_CORRUPT":code));
      });
      tx.onerror=()=>{ /* onabort is the authoritative failure boundary */ };
      const rows:Partial<Record<typeof names[number],Row[]>>={};
      for(const name of names) {
        const request=tx.objectStore(name).index("partition").getAll(this.partition);
        request.onsuccess=()=>{
          rows[name]=request.result;
          if(Object.keys(rows).length!==names.length)return;
          let snapshot:Snapshot|undefined;
          try {
            const meta=rows.metadata!;
            if(meta.length>1 || rows.orderGates!.length>1)throw new Error("CORRUPT");
            if(meta.length===0) {
              if(rows.attempts!.length || rows.lifecycleIntents!.length || rows.orderGates!.length)throw new Error("CORRUPT");
            } else {
              if(JSON.stringify(meta[0].value)!==JSON.stringify({version:1}) || meta[0].id!==this.partition || rows.orderGates!.length!==1)throw new Error("CORRUPT");
              snapshot={attempts:rows.attempts!.map(r=>attemptSchema.parse(r.value)),lifecycleIntents:rows.lifecycleIntents!.map(r=>lifecycleSchema.parse(r.value)),gate:gateSchema.parse(rows.orderGates![0].value)};
              if(snapshot.attempts.some(a=>!sameScope(a.scope,this.scope)) || snapshot.lifecycleIntents.some(i=>!sameScope(i.scope,this.scope)))throw new Error("OWNERSHIP_MISMATCH");
              const pending=snapshot.attempts.filter(a=>!terminal(a.state));
              const lifecycle=snapshot.lifecycleIntents.filter(i=>i.state!=="RESOLVED");
              if(pending.length>1 || lifecycle.length>1 || (pending.length && lifecycle.length) || pending[0]?.key!==snapshot.gate.attempt || lifecycle[0]?.id!==snapshot.gate.lifecycle)throw new Error("GATE_CORRUPT");
            }
          }catch(e){
            // Any failure while validating STORED rows (including schema parse errors) is an integrity fault.
            fault={kind:"integrity",error:classify(e).kind==="integrity"?e:new Error("CORRUPT")};tx.abort();return;
          }
          try { result=update(snapshot,tx); }
          catch(e){fault=classify(e);tx.abort();}
        };
      }
    });
  }
  private put(tx:IDBTransaction,name:typeof names[number],id:string,value:unknown) {tx.objectStore(name).put({id,partition:this.partition,value});}
  private rowId(id:string) {return JSON.stringify([this.partition,id]);}
  async initialize(rawContext:Context):Promise<void> {
    const context=contextSchema.parse(rawContext);
    if(!sameScope(context.scope,this.scope))throw new Error("OWNERSHIP_MISMATCH");
    // This is an explicit synthetic authority boundary, NOT a local first-visit marker.
    await this.transaction(true,(snapshot,tx)=>{
      if(!snapshot) {if(!context.initialization.emptyJournalAuthorized)throw new Error("JOURNAL_RECOVERY_REQUIRED");this.put(tx,"metadata",this.partition,{version:1});this.put(tx,"orderGates",this.partition,{revision:0});}
    });
    this.authorized=true;
    const loaded=await this.read();
    // Reload: SENDING and PERSISTED both become OUTCOME_UNKNOWN (same key, payload and gate; no evidence attached).
    // A recovered PERSISTED cannot prove non-dispatch (durability loss, request in flight), so it is never cancelled here.
    for(const attempt of loaded.attempts) if(attempt.state==="SENDING" || attempt.state==="PERSISTED") await this.move(attempt.key,attempt.revision,"OUTCOME_UNKNOWN");
    // Lifecycle intents likewise: a recovered PERSISTED intent is uncertain (never cancelled) and resolves only by correlated evidence.
    for(const intent of loaded.lifecycleIntents) if(intent.state==="SENDING" || intent.state==="PERSISTED")await this.moveLifecycle(intent.id,intent.revision,"OUTCOME_UNKNOWN");
  }
  async read():Promise<Snapshot> {
    if(!this.authorized)throw new Error("INITIALIZATION_REQUIRED");
    const snapshot=await this.transaction(false,s=>{if(!s)throw new Error("JOURNAL_ERASED");return s;});
    try {
      await Promise.all(snapshot.attempts.map(verifyAttempt));
      for(const intent of snapshot.lifecycleIntents)if(intent.fingerprint!==await digest({scope:intent.scope,payload:intent.payload}))throw new Error("CORRUPT");
    }catch{this.failed=true;this.authorized=false;throw new Error("JOURNAL_CORRUPT");}
    return snapshot;
  }
  async create(attempt:Attempt):Promise<Attempt> {
    attempt=immutable(await verifyAttempt(attempt));
    if(!this.authorized || !sameScope(attempt.scope,this.scope))throw new Error("INITIALIZATION_REQUIRED");
    const persisted=transition(attempt,"PERSISTED");
    return this.transaction(true,(s,tx)=>{
      if(!s || s.gate.attempt || s.gate.lifecycle || s.attempts.some(a=>a.key===attempt.key))throw new Error("ORDER_BLOCKED");
      this.put(tx,"attempts",this.rowId(attempt.key),persisted);
      this.put(tx,"orderGates",this.partition,{revision:s.gate.revision+1,attempt:attempt.key});
      return persisted;
    });
  }
  async move(key:string,revision:number,state:AttemptState,evidence?:Evidence):Promise<Attempt> {
    if(!this.authorized)throw new Error("INITIALIZATION_REQUIRED");
    return this.transaction(true,(s,tx)=>{
      const a=s?.attempts.find(a=>a.key===key);
      if(!s || !a || a.revision!==revision || s.gate.attempt!==key)throw new Error("STALE_REVISION");
      const next=transition(a,state,evidence);
      this.put(tx,"attempts",this.rowId(key),next);
      this.put(tx,"orderGates",this.partition,{revision:s.gate.revision+1,...(!terminal(next.state)?{attempt:key}:{})});
      return next;
    });
  }
  async createLifecycle(intent:LifecycleIntent):Promise<LifecycleIntent> {
    lifecycleSchema.parse(intent);
    if(!this.authorized || !sameScope(intent.scope,this.scope) || intent.state!=="PERSISTED" || intent.fingerprint!==await digest({scope:intent.scope,payload:intent.payload}))throw new Error("INVALID_INTENT");
    return this.transaction(true,(s,tx)=>{
      if(!s || s.gate.attempt || s.gate.lifecycle || s.lifecycleIntents.some(i=>i.id===intent.id))throw new Error("ORDER_BLOCKED");
      this.put(tx,"lifecycleIntents",this.rowId(intent.id),intent);
      this.put(tx,"orderGates",this.partition,{revision:s.gate.revision+1,lifecycle:intent.id});
      return intent;
    });
  }
  async moveLifecycle(id:string,revision:number,state:LifecycleIntent["state"],rawEvidence?:LifecycleEvidence):Promise<LifecycleIntent> {
    if(!this.authorized)throw new Error("INITIALIZATION_REQUIRED");
    const evidence=rawEvidence?lifecycleEvidenceSchema.parse(rawEvidence):undefined;
    return this.transaction(true,(s,tx)=>{
      const intent=s?.lifecycleIntents.find(i=>i.id===id);
      if(!s || !intent || intent.revision!==revision || s.gate.lifecycle!==id)throw new Error("STALE_REVISION");
      const allowed:Record<LifecycleIntent["state"],LifecycleIntent["state"][]>={PERSISTED:["SENDING","OUTCOME_UNKNOWN"],SENDING:["OUTCOME_UNKNOWN","RESOLVED"],OUTCOME_UNKNOWN:["RESOLVED"],RESOLVED:[]};
      if(!allowed[intent.state].includes(state))throw new Error("INVALID_TRANSITION");
      if(state==="RESOLVED" && (!evidence || !sameScope(evidence.scope,this.scope) || evidence.intentId!==id || evidence.fingerprint!==intent.fingerprint || evidence.epoch<=intent.payload.expectedEpoch))throw new Error("EVIDENCE_MISMATCH");
      const next=immutable(lifecycleSchema.parse({...intent,state,revision:revision+1,...(evidence?{evidenceId:evidence.evidenceId}:{})}));
      this.put(tx,"lifecycleIntents",this.rowId(id),next);
      this.put(tx,"orderGates",this.partition,{revision:s.gate.revision+1,...(state!=="RESOLVED"?{lifecycle:id}:{})});
      return next;
    });
  }
  close() {this.authorized=false;this.db?.close();this.db=undefined;}
}
