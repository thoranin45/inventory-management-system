import { beforeEach,it,expect,vi } from "vitest";
import { webcrypto } from "node:crypto";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { FulfillmentCoordinator,type Coordination } from "./coordinator";
import { AttemptStore } from "./store";
import { createAttempt,digest,secureKey } from "./attempt";
import { createFixtureBackend,SYNTHETIC_DEPLOYMENT } from "../../../fulfillment-harness/fixture-server";
import type { LifecycleEvidence,LifecyclePayload,Payload } from "./contracts";
beforeEach(()=>vi.stubGlobal("crypto",webcrypto));
function coordination():Coordination {
 const held=new Set<string>();
 return {locks:{request:((name:string,_options:unknown,callback:(lock:Lock|null)=>Promise<void>)=>{if(held.has(name))return Promise.resolve(callback(null));held.add(name);return Promise.resolve(callback({name,mode:"exclusive"} as Lock)).finally(()=>held.delete(name));}) as LockManager["request"]},channel:()=>({postMessage:vi.fn(),close:vi.fn(),addEventListener:vi.fn(),removeEventListener:vi.fn()})};
}
async function setup(){const scope={deployment:SYNTHETIC_DEPLOYMENT,actor:1,order:101};const fixture=createFixtureBackend();const factory=new IDBFactory();const coord=coordination();const store=new AttemptStore(scope,factory);const c=new FulfillmentCoordinator(scope,store,fixture.api,coord,"warehouse");await c.initialize();const initial=c.getSnapshot().context!;await c.lifecycle({kind:"ACQUIRE",phase:initial.phase,expectedEpoch:initial.epoch,progressRevision:initial.progressRevision});return {c,fixture,scope,factory,coord,store};}
function payload(c:FulfillmentCoordinator):Payload {const ctx=c.getSnapshot().context!;return {operation:"SCAN_PICK",phase:"PICK",epoch:ctx.epoch,barcode:"00001",quantity:"1.000"};}
it("persists SENDING before dispatch; refuses concurrent input without queuing",async()=>{const {c,fixture,store}=await setup();const original=fixture.api.submit;let release!:()=>void;fixture.api.submit=async(a,t)=>{expect((await store.read()).attempts[0].state).toBe("SENDING");await new Promise<void>(r=>{release=r;});return original(a,t);};const first=c.submit(payload(c));await expect(c.submit(payload(c))).rejects.toThrow("INPUT_GATE_CLOSED");await vi.waitFor(()=>expect(release).toBeTypeOf("function"));release();await first;expect(fixture.inspect().calls).toBe(1);expect(c.getSnapshot().status).toBe("READY");c.dispose();});
it("lost response stays blocked after GET, then manual identical-key replay applies only once",async()=>{const {c,fixture}=await setup();fixture.setFault("DROP_AFTER_COMMIT");await expect(c.submit(payload(c))).rejects.toThrow();const a=c.getSnapshot().attempts[0];expect(a.state).toBe("OUTCOME_UNKNOWN");await c.observeContext();expect(c.getSnapshot().status).toBe("OUTCOME_UNKNOWN");await expect(c.submit(payload(c))).rejects.toThrow();expect(c.getSnapshot().attempts).toHaveLength(1);await c.retry(a.key);expect(c.getSnapshot().attempts[0].key).toBe(a.key);expect(c.getSnapshot().attempts[0].state).toBe("APPLIED");expect(fixture.inspect().picked).toBe("1.000");c.dispose();});
it("reload loses token but receipt-only recovery preserves history",async()=>{const {c,fixture,scope,factory}=await setup();fixture.setFault("DROP_AFTER_COMMIT");await expect(c.submit(payload(c))).rejects.toThrow();const key=c.getSnapshot().attempts[0].key;c.dispose();const next=new FulfillmentCoordinator(scope,new AttemptStore(scope,factory),fixture.api,coordination(),"warehouse");await next.initialize();expect(next.getSnapshot().credentialAvailable).toBe(false);await expect(next.retry(key)).rejects.toThrow();await next.recover(key);expect(next.getSnapshot().attempts[0].state).toBe("APPLIED");expect(next.getSnapshot().status).toBe("PAUSED");next.dispose();});
it("absence without a fence never settles an unknown request",async()=>{const {c,fixture}=await setup();fixture.setFault("FAIL_BEFORE_PROCESSING");await expect(c.submit(payload(c))).rejects.toThrow();await c.recover(c.getSnapshot().attempts[0].key);expect(c.getSnapshot().status).toBe("OUTCOME_UNKNOWN");expect(fixture.inspect().calls).toBe(1);c.dispose();});
it("historical rejected receipt permits no counter-based inference",async()=>{const {c,fixture}=await setup();fixture.setFault("REJECT");await c.submit(payload(c));expect(c.getSnapshot().attempts[0].state).toBe("REJECTED");expect(fixture.inspect().picked).toBe("0.000");c.dispose();});
it("holds one order Web Lock and fails closed without coordination",async()=>{const {c,fixture,scope,factory,coord}=await setup();const other=new FulfillmentCoordinator(scope,new AttemptStore(scope,factory),fixture.api,coord,"warehouse");await expect(other.initialize()).rejects.toThrow();expect(other.getSnapshot().status).toBe("BLOCKED");other.dispose();const absent=new FulfillmentCoordinator(scope,new AttemptStore(scope,factory),fixture.api,{} as Coordination,"warehouse");await expect(absent.initialize()).rejects.toThrow();c.dispose();});
it("lost lifecycle result remains uncertain; evidence recovery never recreates token",async()=>{const {c,fixture}=await setup();const ctx=c.getSnapshot().context!;fixture.setFault("DROP_AFTER_COMMIT");await expect(c.lifecycle({kind:"RELEASE",mode:"UNVERIFIED",reason:"physical count incomplete",phase:ctx.phase,expectedEpoch:ctx.epoch,progressRevision:ctx.progressRevision})).rejects.toThrow();expect(c.getSnapshot().lifecyclePending).toBe(true);expect(c.getSnapshot().status).toBe("RECONCILIATION_REQUIRED");await c.recoverLifecycle();expect(c.getSnapshot().lifecyclePending).toBe(false);expect(c.getSnapshot().credentialAvailable).toBe(false);expect(c.getSnapshot().status).toBe("RECONCILIATION_REQUIRED");c.dispose();});
it("ignores late results after logout",async()=>{const {c,fixture}=await setup();let release!:()=>void;const original=fixture.api.submit;fixture.api.submit=async(a,t)=>{await new Promise<void>(r=>{release=r;});return original(a,t);};const pending=c.submit(payload(c));await vi.waitFor(()=>expect(release).toBeTypeOf("function"));c.logout();release();await expect(pending).rejects.toThrow();expect(c.getSnapshot()).toMatchObject({status:"SIGNED_OUT",attempts:[],credentialAvailable:false});});
it.each(["REQUIRED","CORRECTION_IN_PROGRESS","ESCALATED"] as const)("blocks ordinary work for %s",async status=>{const {c,fixture}=await setup();fixture.setReconciliation(status);await c.observeContext();await expect(c.submit(payload(c))).rejects.toThrow();expect(fixture.inspect().calls).toBe(0);c.dispose();});

