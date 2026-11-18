import { beforeEach,it,expect,vi } from "vitest";
import { webcrypto } from "node:crypto";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { AttemptStore } from "./store";
import { createAttempt,digest,secureKey } from "./attempt";
import type { Context,LifecyclePayload,Payload } from "./contracts";
const scope={deployment:"simulation",actor:1,order:101};
const context:Context={scope,phase:"PICK",epoch:1,holder:1,reconciliation:"CLEAR",progressRevision:"1",allocations:[],initialization:{kind:"SIMULATION_AUTHORIZATION",evidenceId:"trusted-fixture",journalRecoveryChecked:true,emptyJournalAuthorized:true}};
const payload:Payload={operation:"SCAN_PICK",phase:"PICK",epoch:1,barcode:"00001",quantity:"1.000"};
beforeEach(()=>vi.stubGlobal("crypto",webcrypto));
async function setup(factory=new IDBFactory()){const store=new AttemptStore(scope,factory);await store.open();await store.initialize(context);return {store,factory};}
it("requires explicit authorization even for an empty journal",async()=>{const store=new AttemptStore(scope,new IDBFactory());await store.open();await expect(store.read()).rejects.toThrow("INITIALIZATION");await expect(store.create(await createAttempt(scope,payload))).rejects.toThrow();});
it("atomically commits attempt and gate; returns only after commit",async()=>{const {store}=await setup();const a=await store.create(await createAttempt(scope,payload));const s=await store.read();expect(s.gate.attempt).toBe(a.key);expect(s.attempts).toEqual([a]);expect(a.state).toBe("PERSISTED");});
it("aborts stale CAS without partially settling or releasing the order",async()=>{const {store,factory}=await setup();const a=await store.create(await createAttempt(scope,payload));await expect(store.move(a.key,0,"SENDING")).rejects.toThrow("STALE_REVISION");expect((await store.read()).gate.attempt).toBe(a.key);store.close();const {store:again}=await setup(factory);expect((await again.read()).gate.attempt).toBe(a.key);});
it("reload converts SENDING into unknown while preserving exact payload/key",async()=>{const {store,factory}=await setup();const a=await store.create(await createAttempt(scope,payload));await store.move(a.key,a.revision,"SENDING");store.close();const {store:again}=await setup(factory);const recovered=(await again.read()).attempts[0];expect(recovered.state).toBe("OUTCOME_UNKNOWN");expect(recovered.key).toBe(a.key);expect(recovered.payload).toEqual(a.payload);});
it("crash before dispatch retains the attempt (key, payload, fingerprint, gate) as OUTCOME_UNKNOWN after reload",async()=>{const {store,factory}=await setup();const a=await store.create(await createAttempt(scope,payload));store.close();const {store:again}=await setup(factory);const s=await again.read();const r=s.attempts[0];expect(s.attempts).toHaveLength(1);expect(r.key).toBe(a.key);expect(r.payload).toEqual(a.payload);expect(r.fingerprint).toBe(a.fingerprint);expect(r.state).toBe("OUTCOME_UNKNOWN");expect(r.evidence).toBeUndefined();expect(s.gate.attempt).toBe(a.key);});
it("does not disclose another actor's journal",async()=>{const {store,factory}=await setup();await store.create(await createAttempt(scope,payload));const other=new AttemptStore({...scope,actor:2},factory);await other.open();await other.initialize({...context,scope:{...scope,actor:2}});expect((await other.read()).attempts).toEqual([]);await expect(other.create(await createAttempt(scope,payload))).rejects.toThrow();});
it("erased local history cannot authorize a new mutation",async()=>{const store=new AttemptStore(scope,new IDBFactory());await store.open();await expect(store.initialize({...context,initialization:{...context.initialization,emptyJournalAuthorized:false}})).rejects.toThrow();await expect(store.create(await createAttempt(scope,payload))).rejects.toThrow();});
it("storage unavailable and unsupported database versions fail closed",async()=>{const factory=new IDBFactory();await new Promise<void>((resolve,reject)=>{const req=factory.open("r5-safe3-journal",2);req.onsuccess=()=>{req.result.close();resolve();};req.onerror=()=>reject(req.error);});await expect(new AttemptStore(scope,factory).open()).rejects.toThrow("OPEN_FAILED");await expect(new AttemptStore(scope,undefined as unknown as IDBFactory).open()).rejects.toThrow("UNAVAILABLE");});
it("detects corrupt record content without leaking serialized data",async()=>{const {store,factory}=await setup();const a=await store.create(await createAttempt(scope,payload));store.close();await new Promise<void>((resolve)=>{const request=factory.open("r5-safe3-journal");request.onsuccess=()=>{const db=request.result;const tx=db.transaction("attempts","readwrite");const cursor=tx.objectStore("attempts").openCursor();cursor.onsuccess=()=>{const c=cursor.result!;c.update({...c.value,value:{...a,payload:{...a.payload,quantity:"2.000"}}});};tx.oncomplete=()=>{db.close();resolve();};};});const next=new AttemptStore(scope,factory);await next.open();await expect(next.initialize(context)).rejects.toThrow("CORRUPT");});
it("lifecycle intent commits before send and blocks duplicate work",async()=>{const {store}=await setup();const p={kind:"ACQUIRE" as const,phase:"PICK" as const,expectedEpoch:1,progressRevision:"1"};const i=await store.createLifecycle({scope,id:secureKey(),payload:p,fingerprint:await digest({scope,payload:p}),revision:0,state:"PERSISTED"});expect((await store.read()).gate.lifecycle).toBe(i.id);await expect(store.create(await createAttempt(scope,payload))).rejects.toThrow();});

