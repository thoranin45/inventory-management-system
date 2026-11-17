import { it,expect,vi } from "vitest";
import { render,screen,fireEvent } from "@testing-library/react";
import { copy } from "./copy";
import { ReconciliationStatus } from "./reconciliation-status";
import { ClaimPanel } from "./claim-panel";
import { SafeWorkflowPanel } from "./safe-workflow-panel";
import type { FulfillmentCoordinator,WorkflowView } from "@/lib/fulfillment/coordinator";
import { RecoveryPanel } from "./recovery-panel";
import { lifecyclePayloadSchema,operationSchema,phaseSchema,reconciliationSchema,stateSchema,type Attempt,type AttemptState } from "@/lib/fulfillment/contracts";
import { readFileSync } from "node:fs";
import path from "node:path";
it("covers TH/EN keys with actual Thai text",()=>{expect(Object.keys(copy("th"))).toEqual(Object.keys(copy("en")));expect(copy("th").simulation).toMatch(/[\u0e00-\u0e7f]/);});
it.each(["REQUIRED","CORRECTION_IN_PROGRESS","ESCALATED"] as const)("shows %s without operational correction controls",status=>{render(<ReconciliationStatus status={status} locale="en"/>);expect(screen.getByRole("status")).toHaveTextContent(status);expect(screen.queryByRole("button")).not.toBeInTheDocument();});
it.each(["light","dark"] as const)("declares %s theme, language and simulation boundary",theme=>{const snapshot={status:"SIGNED_OUT",attempts:[]};const c={scope:{actor:1},getSnapshot:()=>snapshot,subscribe:()=>()=>{},logout:vi.fn()} as unknown as FulfillmentCoordinator;render(<SafeWorkflowPanel coordinator={c} theme={theme} locale="th"/>);expect(screen.getByRole("main")).toHaveAttribute("data-theme",theme);expect(screen.getByRole("main")).toHaveAttribute("lang","th");expect(screen.getByText(copy("th").simulation)).toBeVisible();});
it.each(["warehouse","admin"] as const)("cross-user takeover requires Admin; current role %s",role=>{const view:WorkflowView={status:"PAUSED",attempts:[],credentialAvailable:false,lifecyclePending:false,context:{scope:{deployment:"simulation",actor:2,order:1},phase:"PICK",epoch:1,holder:1,reconciliation:"CLEAR",progressRevision:"1",allocations:[],initialization:{kind:"SIMULATION_AUTHORIZATION",evidenceId:"fixture",journalRecoveryChecked:true,emptyJournalAuthorized:true}}};const c={scope:view.context!.scope,role} as FulfillmentCoordinator;render(<ClaimPanel coordinator={c} view={view} locale="en" run={vi.fn()}/>);fireEvent.change(screen.getByLabelText("Reason"),{target:{value:"supervised recovery"}});fireEvent.click(screen.getByLabelText("I confirm this takeover"));expect(screen.getByText("Explicit takeover")).toHaveProperty("disabled",role==="warehouse");});