it("correlated payload conflict remains blocked and cannot be retried or dismissed",async()=>{const {c,fixture}=await setup();fixture.api.submit=async a=>({kind:"PAYLOAD_CONFLICT",scope:a.scope,key:a.key,fingerprint:a.fingerprint,evidenceId:"synthetic-conflict"});await c.submit(payload(c));const a=c.getSnapshot().attempts[0];expect(a.state).toBe("CONFLICT");await expect(c.retry(a.key)).rejects.toThrow();await c.observeContext();expect(c.getSnapshot().attempts[0].state).toBe("CONFLICT");c.dispose();});
it("fenced absence after explicit takeover settles only the original actor's unmatched attempt",async()=>{const {c,fixture}=await setup();fixture.setFault("FAIL_BEFORE_PROCESSING");await expect(c.submit(payload(c))).rejects.toThrow();const key=c.getSnapshot().attempts[0].key;const scope={...c.scope,actor:2};const other=new FulfillmentCoordinator(scope,new AttemptStore(scope,new IDBFactory()),{...fixture.api,context:async s=>{const ctx=await fixture.api.context(s);return {...ctx,initialization:{...ctx.initialization,emptyJournalAuthorized:true}};}},coordination(),"admin");await other.initialize();const ctx=other.getSnapshot().context!;await other.lifecycle({kind:"TAKEOVER",phase:ctx.phase,expectedEpoch:ctx.epoch,progressRevision:ctx.progressRevision,reason:"supervised physical recovery",confirmed:true});await c.recover(key);expect(c.getSnapshot().attempts[0].state).toBe("NOT_APPLIED_FENCED");expect(c.getSnapshot().credentialAvailable).toBe(false);expect(c.getSnapshot().status).toBe("PAUSED");c.dispose();other.dispose();});
it("lost verified release remains unresolved until correlated lifecycle evidence",async()=>{const {c,fixture}=await setup();const ctx=c.getSnapshot().context!;fixture.setFault("DROP_AFTER_COMMIT");await expect(c.lifecycle({kind:"RELEASE",mode:"VERIFIED",confirmed:true,phase:ctx.phase,expectedEpoch:ctx.epoch,progressRevision:ctx.progressRevision,counts:[{allocation_id:1,picked:"0.000",packed:"0.000"}]})).rejects.toThrow();expect(c.getSnapshot().lifecyclePending).toBe(true);await c.observeContext();expect(c.getSnapshot().lifecyclePending).toBe(true);await c.recoverLifecycle();expect(c.getSnapshot().lifecyclePending).toBe(false);expect(c.getSnapshot().status).toBe("PAUSED");c.dispose();});
it("lost completion cannot be inferred from the changed phase",async()=>{const {c,fixture}=await setup();const ctx=c.getSnapshot().context!;fixture.setFault("DROP_AFTER_COMMIT");await expect(c.lifecycle({kind:"COMPLETE",phase:ctx.phase,expectedEpoch:ctx.epoch,progressRevision:ctx.progressRevision})).rejects.toThrow();expect(c.getSnapshot().context!.phase).toBe("PACK");expect(c.getSnapshot().lifecyclePending).toBe(true);await c.observeContext();expect(c.getSnapshot().lifecyclePending).toBe(true);c.dispose();});

