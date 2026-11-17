import { it,expect } from "vitest";
import { readFileSync,readdirSync } from "node:fs";
import path from "node:path";
import { requireSimulation,transportFailure,type FulfillmentTransport } from "./transport";
it("refuses a live transport and does not classify transport errors as receipts",()=>{expect(()=>requireSimulation({boundary:"LIVE"} as unknown as FulfillmentTransport)).toThrow("LIVE_ACTIVATION");expect(transportFailure()).toBe("TRANSPORT_UNCERTAIN");});
it("production app has no import or mount of the isolated workflow",()=>{
 const visit=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?visit(path.join(dir,e.name)):/\.(tsx?|mts)$/.test(e.name)?[path.join(dir,e.name)]:[]);
 for(const file of visit(path.resolve("src/app")))expect(readFileSync(file,"utf8"),file).not.toMatch(/fulfillment-safe|lib\/fulfillment|fulfillment-harness/);
 const transport=readFileSync(path.resolve("src/lib/fulfillment/transport.ts"),"utf8");expect(transport).not.toMatch(/fetch\(|https?:\/\/|scan-pick|scan-pack/);
 const main=readFileSync(path.resolve("fulfillment-harness/main.tsx"),"utf8");expect(main).toContain('location.origin!=="http://127.0.0.1:5087"');expect(main).toContain('fetch("/__simulation"');expect(main).not.toContain("/api/bff");
});