it("quota failure after the attempt write rolls back both stores",async()=>{const {store,factory}=await setup();const original=IDBObjectStore.prototype.put;const spy=vi.spyOn(IDBObjectStore.prototype,"put").mockImplementation(function(this:IDBObjectStore,...args:Parameters<IDBObjectStore["put"]>){if(this.name==="orderGates")throw new DOMException("quota","QuotaExceededError");return original.apply(this,args);});await expect(store.create(await createAttempt(scope,payload))).rejects.toThrow("ABORTED");spy.mockRestore();await expect(store.read()).rejects.toThrow("INITIALIZATION_REQUIRED");await expect(store.open()).rejects.toThrow("STORAGE_UNAVAILABLE");store.close();const {store:again}=await setup(factory);const snapshot=await again.read();expect(snapshot.attempts).toEqual([]);expect(snapshot.gate.attempt).toBeUndefined();});

/* WP-2 / D4: narrow error classification. Domain faults abort cleanly and keep the handle; everything else fails closed. */
function rewriteRow(factory:IDBFactory,name:string,mutate:(v:{id:string;partition:string;value:unknown})=>unknown) {
  return new Promise<void>((resolve)=>{const request=factory.open("r5-safe3-journal");request.onsuccess=()=>{const db=request.result;const tx=db.transaction(name,"readwrite");const cursor=tx.objectStore(name).openCursor();cursor.onsuccess=()=>{const c=cursor.result;if(c){c.update(mutate(c.value));c.continue();}};tx.oncomplete=()=>{db.close();resolve();};};});
}
function throwingPut(error:unknown) {
  return vi.spyOn(IDBObjectStore.prototype,"put").mockImplementation(()=>{throw error;});
}
it("ORDER_BLOCKED keeps its code, writes nothing and leaves the handle usable",async()=>{
  const {store}=await setup();const a=await store.create(await createAttempt(scope,payload));
  await expect(store.create(await createAttempt(scope,payload))).rejects.toThrow("ORDER_BLOCKED");
  const s=await store.read();expect(s.attempts).toEqual([a]);expect(s.gate.attempt).toBe(a.key);
  expect((await store.move(a.key,a.revision,"SENDING")).state).toBe("SENDING");
});
it("evidence mismatch inside the transaction is a domain fault: no settlement, handle usable",async()=>{
  const {store}=await setup();const a=await store.create(await createAttempt(scope,payload));const s=await store.move(a.key,a.revision,"SENDING");
  const wrong={kind:"RECORDED" as const,scope,key:s.key,fingerprint:"0".repeat(64),outcome:"APPLIED" as const,epoch:1,historical:false,replayed:false,recordedAt:new Date().toISOString(),evidenceId:"e",status:200};
  await expect(store.move(s.key,s.revision,"APPLIED",wrong)).rejects.toThrow("EVIDENCE_MISMATCH");
  expect((await store.read()).attempts[0].state).toBe("SENDING");
  expect((await store.move(s.key,s.revision,"OUTCOME_UNKNOWN")).state).toBe("OUTCOME_UNKNOWN");
});
it("JOURNAL_RECOVERY_REQUIRED keeps its code and does not poison the handle",async()=>{
  const store=new AttemptStore(scope,new IDBFactory());await store.open();
  await expect(store.initialize({...context,initialization:{...context.initialization,emptyJournalAuthorized:false}})).rejects.toThrow("JOURNAL_RECOVERY_REQUIRED");
  await store.initialize(context);expect((await store.read()).attempts).toEqual([]);
});
it("corrupt stored rows are integrity faults: JOURNAL_CORRUPT and a poisoned handle",async()=>{
  const {store,factory}=await setup();await store.create(await createAttempt(scope,payload));
  await rewriteRow(factory,"orderGates",row=>({...row,value:{revision:"not-a-number"}}));
  await expect(store.read()).rejects.toThrow("JOURNAL_CORRUPT");
  await expect(store.open()).rejects.toThrow("STORAGE_UNAVAILABLE");
});
it("an erased journal after authorization stays fail-closed with JOURNAL_ERASED",async()=>{
  const {store,factory}=await setup();
  await new Promise<void>((resolve)=>{const r=factory.open("r5-safe3-journal");r.onsuccess=()=>{const db=r.result;const tx=db.transaction(["metadata","orderGates"],"readwrite");tx.objectStore("metadata").clear();tx.objectStore("orderGates").clear();tx.oncomplete=()=>{db.close();resolve();};};});
  await expect(store.read()).rejects.toThrow("JOURNAL_ERASED");
  await expect(store.open()).rejects.toThrow("STORAGE_UNAVAILABLE");
});
it.each([
  ["a TypeError",new TypeError("boom")],
  ["an Error with an unknown code",new Error("SOMETHING_ELSE")],
  ["an Error subclass carrying a domain code",new (class Spoof extends Error {})("STALE_REVISION")],
])("%s thrown inside a write is unknown: STORAGE_TRANSACTION_ABORTED and a poisoned handle",async(_label,error)=>{
  const {store,factory}=await setup();const spy=throwingPut(error);
  await expect(store.create(await createAttempt(scope,payload))).rejects.toThrow("STORAGE_TRANSACTION_ABORTED");spy.mockRestore();
  await expect(store.open()).rejects.toThrow("STORAGE_UNAVAILABLE");
  store.close();const {store:again}=await setup(factory);const s=await again.read();expect(s.attempts).toEqual([]);expect(s.gate.attempt).toBeUndefined();
});
it("an abort without a recorded fault (IO / async quota) fails closed exactly once",async()=>{
  const {store}=await setup();const original=IDBObjectStore.prototype.put;
  const spy=vi.spyOn(IDBObjectStore.prototype,"put").mockImplementation(function(this:IDBObjectStore,...args:Parameters<IDBObjectStore["put"]>){const r=original.apply(this,args);this.transaction.abort();return r;});
  const outcome=store.create(await createAttempt(scope,payload));
  await expect(outcome).rejects.toThrow("STORAGE_TRANSACTION_ABORTED");spy.mockRestore();
  await expect(store.open()).rejects.toThrow("STORAGE_UNAVAILABLE");
});