/* WP-2 / D3: initialization lifecycle. Only the failed attempt's lock/channel/connection are released, exactly once. */
const SCOPE={deployment:SYNTHETIC_DEPLOYMENT,actor:1,order:101};
const tick=(ms=0)=>new Promise<void>(r=>setTimeout(r,ms));
const fakeChannel=()=>({postMessage:vi.fn<(message:unknown)=>void>(),close:vi.fn<()=>void>(),addEventListener:vi.fn<(type:string,listener:unknown)=>void>(),removeEventListener:vi.fn<(type:string,listener:unknown)=>void>()});
type FakeChannel=ReturnType<typeof fakeChannel>;
/** Resolves to the rejection of an expected-to-fail promise (fails the test if it resolves). */
const rejection=(p:Promise<unknown>)=>p.then(()=>{throw new Error("EXPECTED_REJECTION");},(e:unknown)=>e as Error);
/** Lock mock that counts acquisitions/releases; with asyncRelease the browser-side release lags behind the holder's settlement. */
function tracked(asyncRelease=false){
  const held=new Set<string>();const stats={acquired:0,released:0,refused:0,channels:[] as FakeChannel[]};
  const coord:Coordination={locks:{request:((name:string,_options:unknown,callback:(lock:Lock|null)=>Promise<void>|void)=>{
    if(held.has(name)){stats.refused++;return Promise.resolve(callback(null));}
    held.add(name);stats.acquired++;
    return Promise.resolve(callback({name,mode:"exclusive"} as Lock)).finally(()=>{const drop=()=>{held.delete(name);stats.released++;};if(asyncRelease)setTimeout(drop,10);else drop();});
  }) as LockManager["request"]},
  channel:()=>{const ch=fakeChannel();stats.channels.push(ch);return ch;}};
  return {coord,held,stats};
}
const internals=(c:FulfillmentCoordinator)=>c as unknown as {owned:boolean;releaseLock?:()=>void;channel?:unknown;initializing:boolean};
const connectionClosed=(s:AttemptStore)=>(s as unknown as {db?:IDBDatabase}).db===undefined;
function make(coord:Coordination,api=createFixtureBackend().api,factory=new IDBFactory()){const store=new AttemptStore(SCOPE,factory);return {c:new FulfillmentCoordinator(SCOPE,store,api,coord,"warehouse"),store};}
async function versionTwoFactory(){const f=new IDBFactory();await new Promise<void>((resolve,reject)=>{const r=f.open("r5-safe3-journal",2);r.onsuccess=()=>{r.result.close();resolve();};r.onerror=()=>reject(r.error);});return f;}
function expectAbandoned(c:FulfillmentCoordinator,store:AttemptStore,channel:FakeChannel){
  const i=internals(c);expect(i.owned).toBe(false);expect(i.releaseLock).toBeUndefined();expect(i.channel).toBeUndefined();expect(i.initializing).toBe(false);
  expect(connectionClosed(store)).toBe(true);expect(channel.removeEventListener).toHaveBeenCalledOnce();expect(channel.close).toHaveBeenCalled();
  expect(c.getSnapshot().status).toBe("BLOCKED");
}
type Api=ReturnType<typeof createFixtureBackend>["api"];
const failures:[string,()=>Promise<{api:Api;factory:IDBFactory}>][]=[
  ["store.open()",async()=>({api:createFixtureBackend().api,factory:await versionTwoFactory()})],
  ["transport.context()",async()=>{const f=createFixtureBackend();return {api:{...f.api,context:async()=>{throw new Error("NETWORK");}},factory:new IDBFactory()};}],
  ["store.initialize()",async()=>{const f=createFixtureBackend();return {api:{...f.api,context:async s=>{const ctx=await f.api.context(s);return {...ctx,initialization:{...ctx.initialization,emptyJournalAuthorized:false}};}},factory:new IDBFactory()};}],
  ["refresh()",async()=>{const f=createFixtureBackend();let n=0;return {api:{...f.api,context:async s=>{if(++n>1)throw new Error("NETWORK");return f.api.context(s);}},factory:new IDBFactory()};}],
];
it.each(failures)("failure after lock acquisition in %s releases exactly that lock and every resource, once",async(_point,arrange)=>{
  const {coord,held,stats}=tracked();const {api,factory}=await arrange();const {c,store}=make(coord,api,factory);
  await expect(c.initialize()).rejects.toThrow("INITIALIZATION_OR_OWNERSHIP_FAILED");
  await tick();expect(stats.acquired).toBe(1);expect(stats.released).toBe(1);expect(held.size).toBe(0);
  expectAbandoned(c,store,stats.channels[0]);
  await expect(c.submit({operation:"SCAN_PICK",phase:"PICK",epoch:0,barcode:"1",quantity:"1.000"})).rejects.toThrow("INPUT_GATE_CLOSED");
  const next=make(coord);await next.c.initialize();expect(next.c.getSnapshot().status).not.toBe("BLOCKED");expect(held.size).toBe(1);next.c.dispose();
});
it("a transient context failure allows a later initialize() on the same coordinator",async()=>{
  const {coord,held,stats}=tracked();const f=createFixtureBackend();let fail=true;
  const {c}=make(coord,{...f.api,context:async s=>{if(fail){fail=false;throw new Error("NETWORK");}return f.api.context(s);}});
  await expect(c.initialize()).rejects.toThrow();await tick();expect(held.size).toBe(0);
  await c.initialize();expect(c.getSnapshot().status).toBe("PAUSED");expect(internals(c).owned).toBe(true);
  expect(stats.acquired).toBe(2);expect(stats.released).toBe(1);expect(held.size).toBe(1);c.dispose();await tick();expect(held.size).toBe(0);
});
it("a genuine storage failure stays fail-closed on retry and never leaks the lock",async()=>{
  const {coord,held,stats}=tracked();const {c}=make(coord,createFixtureBackend().api,await versionTwoFactory());
  await expect(c.initialize()).rejects.toThrow();await expect(c.initialize()).rejects.toThrow();await tick();
  expect(stats.acquired).toBe(2);expect(stats.released).toBe(2);expect(held.size).toBe(0);expect(c.getSnapshot().status).toBe("BLOCKED");
});
it("concurrent initialize() is refused synchronously and the first attempt keeps its ownership",async()=>{
  const {coord,held,stats}=tracked();const {c}=make(coord);
  const first=c.initialize();await expect(c.initialize()).rejects.toThrow("ALREADY_INITIALIZED");await first;
  expect(stats.channels).toHaveLength(1);expect(stats.channels[0].close).not.toHaveBeenCalled();expect(internals(c).owned).toBe(true);expect(held.size).toBe(1);
  await expect(c.initialize()).rejects.toThrow("ALREADY_INITIALIZED");expect(held.size).toBe(1);c.dispose();
});
it("a losing tab releases nothing and never disturbs the owner",async()=>{
  const {coord,held,stats}=tracked();const fixture=createFixtureBackend();const factory=new IDBFactory();
  const winner=make(coord,fixture.api,factory);await winner.c.initialize();
  const loser=make(coord,fixture.api,factory);await expect(loser.c.initialize()).rejects.toThrow();await tick();
  expect(stats.refused).toBe(1);expect(stats.released).toBe(0);expect(held.size).toBe(1);
  expect(internals(winner.c).owned).toBe(true);expect(stats.channels[0].close).not.toHaveBeenCalled();expect(stats.channels[1].close).toHaveBeenCalled();
  expect(connectionClosed(winner.store)).toBe(false);await winner.c.observeContext();expect(winner.c.getSnapshot().status).toBe("PAUSED");winner.c.dispose();
});
it("dispose() during initialization releases the lock exactly once and leaves no ownership",async()=>{
  const {coord,held,stats}=tracked();const f=createFixtureBackend();let resume!:()=>void;
  const {c,store}=make(coord,{...f.api,context:s=>new Promise(r=>{resume=()=>r(f.api.context(s));})});
  const pending=c.initialize();await vi.waitFor(()=>expect(resume).toBeTypeOf("function"));
  c.dispose();resume();await expect(pending).rejects.toThrow();await tick();
  expect(stats.released).toBe(1);expect(held.size).toBe(0);expect(internals(c).owned).toBe(false);expect(internals(c).releaseLock).toBeUndefined();expect(connectionClosed(store)).toBe(true);
});
it("asynchronous browser lock release: an immediate new owner fails closed; after release it succeeds",async()=>{
  const {coord,held,stats}=tracked(true);const f=createFixtureBackend();
  const {c}=make(coord,{...f.api,context:async()=>{throw new Error("NETWORK");}});
  await expect(c.initialize()).rejects.toThrow();
  const early=make(coord);await expect(early.c.initialize()).rejects.toThrow();expect(stats.refused).toBe(1);expect(stats.released).toBe(0);
  await tick(30);expect(held.size).toBe(0);expect(stats.released).toBe(1);
  const later=make(coord);await later.c.initialize();expect(held.size).toBe(1);later.c.dispose();
});

