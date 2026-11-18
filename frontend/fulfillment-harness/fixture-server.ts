import { timingSafeEqual } from "node:crypto";
import type { Plugin } from "vite";
import { contextSchema, lifecycleEvidenceSchema, payloadSchema, sameScope, scopeKey, type Attempt, type Context, type Evidence, type LifecyclePayload, type Scope } from "../src/lib/fulfillment/contracts";
import { canonical, digest } from "../src/lib/fulfillment/attempt";
import type { FulfillmentTransport } from "../src/lib/fulfillment/transport";
import { validateRelease } from "../src/lib/fulfillment/coordinator";

export const SYNTHETIC_DEPLOYMENT="SIMULATION-R5-SAFE3-NO-LIVE-INVENTORY";
export function createFixtureBackend() {
  let epoch=0;let holder:number|null=null;let token:string|undefined;let picked="0.000";let packed="0.000";let phase:"PICK"|"PACK"="PICK";let revision=0;
  let reconciliation:Context["reconciliation"]="CLEAR";
  let fault:"NONE"|"DROP_AFTER_COMMIT"|"FAIL_BEFORE_PROCESSING"|"REJECT"="NONE";
  let calls=0;
  const receipts=new Map<string,Evidence>();const lifecycle=new Map<string,{evidence:ReturnType<typeof lifecycleEvidenceSchema.parse>;scope:Scope;operation:LifecyclePayload["kind"]}>();
  const receiptKey=(a:Attempt)=>JSON.stringify([a.scope.order,a.key]);
  const check=(s:Scope)=>{if(s.deployment!==SYNTHETIC_DEPLOYMENT || s.order!==101 || ![1,2].includes(s.actor))throw new Error("SYNTHETIC_SCOPE_REQUIRED");};
  const context=(scope:Scope):Context=>{check(scope);return contextSchema.parse({scope,phase,epoch,holder,reconciliation,progressRevision:String(revision),allocations:[{id:1,allocated:"999999999999999.999",picked,packed}],initialization:{kind:"SIMULATION_AUTHORIZATION",evidenceId:"synthetic-context",journalRecoveryChecked:true,emptyJournalAuthorized:receipts.size===0&&lifecycle.size===0}});};
  const authorize=(s:Scope,e:number,t:string|undefined)=>{check(s);if(holder!==s.actor||e!==epoch||!token||t!==token)throw new Error("CLAIM_FENCED");if(reconciliation!=="CLEAR")throw new Error("RECONCILIATION_REQUIRED");};
  const api:FulfillmentTransport={boundary:"SIMULATION_ONLY",
    async context(scope){return context(scope);},
    async validate(scope,e,t){authorize(scope,e,t);return context(scope);},
    async submit(attempt,credential){
      check(attempt.scope);calls++;const mode=fault;fault="NONE";
      if(mode==="FAIL_BEFORE_PROCESSING")throw new Error("SIMULATED_TRANSPORT_FAILURE");
      const prior=receipts.get(receiptKey(attempt));
      if(prior){if(!sameScope(prior.scope,attempt.scope)||prior.fingerprint!==attempt.fingerprint)throw new Error("CONFLICT");return {...prior,...(prior.kind==="RECORDED"?{historical:true,replayed:true}:{})};}
      authorize(attempt.scope,attempt.payload.epoch,credential);payloadSchema.parse(attempt.payload);
      if(attempt.payload.phase!==phase)throw new Error("WRONG_PHASE");
      const rejected=mode==="REJECT";
      if(!rejected){
        const current=phase==="PICK"?picked:packed;const delta=BigInt(attempt.payload.quantity.replace(".",""))*(attempt.payload.operation.startsWith("UNDO")?-1n:1n);
        const next=BigInt(current.replace(".",""))+delta;if(next<0n||next>999999999999999999n)throw new Error("SIMULATED_BOUNDS");
        const str=next.toString().padStart(4,"0");const value=`${str.slice(0,-3)}.${str.slice(-3)}`;if(phase==="PICK")picked=value;else packed=value;revision++;
      }
      const receipt:Evidence={kind:"RECORDED",scope:attempt.scope,key:attempt.key,fingerprint:attempt.fingerprint,outcome:rejected?"REJECTED":"APPLIED",epoch:attempt.payload.epoch,historical:false,replayed:false,recordedAt:new Date().toISOString(),evidenceId:`synthetic-receipt-${attempt.key}`,status:rejected?409:200};
      receipts.set(receiptKey(attempt),receipt);
      if(mode==="DROP_AFTER_COMMIT")throw new Error("SIMULATED_RESPONSE_LOSS");
      return receipt;
    },
    async recover(attempt){
      check(attempt.scope);const prior=receipts.get(receiptKey(attempt));
      if(prior){if(!sameScope(prior.scope,attempt.scope)||prior.fingerprint!==attempt.fingerprint)throw new Error("ACTOR_OR_PAYLOAD_MISMATCH");return {...prior,...(prior.kind==="RECORDED"?{historical:true,replayed:true}:{})};}
      if(epoch>attempt.payload.epoch)return {kind:"ABSENT_FENCED",scope:attempt.scope,key:attempt.key,fingerprint:attempt.fingerprint,fencedEpoch:epoch,evidenceId:"synthetic-fence",allMutationPathsFenced:true};
      return {kind:"ABSENT_NOT_FINAL"};
    },
    async lifecycle(intent,credential){
      check(intent.scope);const mode=fault;fault="NONE";
      if(mode==="FAIL_BEFORE_PROCESSING")throw new Error("SIMULATED_TRANSPORT_FAILURE");
      if(lifecycle.has(intent.id))throw new Error("LIFECYCLE_RETRY_FORBIDDEN");
      const p=intent.payload;
      if(p.expectedEpoch!==epoch||p.progressRevision!==String(revision)||p.phase!==phase||reconciliation!=="CLEAR")throw new Error("STALE_CONTEXT");
      if(p.kind==="ACQUIRE"||p.kind==="TAKEOVER"){
        if(p.kind==="ACQUIRE"&&holder!==null)throw new Error("HELD");
        if(p.kind==="TAKEOVER"&&(!p.confirmed||!p.reason?.trim()||(holder!==null&&holder!==intent.scope.actor&&intent.scope.actor!==2)))throw new Error("FORBIDDEN");
        epoch++;holder=intent.scope.actor;token=crypto.randomUUID().replaceAll("-","")+crypto.randomUUID().replaceAll("-","").slice(0,11);
      }else{
        authorize(intent.scope,epoch,credential);
        if(p.kind==="RELEASE"){validateRelease(p,context(intent.scope));if(p.mode==="UNVERIFIED")reconciliation="REQUIRED";}
        if(p.kind==="COMPLETE")phase=phase==="PICK"?"PACK":"PICK";
        holder=null;token=undefined;epoch++;
      }
      revision++;
      const evidence=lifecycleEvidenceSchema.parse({scope:intent.scope,intentId:intent.id,fingerprint:intent.fingerprint,kind:"LIFECYCLE_RECORDED",evidenceId:`synthetic-lifecycle-${intent.id}`,epoch});
      lifecycle.set(intent.id,{evidence,scope:intent.scope,operation:p.kind});
      if(mode==="DROP_AFTER_COMMIT")throw new Error("SIMULATED_RESPONSE_LOSS");
      return {evidence,...(token?{token}:{})};
    },
    async recoverLifecycle(intent){check(intent.scope);const prior=lifecycle.get(intent.id);if(!prior)return {kind:"UNKNOWN"};if(!sameScope(prior.scope,intent.scope)||prior.evidence.fingerprint!==intent.fingerprint)throw new Error("ACTOR_MISMATCH");return prior.evidence;},
  };
  return {api,setFault(value:typeof fault){fault=value;},setReconciliation(value:typeof reconciliation){reconciliation=value;},inspect(){return {calls,picked,packed,epoch,holder,receiptCount:receipts.size,lifecycleCount:lifecycle.size};},
    /** WP-4 / O-3b: read-only history for e2e reset-boundary checks. Never includes the claim token. */
    history(){return {counts:this.inspect(),
      receipts:[...receipts.values()].map(r=>r.kind==="RECORDED"?{key:r.key,outcome:r.outcome,fingerprint:r.fingerprint,evidenceId:r.evidenceId,epoch:r.epoch}:{key:r.key,kind:r.kind}),
      lifecycle:[...lifecycle.values()].map(l=>({intentId:l.evidence.intentId,operation:l.operation,epoch:l.evidence.epoch,evidenceId:l.evidence.evidenceId}))};}};
}

