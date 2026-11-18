import { it,expect } from "vitest";
import { createClaimSession } from "./claim-session";
const scope={deployment:"simulation",actor:1,order:101};
it("keeps token in a closure and refuses different actors/epochs",()=>{const s=createClaimSession();const token="x".repeat(43);s.accept(scope,1,token,s.generation());expect(JSON.stringify(s)).not.toContain(token);expect(s.withCredential(scope,1,t=>t===token)).toBe(true);expect(()=>s.withCredential({...scope,actor:2},1,()=>{})).toThrow();expect(()=>s.withCredential(scope,2,()=>{})).toThrow();s.clear();expect(s.has(scope,1)).toBe(false);});
it("rejects late credentials after logout and loses credentials on reload",()=>{const s=createClaimSession();const generation=s.generation();s.clear();expect(()=>s.accept(scope,1,"x".repeat(43),generation)).toThrow("STALE_ACTOR");expect(createClaimSession().has(scope,1)).toBe(false);});