/* WP-2 / D4: parsed-but-invalid evidence never settles; the attempt stays recoverable with the same key. */
const invalid:[string,(r:Record<string,unknown>)=>unknown][]=[
  ["wrong epoch",r=>({...r,epoch:(r.epoch as number)+1})],
  ["wrong key",r=>({...r,key:crypto.randomUUID()})],
  ["wrong fingerprint",r=>({...r,fingerprint:"0".repeat(64)})],
  ["wrong scope",r=>({...r,scope:{...(r.scope as object),actor:2}})],
  ["REJECTED with status 422",r=>({...r,outcome:"REJECTED",status:422})],
  ["uncorrelated payload conflict",r=>({kind:"PAYLOAD_CONFLICT",scope:r.scope,key:crypto.randomUUID(),fingerprint:r.fingerprint,evidenceId:"x"})],
  ["malformed body",()=>({unexpected:true})],
  ["null body",()=>null],
];
it.each(invalid)("invalid receipt (%s): OUTCOME_UNKNOWN, EVIDENCE_REJECTED, no new key, later valid recovery",async(_label,mutate)=>{
  const {c,fixture}=await setup();const real=fixture.api.submit;
  fixture.api.submit=async(a,t)=>mutate(await real(a,t) as unknown as Record<string,unknown>) as never;
  const err=await rejection(c.submit(payload(c)));
  expect(err.message).toBe("ACTION_UNRESOLVED");expect((err.cause as Error).message).toBe("EVIDENCE_REJECTED");
  const snap=c.getSnapshot();expect(snap.message).toBe("EVIDENCE_REJECTED");expect(snap.status).toBe("OUTCOME_UNKNOWN");
  const [a]=snap.attempts;expect(snap.attempts).toHaveLength(1);expect(a.state).toBe("OUTCOME_UNKNOWN");expect(a.evidence).toBeUndefined();
  expect(fixture.inspect().calls).toBe(1);
  await expect(c.submit(payload(c))).rejects.toThrow();expect(c.getSnapshot().attempts).toHaveLength(1);
  fixture.api.submit=real;await c.recover(a.key);
  const after=c.getSnapshot().attempts;expect(after).toHaveLength(1);expect(after[0].key).toBe(a.key);expect(after[0].state).toBe("APPLIED");
  expect(fixture.inspect().calls).toBe(1);expect(fixture.inspect().picked).toBe("1.000");c.dispose();
});
it("recover() with mismatched evidence leaves state and revision unchanged",async()=>{
  const {c,fixture}=await setup();fixture.setFault("DROP_AFTER_COMMIT");await expect(c.submit(payload(c))).rejects.toThrow();
  const before=c.getSnapshot().attempts[0];const real=fixture.api.recover;
  fixture.api.recover=async a=>({...(await real(a)),fingerprint:"0".repeat(64)}) as never;
  const err=await rejection(c.recover(before.key));expect((err.cause as Error).message).toBe("EVIDENCE_REJECTED");
  const now=c.getSnapshot().attempts[0];expect(now.state).toBe(before.state);expect(now.revision).toBe(before.revision);expect(c.getSnapshot().message).toBe("EVIDENCE_REJECTED");
  fixture.api.recover=real;await c.recover(before.key);expect(c.getSnapshot().attempts[0].state).toBe("APPLIED");expect(c.getSnapshot().message).toBeUndefined();c.dispose();
});
it("transport failure stays TRANSPORT_UNCERTAIN, distinct from evidence rejection",async()=>{
  const {c,fixture}=await setup();fixture.setFault("FAIL_BEFORE_PROCESSING");
  const err=await rejection(c.submit(payload(c)));expect((err.cause as Error).message).toBe("TRANSPORT_UNCERTAIN");
  expect(c.getSnapshot().message).toBe("TRANSPORT_UNCERTAIN");expect(c.getSnapshot().attempts[0].state).toBe("OUTCOME_UNKNOWN");expect(fixture.inspect().calls).toBe(1);c.dispose();
});