/** Loopback-only synthetic RPC; no upstream fetch, filesystem data or database access. */
const RESET_TOKEN=/^[a-f0-9]{64}$/;
const RESET_ERRORS:Record<string,number>={RESET_REFUSED:403,RESET_NOT_QUIESCENT:409,STALE_FIXTURE_GENERATION:409};
/** Decodes a lowercase 64-hex token into 32 bytes; anything else is undefined (never echoed). */
function resetKey(value:unknown):Buffer|undefined {return typeof value==="string" && RESET_TOKEN.test(value)?Buffer.from(value,"hex"):undefined;}
export function fixturePlugin():Plugin {
  // WP-4 / O-3: a test-only reset exists only when the harness process was started with a fresh random
  // R5_SAFE3_E2E_FIXTURE_RESET (gate and confirmation token in one). Every /__simulation request is counted
  // in flight and bound to the fixture instance and generation it arrived under.
  let fixture=createFixtureBackend();let generation=0;let inFlight=0;
  const expected=resetKey(process.env.R5_SAFE3_E2E_FIXTURE_RESET);
  const authorized=(confirm:unknown)=>{const supplied=resetKey(confirm);return !!expected && !!supplied && timingSafeEqual(supplied,expected);};
  return {name:"r5-safe3-synthetic-fixture",configureServer(server){server.middlewares.use(async(req,res,next)=>{
    if(!req.url?.startsWith("/__simulation"))return next();
    const instance=fixture;const arrived=generation;inFlight++;
    try {
      res.setHeader("Cache-Control","no-store");res.setHeader("Content-Type","application/json");
      if(req.headers.host!=="127.0.0.1:5087" || (req.headers.origin && req.headers.origin!=="http://127.0.0.1:5087") || req.method!=="POST"){res.statusCode=403;res.end('{"error":"SIMULATION_ONLY"}');return;}
      let body="";for await(const chunk of req){body+=chunk.toString();if(body.length>20000)throw new Error("SIZE");}
      const input=JSON.parse(body);const credential=typeof req.headers["x-fulfillment-claim-token"]==="string"?req.headers["x-fulfillment-claim-token"]:undefined;
      // A request never runs against a fixture created after it arrived.
      if(arrived!==generation || instance!==fixture)throw new Error("STALE_FIXTURE_GENERATION");
      let output:unknown;
      switch(input.action){
        case "context":output=await instance.api.context(input.scope);break;
        case "submit":output=await instance.api.submit(input.attempt,credential??"");break;
        case "recover":output=await instance.api.recover(input.attempt);break;
        case "lifecycle":output=await instance.api.lifecycle(input.intent,credential);break;
        case "recoverLifecycle":output=await instance.api.recoverLifecycle(input.intent);break;
        case "validate":output=await instance.api.validate(input.scope,input.epoch,credential??"");break;
        case "fault":if(!["NONE","DROP_AFTER_COMMIT","FAIL_BEFORE_PROCESSING","REJECT"].includes(input.value))throw new Error("FAULT");instance.setFault(input.value);output={simulation:true};break;
        case "inspect":output=instance.inspect();break;
        case "history":
          if(!authorized(input.confirm))throw new Error("RESET_REFUSED");
          output={generation,inFlight,fixture:instance.history()};break;
        case "reset": {
          // All checks precede any change; the swap is synchronous, so a refused reset leaves the old fixture intact.
          if(!authorized(input.confirm))throw new Error("RESET_REFUSED");
          if(inFlight!==1)throw new Error("RESET_NOT_QUIESCENT");
          const previous=instance.history();const next=createFixtureBackend();
          fixture=next;generation++;
          output={simulation:true,generation,previous};break;
        }
        default:throw new Error("UNKNOWN_ACTION");
      }
      res.end(JSON.stringify(output));
    }catch(e){
      const code=e instanceof Error && Object.hasOwn(RESET_ERRORS,e.message)?e.message:undefined;
      res.statusCode=code?RESET_ERRORS[code]:503;res.end(JSON.stringify({error:code??"SIMULATED_UNCERTAINTY"}));
    }finally{inFlight--;}
  });}};
}
// Keep fixture requests structurally comparable without ever including credentials in digests.
export { canonical, digest, scopeKey };
