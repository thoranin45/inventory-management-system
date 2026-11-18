import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { SafeWorkflowPanel } from "../src/components/work/fulfillment-safe/safe-workflow-panel";
import { FulfillmentCoordinator } from "../src/lib/fulfillment/coordinator";
import { AttemptStore } from "../src/lib/fulfillment/store";
import type { FulfillmentTransport } from "../src/lib/fulfillment/transport";
import type { Locale } from "../src/components/work/fulfillment-safe/copy";
import "../src/app/globals.css";

if(location.origin!=="http://127.0.0.1:5087")throw new Error("LOOPBACK_SIMULATION_REQUIRED");
async function rpc(action:string,body:object={},token?:string) {
  if(location.origin!=="http://127.0.0.1:5087")throw new Error("LOOPBACK_SIMULATION_REQUIRED");
  const response=await fetch("/__simulation",{method:"POST",cache:"no-store",credentials:"omit",headers:{"Content-Type":"application/json",...(token?{"X-Fulfillment-Claim-Token":token}:{})},body:JSON.stringify({action,...body})});
  if(!response.ok)throw new Error("SIMULATED_TRANSPORT_UNCERTAIN");
  return response.json();
}
const transport:FulfillmentTransport={boundary:"SIMULATION_ONLY",context:scope=>rpc("context",{scope}),submit:(attempt,token)=>rpc("submit",{attempt},token),recover:attempt=>rpc("recover",{attempt}),lifecycle:(intent,token)=>rpc("lifecycle",{intent},token),recoverLifecycle:intent=>rpc("recoverLifecycle",{intent}),validate:(scope,epoch,token)=>rpc("validate",{scope,epoch},token)};
const scope={deployment:"SIMULATION-R5-SAFE3-NO-LIVE-INVENTORY",actor:1,order:101};
const coordinator=new FulfillmentCoordinator(scope,new AttemptStore(scope,indexedDB),transport,{locks:navigator.locks,channel:name=>new BroadcastChannel(name)},"warehouse");
window.addEventListener("pagehide",()=>coordinator.dispose());
function Harness(){const [locale,setLocale]=useState<Locale>("en");const [theme,setTheme]=useState<"light"|"dark">("light");const [fault,setFault]=useState("NONE");return <><nav aria-label="Simulation settings"><label>Language<select value={locale} onChange={e=>setLocale(e.target.value as Locale)}><option value="en">English</option><option value="th">ไทย</option></select></label><label>Theme<select value={theme} onChange={e=>setTheme(e.target.value as "light"|"dark")}><option value="light">Light</option><option value="dark">Dark</option></select></label><label>Next synthetic response<select value={fault} onChange={e=>{setFault(e.target.value);void rpc("fault",{value:e.target.value});}}><option value="NONE">Normal</option><option value="DROP_AFTER_COMMIT">Commit then lose response</option><option value="FAIL_BEFORE_PROCESSING">Fail before processing</option><option value="REJECT">Historical rejection</option></select></label></nav><SafeWorkflowPanel coordinator={coordinator} locale={locale} theme={theme}/></>;}
createRoot(document.getElementById("root")!).render(<Harness/>);