/* WP-3 B1 / D2a: same-session proven-unsent cancellation and conservative recovery after reload. */
type Internals={session:{clear():void};store:AttemptStore};
const moveSpy=(store:AttemptStore)=>vi.spyOn(store,"move");
it("Path A: credential lost before SENDING cancels the fresh attempt atomically; nothing was sent",async()=>{
  const {c,fixture,store}=await setup();const create=store.create.bind(store);
  vi.spyOn(store,"create").mockImplementationOnce(async a=>{const p=await create(a);(c as unknown as Internals).session.clear();return p;});
  const err=await rejection(c.submit(payload(c)));expect((err.cause as Error).message).toBe("CREDENTIAL_LOST");
  const s=await store.read();expect(s.attempts[0].state).toBe("CANCELLED_UNSENT");expect(s.gate.attempt).toBeUndefined();
  expect(fixture.inspect().calls).toBe(0);c.dispose();
});
it("Path A: an exact domain abort of the SENDING move cancels; a new action then gets a new key and applies once",async()=>{
  const {c,fixture,store}=await setup();const move=store.move.bind(store);
  vi.spyOn(store,"move").mockImplementationOnce((k,r,s,e)=>move(k,r+7,s,e));   // real STALE_REVISION abort
  const err=await rejection(c.submit(payload(c)));expect((err.cause as Error).message).toBe("STALE_REVISION");
  const s=await store.read();expect(s.attempts[0].state).toBe("CANCELLED_UNSENT");expect(s.gate.attempt).toBeUndefined();expect(fixture.inspect().calls).toBe(0);
  vi.restoreAllMocks();vi.stubGlobal("crypto",webcrypto);
  await c.submit(payload(c));const after=await store.read();expect(after.attempts).toHaveLength(2);
  expect(after.attempts.find(x=>x.state==="APPLIED")!.key).not.toBe(s.attempts[0].key);expect(fixture.inspect().calls).toBe(1);expect(fixture.inspect().picked).toBe("1.000");c.dispose();
});
it("no cancellation on an ambiguous storage failure of the SENDING move (handle poisoned, attempt stays gated)",async()=>{
  const {c,fixture,factory}=await setup();const original=IDBObjectStore.prototype.put;
  const spy=vi.spyOn(IDBObjectStore.prototype,"put").mockImplementation(function(this:IDBObjectStore,...args:Parameters<IDBObjectStore["put"]>){
    const v=args[0] as {value?:{state?:string}};if(this.name==="attempts" && v?.value?.state==="SENDING")throw new DOMException("io","UnknownError");return original.apply(this,args);});
  await expect(c.submit(payload(c))).rejects.toThrow();spy.mockRestore();expect(fixture.inspect().calls).toBe(0);c.dispose();
  const reopened=new AttemptStore(SCOPE,factory);await reopened.open();await reopened.initialize(await fixture.api.context(SCOPE));
  const s=await reopened.read();expect(s.attempts[0].state).toBe("OUTCOME_UNKNOWN");expect(s.gate.attempt).toBe(s.attempts[0].key);
});
it("negative control: once SENDING has committed, a failure never cancels (OUTCOME_UNKNOWN)",async()=>{
  const {c,fixture,store}=await setup();const spy=moveSpy(store);fixture.setFault("FAIL_BEFORE_PROCESSING");
  await expect(c.submit(payload(c))).rejects.toThrow();
  expect(spy.mock.calls.map(x=>x[2])).toEqual(["SENDING","OUTCOME_UNKNOWN"]);expect(spy.mock.calls.some(x=>x[2]==="CANCELLED_UNSENT")).toBe(false);
  expect((await store.read()).attempts[0].state).toBe("OUTCOME_UNKNOWN");c.dispose();
});
it("Path B: a recovered PERSISTED attempt becomes OUTCOME_UNKNOWN without any transport call, is never cancelled, and settles only by evidence",async()=>{
  const {c,fixture,store,factory}=await setup();const p=payload(c);const a=await store.create(await createAttempt(SCOPE,p));c.dispose();   // crash before dispatch
  const callsBefore=fixture.inspect().calls;
  const next=new FulfillmentCoordinator(SCOPE,new AttemptStore(SCOPE,factory),fixture.api,coordination(),"warehouse");await next.initialize();
  expect(fixture.inspect().calls).toBe(callsBefore);
  const snap=next.getSnapshot();expect(snap.attempts[0].key).toBe(a.key);expect(snap.attempts[0].state).toBe("OUTCOME_UNKNOWN");expect(snap.status).toBe("OUTCOME_UNKNOWN");
  await expect(next.retry(a.key)).rejects.toThrow();
  await next.recover(a.key);expect(next.getSnapshot().attempts[0].state).toBe("OUTCOME_UNKNOWN");   // ABSENT_NOT_FINAL keeps the gate
  await expect(next.submit({...p,epoch:next.getSnapshot().context!.epoch})).rejects.toThrow();expect(next.getSnapshot().attempts).toHaveLength(1);
  const admin={...SCOPE,actor:2};const other=new FulfillmentCoordinator(admin,new AttemptStore(admin,new IDBFactory()),{...fixture.api,context:async s=>{const ctx=await fixture.api.context(s);return {...ctx,initialization:{...ctx.initialization,emptyJournalAuthorized:true}};}},coordination(),"admin");
  await other.initialize();const ctx=other.getSnapshot().context!;
  await other.lifecycle({kind:"TAKEOVER",phase:ctx.phase,expectedEpoch:ctx.epoch,progressRevision:ctx.progressRevision,reason:"supervised recovery",confirmed:true});
  await next.recover(a.key);expect(next.getSnapshot().attempts[0].state).toBe("NOT_APPLIED_FENCED");
  expect(fixture.inspect().calls).toBe(callsBefore);expect(fixture.inspect().picked).toBe("0.000");next.dispose();other.dispose();
});