/* WP-3 B1 / D2a: recovered PERSISTED → OUTCOME_UNKNOWN; CANCELLED_UNSENT only from PERSISTED, atomic with the gate. */
it("reload conversion is idempotent and keeps journal integrity",async()=>{
  const {store,factory}=await setup();const a=await store.create(await createAttempt(scope,payload));store.close();
  const first=await setup(factory);const once=(await first.store.read()).attempts[0];first.store.close();
  const second=await setup(factory);const twice=await second.store.read();
  expect(twice.attempts[0]).toEqual(once);expect(once.revision).toBe(a.revision+1);expect(twice.gate.attempt).toBe(a.key);
});
it("cancellation releases the gate in the same committed transaction; a second cancellation is rejected",async()=>{
  const {store}=await setup();const a=await store.create(await createAttempt(scope,payload));
  const cancelled=await store.move(a.key,a.revision,"CANCELLED_UNSENT");
  const s=await store.read();expect(cancelled.state).toBe("CANCELLED_UNSENT");expect(s.gate.attempt).toBeUndefined();expect(s.attempts[0].state).toBe("CANCELLED_UNSENT");
  await expect(store.move(a.key,a.revision,"CANCELLED_UNSENT")).rejects.toThrow("STALE_REVISION");
  await expect(store.move(cancelled.key,cancelled.revision,"CANCELLED_UNSENT")).rejects.toThrow("STALE_REVISION");
  const b=await store.create(await createAttempt(scope,payload));expect(b.key).not.toBe(a.key);
});
it("OUTCOME_UNKNOWN can never be locally cancelled",async()=>{
  const {store}=await setup();const a=await store.create(await createAttempt(scope,payload));
  const sending=await store.move(a.key,a.revision,"SENDING");const unknown=await store.move(sending.key,sending.revision,"OUTCOME_UNKNOWN");
  await expect(store.move(unknown.key,unknown.revision,"CANCELLED_UNSENT")).rejects.toThrow("INVALID_TRANSITION");
  const s=await store.read();expect(s.attempts[0].state).toBe("OUTCOME_UNKNOWN");expect(s.gate.attempt).toBe(a.key);
});
it("storage failure during cancellation stays fail-closed: still PERSISTED and gated, uncertain after reload",async()=>{
  const {store,factory}=await setup();const a=await store.create(await createAttempt(scope,payload));
  const spy=vi.spyOn(IDBObjectStore.prototype,"put").mockImplementation(()=>{throw new DOMException("quota","QuotaExceededError");});
  await expect(store.move(a.key,a.revision,"CANCELLED_UNSENT")).rejects.toThrow("ABORTED");spy.mockRestore();
  store.close();const {store:again}=await setup(factory);const s=await again.read();
  expect(s.attempts[0].state).toBe("OUTCOME_UNKNOWN");expect(s.gate.attempt).toBe(a.key);
});

