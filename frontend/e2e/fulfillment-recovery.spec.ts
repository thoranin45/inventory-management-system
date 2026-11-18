import { test,expect } from "@playwright/test";

test("real IndexedDB, Web Locks and lost-response reload recovery remain isolated",async({browser})=>{
  const context=await browser.newContext();
  const unexpected:string[]=[];
  await context.route("**/*",route=>{const u=new URL(route.request().url());if(u.origin!=="http://127.0.0.1:5087"){unexpected.push(u.origin);return route.abort();}return route.continue();});
  const page=await context.newPage();
  await page.goto("http://127.0.0.1:5087");
  await expect(page.getByText("SIMULATION — no live inventory changes")).toBeVisible();
  await page.getByText("Authorize synthetic session").click();
  await page.getByRole("button",{name:"Acquire claim",exact:true}).click();
  await expect(page.getByText("Ready for a new physical action")).toBeVisible();
  const other=await context.newPage();await other.goto("http://127.0.0.1:5087");await other.getByText("Authorize synthetic session").click();await expect(other.getByText("Fulfillment blocked. Preserve the evidence and contact an Admin.")).toBeVisible();await other.close();
  await page.getByLabel("Next synthetic response").selectOption("DROP_AFTER_COMMIT");
  await page.getByLabel("Barcode",{exact:true}).fill("00001234");await page.getByLabel("This is a new physical action").check();await page.getByLabel("Barcode",{exact:true}).press("Enter");
  await expect(page.getByText("OUTCOME_UNKNOWN",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Refresh current progress (does not settle attempts)",exact:true}).click();await expect(page.getByRole("button",{name:"Scan",exact:true})).toBeDisabled();
  const persisted=await page.evaluate(async()=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open("r5-safe3-journal",1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});const data=await new Promise<unknown[]>((resolve,reject)=>{const t=db.transaction("attempts");const r=t.objectStore("attempts").getAll();t.oncomplete=()=>resolve(r.result);t.onabort=()=>reject(t.error);});db.close();return JSON.stringify(data);});
  expect(persisted).toContain("00001234");expect(persisted).toContain("OUTCOME_UNKNOWN");expect(persisted).not.toMatch(/claim.token|credential|bearer/i);
  const before=JSON.parse(persisted)[0].value;
  await page.reload();await page.getByText("Authorize synthetic session").click();await expect(page.getByRole("button",{name:"Retry identical request",exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"Observe authoritative receipt",exact:true}).click();await expect(page.getByText("APPLIED",{exact:true})).toBeVisible();await expect(page.getByText(before.key,{exact:true})).toBeVisible();await expect(page.getByRole("button",{name:"Scan",exact:true})).toBeDisabled();
  await page.getByLabel("Language").selectOption("th");await page.getByLabel("Theme").selectOption("dark");await page.setViewportSize({width:390,height:844});await expect(page.locator("main")).toHaveAttribute("lang","th");await expect(page.locator("main")).toHaveAttribute("data-theme","dark");expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await context.setOffline(true);await expect(page.getByText("ออฟไลน์ — ไม่อนุญาตให้เปลี่ยนแปลงข้อมูล")).toBeVisible();await context.setOffline(false);
  // Erasure cannot manufacture authorization: a new browser profile sees no local rows,
  // but the synthetic server remembers lifecycle/receipt history and refuses initialization.
  const fresh=await browser.newContext();const erased=await fresh.newPage();await erased.goto("http://127.0.0.1:5087");await erased.getByText("Authorize synthetic session").click();await expect(erased.getByRole("button",{name:"Scan",exact:true})).toBeDisabled();await expect(erased.getByText("Fulfillment blocked. Preserve the evidence and contact an Admin.")).toBeVisible();
  expect(unexpected).toEqual([]);await fresh.close();await context.close();
});

/* WP-4 / D7: isolated browser scenarios against the synthetic fixture (simulation only).
   Each test starts from a guarded fixture reset (O-3). The reset needs R5_SAFE3_E2E_FIXTURE_RESET: a fresh random
   64-hex token per run, inherited by the Vite web server. It is never printed. Its boundary is checked twice before
   any reset: server-side by the fixture (sole request in flight) and client-side here (one worker, no open browser
   context, exact continuity of the fixture history). Storage faults below are injected; none of this is a crash or
   disk-durability test. */
import type { APIRequestContext, Browser, BrowserContext, Page } from "@playwright/test";
import http from "node:http";
import { appendFileSync } from "node:fs";
import path from "node:path";

const RESET_TOKEN=process.env.R5_SAFE3_E2E_FIXTURE_RESET??"";
const EVIDENCE_DIR=process.env.R5_SAFE3_E2E_EVIDENCE_DIR;
type FixtureHistory={counts:{calls:number;picked:string;packed:string;epoch:number;holder:number|null;receiptCount:number;lifecycleCount:number};receipts:{key:string;outcome?:string;fingerprint?:string;evidenceId?:string;epoch?:number}[];lifecycle:{intentId:string;operation:string;epoch:number;evidenceId:string}[]};
type HistoryView={generation:number;inFlight:number;fixture:FixtureHistory};
const EMPTY:FixtureHistory={counts:{calls:0,picked:"0.000",packed:"0.000",epoch:0,holder:null,receiptCount:0,lifecycleCount:0},receipts:[],lifecycle:[]};
const HARNESS="http://127.0.0.1:5087";
let lastEnd:HistoryView|undefined;

async function rpc(request:APIRequestContext,action:string,extra:object={}) {const r=await request.post("/__simulation",{data:{action,...extra}});return {status:r.status(),body:await r.json()};}
async function history(request:APIRequestContext):Promise<HistoryView> {const r=await rpc(request,"history",{confirm:RESET_TOKEN});expect(r.status).toBe(200);return r.body as HistoryView;}
function record(title:string,phase:string,view:unknown) {if(EVIDENCE_DIR)appendFileSync(path.join(EVIDENCE_DIR,"fixture-history.jsonl"),JSON.stringify({test:title,phase,view})+"\n");}
async function open(context:BrowserContext) {const page=await context.newPage();await page.goto(HARNESS);await page.getByText("Authorize synthetic session").click();return page;}
async function acquire(page:Page) {await page.getByRole("button",{name:"Acquire claim",exact:true}).click();await expect(page.getByText("Ready for a new physical action")).toBeVisible();}
async function nextResponse(page:Page,value:string) {
  await Promise.all([page.waitForResponse(r=>r.url().endsWith("/__simulation") && (r.request().postData()??"").includes('"fault"')),page.getByLabel("Next synthetic response").selectOption(value)]);
}
async function scan(page:Page,barcode:string) {await page.getByLabel("Barcode",{exact:true}).fill(barcode);await page.getByLabel("This is a new physical action").check();await page.getByLabel("Barcode",{exact:true}).press("Enter");}
/** Reads the real IndexedDB journal (only after the app has opened it, so the schema exists). */
async function journal(page:Page) {
  return page.evaluate(async()=>{
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open("r5-safe3-journal",1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const all=async(name:string)=>db.objectStoreNames.contains(name)?new Promise<{value:Record<string,unknown>}[]>((resolve,reject)=>{const t=db.transaction(name);const q=t.objectStore(name).getAll();t.oncomplete=()=>resolve(q.result);t.onabort=()=>reject(t.error);}):[];
    const out={attempts:await all("attempts"),lifecycleIntents:await all("lifecycleIntents"),orderGates:await all("orderGates"),metadata:await all("metadata")};db.close();return out;
  });
}
/** Injected storage fault (NOT a crash): the next journal write moving `store` rows to SENDING throws. */
async function failSendingWrite(page:Page,store:"attempts"|"lifecycleIntents") {
  await page.evaluate(name=>{const original=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(this:IDBObjectStore,...args:Parameters<IDBObjectStore["put"]>){const row=args[0] as {value?:{state?:string}};if(this.name===name && row?.value?.state==="SENDING")throw new DOMException("WP-4 injected storage fault","UnknownError");return original.apply(this,args);};},store);
}
const contexts=(browser:Browser)=>browser.contexts();

test.describe("WP-4 isolated scenarios (guarded fixture reset per test)",()=>{
  test.describe.configure({mode:"serial"});
  test.beforeEach(async({browser,request},testInfo)=>{
    expect(testInfo.config.workers).toBe(1);
    expect(/^[a-f0-9]{64}$/.test(RESET_TOKEN),"R5_SAFE3_E2E_FIXTURE_RESET must be a fresh lowercase 64-hex token").toBe(true);
    expect(contexts(browser)).toHaveLength(0);
    const before=await history(request);expect(before.inFlight).toBe(1);
    if(lastEnd===undefined){
      // The original test above ran first against a pristine server: ACQUIRE, then one lost-response scan recovered from its receipt.
      expect(before.generation).toBe(0);
      expect(before.fixture.counts).toEqual({calls:1,picked:"1.000",packed:"0.000",epoch:1,holder:1,receiptCount:1,lifecycleCount:1});
      expect(before.fixture.receipts).toHaveLength(1);expect(before.fixture.receipts[0]).toMatchObject({outcome:"APPLIED",epoch:1});
      expect(before.fixture.lifecycle).toEqual([expect.objectContaining({operation:"ACQUIRE",epoch:1})]);
    } else expect(before).toEqual({...lastEnd,inFlight:1});
    record(testInfo.title,"before-reset",before);await testInfo.attach("fixture-history-before-reset",{body:JSON.stringify(before.fixture,null,2),contentType:"application/json"});
    const reset=await rpc(request,"reset",{confirm:RESET_TOKEN});
    expect(reset.status).toBe(200);expect(reset.body.previous).toEqual(before.fixture);expect(reset.body.generation).toBe(before.generation+1);
    const after=await history(request);expect(after.fixture).toEqual(EMPTY);expect(after.generation).toBe(before.generation+1);
  });
  test.afterEach(async({browser,request},testInfo)=>{
    for(const context of contexts(browser))await context.close();   // contexts left by a failed test; never a reset
    lastEnd=await history(request);record(testInfo.title,"after-test",lastEnd);
  });

  test("E2 lost response: the scan is applied exactly once and settles only from its correlated receipt",async({browser,request})=>{
    const context=await browser.newContext();
    try {
      const page=await open(context);await acquire(page);const start=(await history(request)).fixture;
      await nextResponse(page,"DROP_AFTER_COMMIT");await scan(page,"00004242");
      await expect(page.getByText("OUTCOME_UNKNOWN",{exact:true})).toBeVisible();
      const applied=(await history(request)).fixture;
      expect(applied.counts).toEqual({...start.counts,calls:start.counts.calls+1,picked:"1.000",receiptCount:start.counts.receiptCount+1});
      const row=(await journal(page)).attempts[0].value as {key:string;fingerprint:string;state:string};expect(row.state).toBe("OUTCOME_UNKNOWN");
      expect(applied.receipts).toEqual([expect.objectContaining({key:row.key,fingerprint:row.fingerprint,outcome:"APPLIED"})]);
      await page.reload();await page.getByText("Authorize synthetic session").click();
      await expect(page.getByRole("button",{name:"Retry identical request",exact:true})).toBeDisabled();
      await page.getByRole("button",{name:"Observe authoritative receipt",exact:true}).click();
      await expect(page.getByText("APPLIED",{exact:true})).toBeVisible();await expect(page.getByText(row.key,{exact:true})).toBeVisible();
      expect((await history(request)).fixture).toEqual(applied);   // recovery observed the receipt; nothing applied again
      expect(((await journal(page)).attempts[0].value as {state:string}).state).toBe("APPLIED");
    } finally {await context.close();}
  });

  test("E3 a REJECTED receipt changes no stock",async({browser,request})=>{
    const context=await browser.newContext();
    try {
      const page=await open(context);await acquire(page);const start=(await history(request)).fixture;
      await nextResponse(page,"REJECT");await scan(page,"00004343");
      await expect(page.getByText("REJECTED",{exact:true})).toBeVisible();
      const end=(await history(request)).fixture;
      expect(end.counts).toEqual({...start.counts,calls:start.counts.calls+1,receiptCount:start.counts.receiptCount+1});expect(end.counts.picked).toBe("0.000");
      expect(end.receipts).toEqual([expect.objectContaining({outcome:"REJECTED"})]);
    } finally {await context.close();}
  });

  test("E4 ABSENT_NOT_FINAL keeps the attempt unresolved and the input gate closed",async({browser,request})=>{
    const context=await browser.newContext();
    try {
      const page=await open(context);await acquire(page);const start=(await history(request)).fixture;
      await nextResponse(page,"FAIL_BEFORE_PROCESSING");await scan(page,"00004444");
      await expect(page.getByText("OUTCOME_UNKNOWN",{exact:true})).toBeVisible();
      await page.getByRole("button",{name:"Observe authoritative receipt",exact:true}).click();
      await expect(page.getByText("OUTCOME_UNKNOWN",{exact:true})).toBeVisible();await expect(page.getByLabel("Barcode",{exact:true})).toBeDisabled();
      const end=(await history(request)).fixture;
      expect(end.counts).toEqual({...start.counts,calls:start.counts.calls+1});expect(end.receipts).toEqual([]);
      const gate=(await journal(page)).orderGates[0].value as {attempt?:string};expect(gate.attempt).toBeTruthy();
    } finally {await context.close();}
  });

  test("E5 PERSISTED attempt (injected storage fault) becomes OUTCOME_UNKNOWN after reload, same key, never sent",async({browser,request})=>{
    const context=await browser.newContext();
    try {
      const page=await open(context);await acquire(page);const start=(await history(request)).fixture;
      await failSendingWrite(page,"attempts");await scan(page,"00004545");
      await expect(page.getByRole("alert")).toBeVisible();
      const persisted=(await journal(page)).attempts[0].value as {key:string;state:string;fingerprint:string};expect(persisted.state).toBe("PERSISTED");
      await page.reload();await page.getByText("Authorize synthetic session").click();
      await expect(page.getByText("OUTCOME_UNKNOWN",{exact:true})).toBeVisible();await expect(page.getByText(persisted.key,{exact:true})).toBeVisible();
      const recovered=await journal(page);const row=recovered.attempts[0].value as {key:string;state:string;fingerprint:string};
      expect(recovered.attempts).toHaveLength(1);expect(row).toMatchObject({key:persisted.key,fingerprint:persisted.fingerprint,state:"OUTCOME_UNKNOWN"});
      expect((recovered.orderGates[0].value as {attempt?:string}).attempt).toBe(persisted.key);
      await expect(page.getByRole("button",{name:"Retry identical request",exact:true})).toBeDisabled();await expect(page.getByLabel("Barcode",{exact:true})).toBeDisabled();
      expect((await history(request)).fixture).toEqual(start);   // never dispatched
    } finally {await context.close();}
  });

  test("E6 PERSISTED lifecycle intent (injected storage fault) keeps its identity and gate after reload; UNKNOWN never releases it",async({browser,request})=>{
    const context=await browser.newContext();
    try {
      const page=await open(context);const start=(await history(request)).fixture;
      await failSendingWrite(page,"lifecycleIntents");await page.getByRole("button",{name:"Acquire claim",exact:true}).click();
      await expect(page.getByRole("alert")).toBeVisible();
      const persisted=(await journal(page)).lifecycleIntents[0].value as {id:string;state:string;fingerprint:string;payload:{kind:string}};
      expect(persisted).toMatchObject({state:"PERSISTED",payload:{kind:"ACQUIRE"}});
      await page.reload();await page.getByText("Authorize synthetic session").click();
      await expect(page.getByText("A claim action (acquire, takeover, release or phase completion) has an unknown outcome. This does not prove it happened or did not happen.")).toBeVisible();
      const recovered=await journal(page);const row=recovered.lifecycleIntents[0].value as typeof persisted;
      expect(row).toMatchObject({id:persisted.id,fingerprint:persisted.fingerprint,state:"OUTCOME_UNKNOWN",payload:persisted.payload});
      expect((recovered.orderGates[0].value as {lifecycle?:string}).lifecycle).toBe(persisted.id);
      await page.getByRole("button",{name:"Observe lifecycle evidence",exact:true}).click();
      await expect(page.getByRole("button",{name:"Observe lifecycle evidence",exact:true})).toBeVisible();
      expect(((await journal(page)).orderGates[0].value as {lifecycle?:string}).lifecycle).toBe(persisted.id);
      await expect(page.getByRole("button",{name:"Acquire claim",exact:true})).toBeDisabled();
      expect((await history(request)).fixture).toEqual(start);   // never sent: no lifecycle record, epoch unchanged
    } finally {await context.close();}
  });

  test("E7 the order Web Lock is released when the owning tab closes",async({browser})=>{
    const context=await browser.newContext();
    try {
      const owner=await open(context);await expect(owner.getByRole("button",{name:"Acquire claim",exact:true})).toBeEnabled();
      const second=await open(context);await expect(second.getByText("Fulfillment blocked. Preserve the evidence and contact an Admin.")).toBeVisible();
      await owner.close();
      await second.reload();await second.getByText("Authorize synthetic session").click();
      await expect(second.getByRole("button",{name:"Acquire claim",exact:true})).toBeEnabled();await expect(second.getByText("Fulfillment blocked. Preserve the evidence and contact an Admin.")).toHaveCount(0);
    } finally {await context.close();}
  });

  test("E8 sign-out ends work in the tab and releases ownership for another tab",async({browser,request})=>{
    const context=await browser.newContext();
    try {
      const page=await open(context);await acquire(page);const held=(await history(request)).fixture;
      await page.getByRole("button",{name:"Sign out",exact:true}).click();
      await expect(page.getByText("Signed out. No further work is possible in this tab.")).toBeVisible();await expect(page.getByLabel("Barcode",{exact:true})).toHaveCount(0);
      const next=await open(context);
      await expect(next.getByText("Paused — claim credential is absent or invalid. Recovery or explicit takeover is required.")).toBeVisible();
      await expect(next.getByText("Fulfillment blocked. Preserve the evidence and contact an Admin.")).toHaveCount(0);
      expect((await history(request)).fixture).toEqual(held);   // sign-out is local; it never mutates the server
    } finally {await context.close();}
  });

  test("N1 non-empty server history still blocks an unauthorized empty journal, which writes nothing",async({browser,request})=>{
    const first=await browser.newContext();const fresh=await browser.newContext();
    try {
      await acquire(await open(first));const before=(await history(request)).fixture;expect(before.counts.lifecycleCount).toBe(1);
      const erased=await open(fresh);
      await expect(erased.getByText("Fulfillment blocked. Preserve the evidence and contact an Admin.")).toBeVisible();await expect(erased.getByLabel("Barcode",{exact:true})).toBeDisabled();
      const local=await journal(erased);expect(local.metadata).toEqual([]);expect(local.attempts).toEqual([]);expect(local.orderGates).toEqual([]);
      expect((await history(request)).fixture).toEqual(before);
    } finally {await fresh.close();await first.close();}
  });

  test("N2 a reset with a missing, malformed or wrong token is refused and changes nothing",async({request})=>{
    const before=await history(request);
    const wrong=(RESET_TOKEN[0]==="0"?"1":"0")+RESET_TOKEN.slice(1);
    const attempts:object[]=[{},{confirm:""},{confirm:"not-a-token"},{confirm:RESET_TOKEN.slice(1)},{confirm:wrong},...(RESET_TOKEN.toUpperCase()!==RESET_TOKEN?[{confirm:RESET_TOKEN.toUpperCase()}]:[])];
    for(const extra of attempts){const r=await rpc(request,"reset",extra);expect(r.status).toBe(403);expect(r.body).toEqual({error:"RESET_REFUSED"});}
    expect((await rpc(request,"history",{})).status).toBe(403);
    const after=await history(request);expect(after).toEqual(before);
  });

  test("N4 a reset is refused while another fixture request is still in flight",async({request})=>{
    const body=JSON.stringify({action:"inspect"});
    const pending=http.request({host:"127.0.0.1",port:5087,path:"/__simulation",method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(body)}});
    const answered=new Promise<{status:number;text:string}>((resolve,reject)=>{pending.on("response",r=>{let text="";r.on("data",c=>{text+=c;});r.on("end",()=>resolve({status:r.statusCode??0,text}));});pending.on("error",reject);});
    pending.write(body.slice(0,5));
    let held:HistoryView|undefined;
    for(let i=0;i<50 && !held;i++){const view=await history(request);if(view.inFlight===2)held=view;else await new Promise(r=>setTimeout(r,100));}
    expect(held,"the partial request must be observed in flight before the reset is attempted").toBeDefined();
    const refused=await rpc(request,"reset",{confirm:RESET_TOKEN});expect(refused.status).toBe(409);expect(refused.body).toEqual({error:"RESET_NOT_QUIESCENT"});
    expect((await history(request)).fixture).toEqual(held!.fixture);
    pending.end(body.slice(5));const done=await answered;expect(done.status).toBe(200);expect(JSON.parse(done.text)).toEqual(held!.fixture.counts);   // same instance
    const quiet=await history(request);expect(quiet.inFlight).toBe(1);expect(quiet.generation).toBe(held!.generation);
    const reset=await rpc(request,"reset",{confirm:RESET_TOKEN});expect(reset.status).toBe(200);expect(reset.body.previous).toEqual(held!.fixture);
  });
});