/* WP-3 B2-minimal / D2b (synthetic fixture only): recovered PERSISTED lifecycle intents. A crash is simulated by committing
   the intent (createLifecycle) and disposing before SENDING; "reached the server" = delivered while the journal said PERSISTED. */
type LifecycleKind=LifecyclePayload["kind"];
async function lifecycleSetup(kind:LifecycleKind){
  const fixture=createFixtureBackend();const factory=new IDBFactory();const store=new AttemptStore(SCOPE,factory);
  const deliver=fixture.api.lifecycle;let token:string|undefined;
  fixture.api.lifecycle=async(i,t)=>{const r=await deliver(i,t);if(r.token)token=r.token;return r;};
  const c=new FulfillmentCoordinator(SCOPE,store,fixture.api,coordination(),"warehouse");await c.initialize();
  if(kind==="RELEASE" || kind==="COMPLETE"){const ctx=c.getSnapshot().context!;await c.lifecycle({kind:"ACQUIRE",phase:ctx.phase,expectedEpoch:ctx.epoch,progressRevision:ctx.progressRevision});}
  const ctx=c.getSnapshot().context!;const base={phase:ctx.phase,expectedEpoch:ctx.epoch,progressRevision:ctx.progressRevision};
  const p:LifecyclePayload=kind==="TAKEOVER"?{kind,...base,reason:"resume after reload",confirmed:true}
    :kind==="RELEASE"?{kind,...base,mode:"VERIFIED",confirmed:true,counts:[{allocation_id:1,picked:"0.000",packed:"0.000"}]}:{kind,...base};
  const intent=await store.createLifecycle({scope:SCOPE,id:secureKey(),payload:p,fingerprint:await digest({scope:SCOPE,payload:p}),revision:0,state:"PERSISTED"});
  c.dispose();   // crash before the SENDING commit
  /** Delivers the original intent to the server as a request already in flight would (with the pre-crash credential). */
  const late=()=>deliver(intent,kind==="RELEASE" || kind==="COMPLETE"?token:undefined);
  const reload=async()=>{const journal=new AttemptStore(SCOPE,factory);const next=new FulfillmentCoordinator(SCOPE,journal,fixture.api,coordination(),"warehouse");await next.initialize();return {next,journal};};
  return {fixture,factory,intent,late,reload};
}
function adminFor(fixture:ReturnType<typeof createFixtureBackend>){
  const admin={...SCOPE,actor:2};
  return new FulfillmentCoordinator(admin,new AttemptStore(admin,new IDBFactory()),{...fixture.api,context:async s=>{const ctx=await fixture.api.context(s);return {...ctx,initialization:{...ctx.initialization,emptyJournalAuthorized:true}};}},coordination(),"admin");
}
async function adminTakeover(fixture:ReturnType<typeof createFixtureBackend>){
  const other=adminFor(fixture);await other.initialize();const ctx=other.getSnapshot().context!;
  await other.lifecycle({kind:"TAKEOVER",phase:ctx.phase,expectedEpoch:ctx.epoch,progressRevision:ctx.progressRevision,reason:"supervised recovery",confirmed:true});return other;
}
const KINDS=["ACQUIRE","TAKEOVER","RELEASE","COMPLETE"] as const;
it.each(KINDS)("never-sent PERSISTED %s: reload sends nothing, holds the gate, and server UNKNOWN keeps it blocked (negative control)",async kind=>{
  const {fixture,intent,reload}=await lifecycleSetup(kind);const before=fixture.inspect();const sent=vi.spyOn(fixture.api,"lifecycle");
  const {next,journal}=await reload();
  expect(sent).not.toHaveBeenCalled();expect(fixture.inspect().lifecycleCount).toBe(before.lifecycleCount);
  const snap=next.getSnapshot();expect(snap.lifecyclePending).toBe(true);expect(snap.status).toBe("OUTCOME_UNKNOWN");expect(snap.credentialAvailable).toBe(false);
  const s=await journal.read();const r=s.lifecycleIntents.find(i=>i.id===intent.id)!;
  expect(r.state).toBe("OUTCOME_UNKNOWN");expect(r.payload).toEqual(intent.payload);expect(r.scope).toEqual(SCOPE);expect(r.fingerprint).toBe(intent.fingerprint);expect(s.gate.lifecycle).toBe(intent.id);
  await next.recoverLifecycle();   // UNKNOWN: no evidence, so nothing settles
  expect(next.getSnapshot().lifecyclePending).toBe(true);expect((await journal.read()).gate.lifecycle).toBe(intent.id);
  const ctx=next.getSnapshot().context!;
  await expect(next.lifecycle({kind:"ACQUIRE",phase:ctx.phase,expectedEpoch:ctx.epoch,progressRevision:ctx.progressRevision})).rejects.toThrow();
  await expect(next.submit({operation:"SCAN_PICK",phase:ctx.phase,epoch:ctx.epoch,barcode:"00001",quantity:"1.000"})).rejects.toThrow();
  expect(sent).not.toHaveBeenCalled();expect(fixture.inspect()).toEqual(before);
  next.dispose();const {next:third,journal:j3}=await reload();expect((await j3.read()).lifecycleIntents.find(i=>i.id===intent.id)).toEqual(r);
  expect(third.getSnapshot().lifecyclePending).toBe(true);third.dispose();
});
it.each(KINDS)("PERSISTED %s that reached the server resolves after reload from correlated evidence only, once, without a credential",async kind=>{
  const {fixture,intent,late,reload}=await lifecycleSetup(kind);await late();const applied=fixture.inspect();
  const sent=vi.spyOn(fixture.api,"lifecycle");const {next,journal}=await reload();
  expect(next.getSnapshot().credentialAvailable).toBe(false);expect(next.getSnapshot().lifecyclePending).toBe(true);
  await next.recoverLifecycle();
  const s=await journal.read();const r=s.lifecycleIntents.find(i=>i.id===intent.id)!;
  expect(r.state).toBe("RESOLVED");expect(r.evidenceId).toBe(`synthetic-lifecycle-${intent.id}`);expect(s.gate.lifecycle).toBeUndefined();
  expect(next.getSnapshot().lifecyclePending).toBe(false);expect(next.getSnapshot().credentialAvailable).toBe(false);   // a token is never recreated
  expect(sent).not.toHaveBeenCalled();expect(fixture.inspect()).toEqual(applied);   // no duplicate side effect
  if(kind==="ACQUIRE" || kind==="TAKEOVER")expect(applied.holder).toBe(1);else expect(applied.holder).toBeNull();
  next.dispose();
});
it("late-arriving ACQUIRE after an UNKNOWN recovery: the client never concluded non-execution and resolves from the receipt",async()=>{
  const {fixture,intent,late,reload}=await lifecycleSetup("ACQUIRE");const {next,journal}=await reload();
  await next.recoverLifecycle();expect(next.getSnapshot().lifecyclePending).toBe(true);
  await late();expect(fixture.inspect().holder).toBe(1);   // the old request lands now
  await next.observeContext();expect(next.getSnapshot().lifecyclePending).toBe(true);expect(next.getSnapshot().credentialAvailable).toBe(false);
  await next.recoverLifecycle();expect((await journal.read()).lifecycleIntents.find(i=>i.id===intent.id)!.state).toBe("RESOLVED");
  expect(fixture.inspect().lifecycleCount).toBe(1);next.dispose();
});
it.each(["RELEASE","COMPLETE"] as const)("late-arriving %s after an admin fence is refused by the server; the intent stays OUTCOME_UNKNOWN (WP-5 dependency)",async kind=>{
  const {fixture,intent,late,reload}=await lifecycleSetup(kind);const {next,journal}=await reload();
  const other=await adminTakeover(fixture);const fenced=fixture.inspect();
  await expect(late()).rejects.toThrow("STALE_CONTEXT");expect(fixture.inspect()).toEqual(fenced);
  await next.recoverLifecycle();
  const s=await journal.read();expect(s.lifecycleIntents.find(i=>i.id===intent.id)!.state).toBe("OUTCOME_UNKNOWN");expect(s.gate.lifecycle).toBe(intent.id);
  expect(next.getSnapshot().lifecyclePending).toBe(true);expect(fixture.inspect().holder).toBe(2);next.dispose();other.dispose();
});
it("TAKEOVER conflict: a competing admin takeover wins; the late original is refused and stays unresolved",async()=>{
  const {fixture,intent,late,reload}=await lifecycleSetup("TAKEOVER");const {next,journal}=await reload();
  const other=await adminTakeover(fixture);
  await expect(late()).rejects.toThrow("STALE_CONTEXT");await next.recoverLifecycle();
  expect((await journal.read()).lifecycleIntents.find(i=>i.id===intent.id)!.state).toBe("OUTCOME_UNKNOWN");
  expect(fixture.inspect().holder).toBe(2);expect(fixture.inspect().lifecycleCount).toBe(1);next.dispose();other.dispose();
});
it.each([
  ["another intent id",(e:LifecycleEvidence)=>({...e,intentId:"00000000-0000-4000-8000-000000000000"})],
  ["another fingerprint",(e:LifecycleEvidence)=>({...e,fingerprint:"0".repeat(64)})],
  ["another actor scope",(e:LifecycleEvidence)=>({...e,scope:{...e.scope,actor:2}})],
  ["the expected (not newer) epoch",(e:LifecycleEvidence)=>({...e,epoch:0})],
] as const)("server evidence with %s never settles a recovered intent",async(_label,mutate)=>{
  const {fixture,intent,late,reload}=await lifecycleSetup("ACQUIRE");const real=await late();const {next,journal}=await reload();
  fixture.api.recoverLifecycle=async()=>mutate(real.evidence);
  const err=await rejection(next.recoverLifecycle());expect((err.cause as Error).message).toBe("EVIDENCE_MISMATCH");
  const s=await journal.read();expect(s.lifecycleIntents.find(i=>i.id===intent.id)!.state).toBe("OUTCOME_UNKNOWN");expect(s.gate.lifecycle).toBe(intent.id);next.dispose();
});
it("concurrent recovery settles exactly once",async()=>{
  const {fixture,intent,late,reload}=await lifecycleSetup("COMPLETE");await late();const {next,journal}=await reload();
  const moves=vi.spyOn(journal,"moveLifecycle");
  const results=await Promise.allSettled([next.recoverLifecycle(),next.recoverLifecycle()]);
  expect(results.map(r=>r.status).sort()).toEqual(["fulfilled","rejected"]);
  expect(moves.mock.calls.filter(x=>x[2]==="RESOLVED")).toHaveLength(1);
  expect((await journal.read()).lifecycleIntents.find(i=>i.id===intent.id)!.state).toBe("RESOLVED");expect(fixture.inspect().lifecycleCount).toBe(2);next.dispose();
});
it("storage failure while resolving stays fail-closed; a later reload resolves it once",async()=>{
  const {fixture,intent,late,reload}=await lifecycleSetup("RELEASE");await late();const {next}=await reload();const original=IDBObjectStore.prototype.put;
  const spy=vi.spyOn(IDBObjectStore.prototype,"put").mockImplementation(function(this:IDBObjectStore,...args:Parameters<IDBObjectStore["put"]>){
    const v=args[0] as {value?:{state?:string}};if(this.name==="lifecycleIntents" && v?.value?.state==="RESOLVED")throw new DOMException("io","UnknownError");return original.apply(this,args);});
  try {await expect(next.recoverLifecycle()).rejects.toThrow();} finally {spy.mockRestore();}next.dispose();
  const {next:again,journal}=await reload();const s=await journal.read();
  expect(s.lifecycleIntents.find(i=>i.id===intent.id)!.state).toBe("OUTCOME_UNKNOWN");expect(s.gate.lifecycle).toBe(intent.id);
  await again.recoverLifecycle();expect((await journal.read()).gate.lifecycle).toBeUndefined();expect(fixture.inspect().lifecycleCount).toBe(2);again.dispose();
});

