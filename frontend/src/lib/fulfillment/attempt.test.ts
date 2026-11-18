import { beforeEach,describe,it,expect,vi } from "vitest";
import { webcrypto } from "node:crypto";
import { createAttempt,transition,verifyAttempt,retention } from "./attempt";
import type { Evidence,Payload } from "./contracts";
const scope={deployment:"simulation",actor:1,order:101};
const payload:Payload={operation:"SCAN_PICK",phase:"PICK",epoch:1,barcode:"00001",quantity:"1.000"};
beforeEach(()=>vi.stubGlobal("crypto",webcrypto));
describe("immutable attempt identity and state",()=>{
  it("uses a secure unique key and distinguishes allocation omission",async()=>{const a=await createAttempt(scope,payload);const b=await createAttempt(scope,{...payload,allocation_id:1});expect(a.key).not.toBe(b.key);expect(a.fingerprint).not.toBe(b.fingerprint);expect(a.payload.barcode).toBe("00001");});
  it("fails without secure UUID; never falls back to time/random",async()=>{vi.stubGlobal("crypto",{});await expect(createAttempt(scope,payload)).rejects.toThrow("SECURE_UUID");});
  it("requires matching authoritative receipt, never a GET or changed actor",async()=>{
    const created=await createAttempt(scope,payload);const pending=transition(transition(created,"PERSISTED"),"SENDING");
    expect(()=>transition(pending,"APPLIED")).toThrow();
    const evidence:Evidence={kind:"RECORDED",scope,key:pending.key,fingerprint:pending.fingerprint,outcome:"APPLIED",epoch:1,historical:true,replayed:true,recordedAt:new Date().toISOString(),evidenceId:"receipt",status:200};
    expect(()=>transition(pending,"APPLIED",{...evidence,scope:{...scope,actor:2}})).toThrow();
    const done=transition(pending,"APPLIED",evidence);expect(done.evidence).toEqual(evidence);expect(()=>transition(done,"SENDING")).toThrow();
  });
  it("refuses mutable or corrupted payloads and invalid state shortcuts",async()=>{const a=await createAttempt(scope,payload);await expect(verifyAttempt({...a,payload:{...a.payload,quantity:"2.000"}})).rejects.toThrow("CORRUPT");expect(()=>transition(a,"APPLIED")).toThrow();expect(retention.automaticCleanup).toBe(false);});
  it("fenced absence must be newer and correlated",async()=>{const a=transition(transition(await createAttempt(scope,payload),"PERSISTED"),"SENDING");const e:Evidence={kind:"ABSENT_FENCED",scope,key:a.key,fingerprint:a.fingerprint,fencedEpoch:1,evidenceId:"fence",allMutationPathsFenced:true};expect(()=>transition(a,"NOT_APPLIED_FENCED",e)).toThrow();expect(transition(a,"NOT_APPLIED_FENCED",{...e,fencedEpoch:2}).state).toBe("NOT_APPLIED_FENCED");});
  it("can cancel only an unsent persisted action",async()=>{const a=transition(await createAttempt(scope,payload),"PERSISTED");expect(transition(a,"CANCELLED_UNSENT").state).toBe("CANCELLED_UNSENT");expect(()=>transition(transition(a,"SENDING"),"CANCELLED_UNSENT")).toThrow();});
  // WP-3 B1 / D2a
  it("recovered PERSISTED may only become OUTCOME_UNKNOWN without evidence; cancellation stays PERSISTED-only and terminal",async()=>{
    const a=transition(await createAttempt(scope,payload),"PERSISTED");
    const u=transition(a,"OUTCOME_UNKNOWN");expect(u.state).toBe("OUTCOME_UNKNOWN");expect(u.key).toBe(a.key);expect(u.fingerprint).toBe(a.fingerprint);expect(u.payload).toEqual(a.payload);expect(u.evidence).toBeUndefined();
    const fenced:Evidence={kind:"ABSENT_FENCED",scope,key:a.key,fingerprint:a.fingerprint,fencedEpoch:2,evidenceId:"fence",allMutationPathsFenced:true};
    expect(()=>transition(a,"OUTCOME_UNKNOWN",fenced)).toThrow("UNEXPECTED_EVIDENCE");
    for(const from of [u,transition(transition(a,"SENDING"),"CONFLICT")])expect(()=>transition(from,"CANCELLED_UNSENT")).toThrow("INVALID_TRANSITION");
    const c=transition(a,"CANCELLED_UNSENT");for(const to of ["CANCELLED_UNSENT","SENDING","OUTCOME_UNKNOWN"] as const)expect(()=>transition(c,to)).toThrow("INVALID_TRANSITION");
  });
});