/* WP-4 / D5: localized labels are primary text; enum codes appear only as secondary references. */
const leaves=(o:object,prefix=""):[string,unknown][]=>Object.entries(o).flatMap(([k,v])=>v&&typeof v==="object"?leaves(v,`${prefix}${k}.`):[[`${prefix}${k}`,v] as [string,unknown]]);
it("TH/EN parity holds for every nested key and every Thai value contains Thai script",()=>{
  const en=leaves(copy("en"));const th=leaves(copy("th"));expect(th.map(x=>x[0])).toEqual(en.map(x=>x[0]));
  for(const [key,value] of th)expect(typeof value==="string" && /[฀-๿]/.test(value),key).toBe(true);
  expect(copy("th").epoch).toBe("หมายเลขรอบสิทธิ์");
});
it.each(["en","th"] as const)("labels every attempt state, operation, lifecycle kind, reconciliation status and phase (%s), never as the raw code",locale=>{
  const t=copy(locale);
  const groups:[Record<string,string>,readonly string[]][]=[[t.states,stateSchema.options],[t.operations,operationSchema.options],[t.lifecycleKinds,lifecyclePayloadSchema.shape.kind.options],[t.reconciliation,reconciliationSchema.options],[t.phases,phaseSchema.options]];
  expect(groups.map(([,codes])=>codes.length)).toEqual([9,4,4,7,2]);
  for(const [labels,codes] of groups){expect(Object.keys(labels).sort()).toEqual([...codes].sort());for(const code of codes){expect(labels[code].trim()).not.toBe("");expect(labels[code]).not.toBe(code);}}
});
const attempt=(state:AttemptState,historical=false)=>({scope:{deployment:"simulation",actor:1,order:1},key:"11111111-1111-4111-8111-111111111111",fingerprint:"a".repeat(64),revision:2,state,payload:{operation:"SCAN_PICK",phase:"PICK",epoch:1,barcode:"00001",quantity:"1.000"},...(historical?{evidence:{kind:"RECORDED",historical:true}}:{})}) as unknown as Attempt;
const recoveryView=(attempts:Attempt[],lifecyclePending=false):WorkflowView=>({status:"OUTCOME_UNKNOWN",attempts,lifecyclePending,credentialAvailable:false});
it.each(["en","th"] as const)("recovery panel shows the localized state and operation first, the code only as a reference (%s)",locale=>{
  const t=copy(locale);render(<RecoveryPanel coordinator={{} as FulfillmentCoordinator} view={recoveryView([attempt("OUTCOME_UNKNOWN")])} locale={locale} run={vi.fn()}/>);
  expect(screen.getByText(t.states.OUTCOME_UNKNOWN,{selector:"strong"})).toBeVisible();
  expect(screen.getByText("OUTCOME_UNKNOWN",{selector:"code"})).toHaveAttribute("title",t.reference);
  expect(screen.getByText(new RegExp(t.operations.SCAN_PICK))).toBeVisible();expect(screen.queryByText(/SCAN_PICK/)).not.toBeInTheDocument();
});
it("historical receipts are labelled in the active language, never with hard-coded English",()=>{
  render(<RecoveryPanel coordinator={{} as FulfillmentCoordinator} view={recoveryView([attempt("APPLIED",true)])} locale="th" run={vi.fn()}/>);
  expect(screen.getByText(new RegExp(copy("th").historical))).toBeVisible();expect(screen.queryByText(/historical/)).not.toBeInTheDocument();
});
it.each(["en","th"] as const)("a pending lifecycle intent uses generic claim-action copy, not release-only copy (%s)",locale=>{
  const t=copy(locale);render(<RecoveryPanel coordinator={{} as FulfillmentCoordinator} view={recoveryView([],true)} locale={locale} run={vi.fn()}/>);
  expect(screen.getByText(t.lifecycleUnknown)).toBeVisible();expect(screen.queryByText(t.releaseUnknown)).not.toBeInTheDocument();
  expect(screen.getByRole("button",{name:t.recoverLifecycle})).toBeEnabled();
});
it.each(reconciliationSchema.options)("reconciliation %s shows its Thai label first and keeps the code as a reference",status=>{
  const t=copy("th");render(<ReconciliationStatus status={status} locale="th"/>);
  expect(screen.getByText(t.reconciliation[status],{selector:"strong"})).toBeVisible();expect(screen.getByText(status,{selector:"code"})).toBeVisible();
});
it("claim panel names an absent holder and shows the localized phase",()=>{
  const t=copy("th");const view:WorkflowView={status:"PAUSED",attempts:[],credentialAvailable:false,lifecyclePending:false,context:{scope:{deployment:"simulation",actor:1,order:1},phase:"PACK",epoch:3,holder:null,reconciliation:"CLEAR",progressRevision:"1",allocations:[],initialization:{kind:"SIMULATION_AUTHORIZATION",evidenceId:"fixture",journalRecoveryChecked:true,emptyJournalAuthorized:true}}};
  render(<ClaimPanel coordinator={{scope:view.context!.scope,role:"warehouse"} as FulfillmentCoordinator} view={view} locale="th" run={vi.fn()}/>);
  const line=screen.getByText(new RegExp(t.holderNone));expect(line).toHaveTextContent(t.phases.PACK);expect(line).toHaveTextContent(`${t.epoch}: 3`);expect(line).not.toHaveTextContent("?");
});
it("the harness browser entry never references the server-side fixture, its reset or the reset token variable",()=>{
  const main=readFileSync(path.resolve("fulfillment-harness/main.tsx"),"utf8");
  expect(main).not.toMatch(/fixture-server|R5_SAFE3_E2E|"reset"|"history"/);
});