/* WP-4 / D7 (synthetic only): cross-tab notifications. Not reachable in the single-order browser harness. */
const listenerOf=(ch:FakeChannel)=>ch.addEventListener.mock.calls.find(x=>x[0]==="message")![1] as (event:MessageEvent)=>void;
const message=(data:unknown)=>({data}) as MessageEvent;
it("ACTOR_LOGOUT disposes only a coordinator of the same deployment and actor, and releases its order lock",async()=>{
  const {coord,held,stats}=tracked();const {c}=make(coord);await c.initialize();expect(internals(c).owned).toBe(true);
  const deliver=listenerOf(stats.channels[0]);
  deliver(message({kind:"ACTOR_LOGOUT",deployment:SCOPE.deployment,actor:SCOPE.actor+1}));
  deliver(message({kind:"ACTOR_LOGOUT",deployment:"ANOTHER-DEPLOYMENT",actor:SCOPE.actor}));
  deliver(message({kind:"JOURNAL_CHANGED",deployment:SCOPE.deployment,order:SCOPE.order}));
  expect(c.getSnapshot().status).not.toBe("SIGNED_OUT");expect(internals(c).owned).toBe(true);expect(held.size).toBe(1);
  deliver(message({kind:"ACTOR_LOGOUT",deployment:SCOPE.deployment,actor:SCOPE.actor}));
  expect(c.getSnapshot().status).toBe("SIGNED_OUT");expect(internals(c).owned).toBe(false);expect(stats.channels[0].close).toHaveBeenCalled();
  await tick();expect(held.size).toBe(0);expect(stats.released).toBe(1);
  await expect(c.submit({operation:"SCAN_PICK",phase:"PICK",epoch:0,barcode:"00001",quantity:"1.000"})).rejects.toThrow("INPUT_GATE_CLOSED");
});
it("JOURNAL_CHANGED is advisory: it never unlocks a blocked order or settles an unknown attempt",async()=>{
  const fixture=createFixtureBackend();const {coord,stats}=tracked();const {c,store}=make(coord,fixture.api);await c.initialize();
  const ctx=c.getSnapshot().context!;await c.lifecycle({kind:"ACQUIRE",phase:ctx.phase,expectedEpoch:ctx.epoch,progressRevision:ctx.progressRevision});
  fixture.setFault("FAIL_BEFORE_PROCESSING");await expect(c.submit(payload(c))).rejects.toThrow();
  const before=await store.read();expect(before.attempts[0].state).toBe("OUTCOME_UNKNOWN");
  listenerOf(stats.channels[0])(message({kind:"JOURNAL_CHANGED",deployment:SCOPE.deployment,order:SCOPE.order}));await tick();
  const after=await store.read();expect(after).toEqual(before);expect(c.getSnapshot().status).toBe("OUTCOME_UNKNOWN");expect(fixture.inspect().picked).toBe("0.000");
  c.dispose();
});