/* WP-3 B2-minimal / D2b: a recovered PERSISTED lifecycle intent becomes OUTCOME_UNKNOWN and resolves only by correlated evidence. */
const lifecyclePayloads:Record<LifecyclePayload["kind"],LifecyclePayload>={
  ACQUIRE:{kind:"ACQUIRE",phase:"PICK",expectedEpoch:1,progressRevision:"1"},
  TAKEOVER:{kind:"TAKEOVER",phase:"PICK",expectedEpoch:1,progressRevision:"1",reason:"resume after reload",confirmed:true},
  RELEASE:{kind:"RELEASE",mode:"VERIFIED",confirmed:true,phase:"PICK",expectedEpoch:1,progressRevision:"1",counts:[{allocation_id:1,picked:"0.000",packed:"0.000"}]},
  COMPLETE:{kind:"COMPLETE",phase:"PICK",expectedEpoch:1,progressRevision:"1"},
};
async function persistedIntent(store:AttemptStore,p:LifecyclePayload){return store.createLifecycle({scope,id:secureKey(),payload:p,fingerprint:await digest({scope,payload:p}),revision:0,state:"PERSISTED"});}
it.each(["ACQUIRE","TAKEOVER","RELEASE","COMPLETE"] as const)("reload turns a PERSISTED %s intent into OUTCOME_UNKNOWN with identity, payload and gate intact; repeated reload is idempotent",async kind=>{
  const {store,factory}=await setup();const i=await persistedIntent(store,lifecyclePayloads[kind]);store.close();
  const {store:again}=await setup(factory);const s=await again.read();const r=s.lifecycleIntents[0];
  expect(s.lifecycleIntents).toHaveLength(1);expect(r.state).toBe("OUTCOME_UNKNOWN");expect(r.id).toBe(i.id);expect(r.scope).toEqual(scope);
  expect(r.payload).toEqual(i.payload);expect(r.payload.kind).toBe(kind);expect(r.payload.expectedEpoch).toBe(1);expect(r.fingerprint).toBe(i.fingerprint);
  expect(r.revision).toBe(1);expect(r.evidenceId).toBeUndefined();expect(s.gate.lifecycle).toBe(i.id);
  await expect(again.create(await createAttempt(scope,payload))).rejects.toThrow("ORDER_BLOCKED");
  again.close();const {store:third}=await setup(factory);const t=await third.read();expect(t.lifecycleIntents[0]).toEqual(r);expect(t.gate).toEqual(s.gate);
});
it("existing SENDING lifecycle recovery is unchanged (OUTCOME_UNKNOWN, gate held)",async()=>{
  const {store,factory}=await setup();const i=await persistedIntent(store,lifecyclePayloads.ACQUIRE);const sending=await store.moveLifecycle(i.id,i.revision,"SENDING");store.close();
  const {store:again}=await setup(factory);const s=await again.read();
  expect(s.lifecycleIntents[0].state).toBe("OUTCOME_UNKNOWN");expect(s.lifecycleIntents[0].revision).toBe(sending.revision+1);expect(s.gate.lifecycle).toBe(i.id);
});
it("a recovered intent resolves only with correlated evidence; mismatched or same-epoch evidence never releases the gate",async()=>{
  const {store,factory}=await setup();const i=await persistedIntent(store,lifecyclePayloads.RELEASE);
  const valid={scope,intentId:i.id,fingerprint:i.fingerprint,kind:"LIFECYCLE_RECORDED" as const,evidenceId:"synthetic-lifecycle",epoch:2};
  await expect(store.moveLifecycle(i.id,i.revision,"RESOLVED",valid)).rejects.toThrow("INVALID_TRANSITION");   // never PERSISTED → RESOLVED
  store.close();const {store:again}=await setup(factory);const u=(await again.read()).lifecycleIntents[0];
  for(const bad of [{...valid,intentId:secureKey()},{...valid,fingerprint:"0".repeat(64)},{...valid,scope:{...scope,actor:2}},{...valid,epoch:1}])
    await expect(again.moveLifecycle(u.id,u.revision,"RESOLVED",bad)).rejects.toThrow("EVIDENCE_MISMATCH");
  await expect(again.moveLifecycle(u.id,u.revision,"RESOLVED")).rejects.toThrow("EVIDENCE_MISMATCH");
  expect((await again.read()).gate.lifecycle).toBe(i.id);
  const resolved=await again.moveLifecycle(u.id,u.revision,"RESOLVED",valid);const s=await again.read();
  expect(resolved.state).toBe("RESOLVED");expect(resolved.evidenceId).toBe("synthetic-lifecycle");expect(s.gate.lifecycle).toBeUndefined();
  await expect(again.moveLifecycle(u.id,u.revision,"RESOLVED",valid)).rejects.toThrow("STALE_REVISION");
});
it("storage failure during the reload conversion fails closed and writes nothing; a later clean reload converts once",async()=>{
  const {store,factory}=await setup();const i=await persistedIntent(store,lifecyclePayloads.COMPLETE);store.close();
  const failing=new AttemptStore(scope,factory);await failing.open();const spy=throwingPut(new DOMException("quota","QuotaExceededError"));
  try {await expect(failing.initialize(context)).rejects.toThrow("ABORTED");} finally {spy.mockRestore();}await expect(failing.read()).rejects.toThrow();failing.close();
  const {store:again}=await setup(factory);const s=await again.read();
  expect(s.lifecycleIntents[0].state).toBe("OUTCOME_UNKNOWN");expect(s.lifecycleIntents[0].revision).toBe(1);expect(s.gate.lifecycle).toBe(i.id);
});
it("a corrupt lifecycle row stops initialization (no conversion, no release)",async()=>{
  const {store,factory}=await setup();await persistedIntent(store,lifecyclePayloads.ACQUIRE);store.close();
  await rewriteRow(factory,"lifecycleIntents",row=>({...row,value:{...(row.value as object),state:"CANCELLED_UNSENT"}}));
  const broken=new AttemptStore(scope,factory);await broken.open();await expect(broken.initialize(context)).rejects.toThrow("CORRUPT");
  await expect(broken.read()).rejects.toThrow();broken.close();
});
