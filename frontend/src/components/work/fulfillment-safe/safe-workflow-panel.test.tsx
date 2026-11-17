import { it,expect,vi } from "vitest";
import { render,screen,fireEvent } from "@testing-library/react";
import { SafeWorkflowPanel } from "./safe-workflow-panel";
import type { FulfillmentCoordinator,WorkflowView } from "@/lib/fulfillment/coordinator";
import { copy } from "./copy";
function fixture(status:WorkflowView["status"]="READY"){
 const view:WorkflowView={status,attempts:[],lifecyclePending:false,credentialAvailable:true,context:{scope:{deployment:"simulation",actor:1,order:1},phase:"PICK",epoch:1,holder:1,reconciliation:"CLEAR",progressRevision:"1",allocations:[],initialization:{kind:"SIMULATION_AUTHORIZATION",evidenceId:"fixture",journalRecoveryChecked:true,emptyJournalAuthorized:true}}};
 const submit=vi.fn(()=>new Promise<void>(()=>{}));
 const c={scope:view.context!.scope,role:"warehouse",subscribe:()=>()=>{},getSnapshot:()=>view,submit,logout:vi.fn()} as unknown as FulfillmentCoordinator;
 return {c,submit};
}
it("closes synchronous input gate for repeated Enter and click; preserves leading barcode zeros",()=>{const {c,submit}=fixture();render(<SafeWorkflowPanel coordinator={c}/>);fireEvent.change(screen.getByLabelText("Barcode"),{target:{value:"00001"}});fireEvent.click(screen.getByLabelText("This is a new physical action"));fireEvent.keyDown(screen.getByLabelText("Barcode"),{key:"Enter"});fireEvent.keyDown(screen.getByLabelText("Barcode"),{key:"Enter",repeat:true});fireEvent.click(screen.getByText("Scan"));expect(submit).toHaveBeenCalledOnce();expect(submit).toHaveBeenCalledWith(expect.objectContaining({barcode:"00001",quantity:"1.000"}));});
it("requires a new physical action confirmation and blocks unknown state",()=>{const {c,submit}=fixture("OUTCOME_UNKNOWN");render(<SafeWorkflowPanel coordinator={c}/>);expect(screen.getByText("Scan")).toBeDisabled();fireEvent.keyDown(screen.getByLabelText("Barcode"),{key:"Enter"});expect(submit).not.toHaveBeenCalled();});
it("offline events disable mutation rather than queueing it",()=>{const {c,submit}=fixture();render(<SafeWorkflowPanel coordinator={c}/>);vi.spyOn(navigator,"onLine","get").mockReturnValue(false);fireEvent(window,new Event("offline"));expect(screen.getByText("Offline — no mutation is permitted")).toBeVisible();expect(screen.getByText("Scan")).toBeDisabled();expect(submit).not.toHaveBeenCalled();vi.restoreAllMocks();});

/* WP-4 / D5: each status has its own operator text; BLOCKED wording is unchanged. */
it.each([["INITIALIZATION_REQUIRED","statusInitialization"],["RECONCILIATION_REQUIRED","statusReconciliation"],["SIGNED_OUT","statusSignedOut"],["BLOCKED","blocked"],["READY","ready"],["PAUSED","paused"],["BUSY","busy"],["OUTCOME_UNKNOWN","unknown"]] as const)("status %s shows its own text in EN and TH",(status,key)=>{
  for(const locale of ["en","th"] as const){const {c}=fixture(status);const {unmount}=render(<SafeWorkflowPanel coordinator={c} locale={locale}/>);expect(screen.getByText(copy(locale)[key])).toBeVisible();unmount();}
});
it("initialization, reconciliation and sign-out are distinct from the unchanged BLOCKED wording",()=>{
  for(const locale of ["en","th"] as const){const t=copy(locale);expect(new Set([t.statusInitialization,t.statusReconciliation,t.statusSignedOut,t.blocked]).size).toBe(4);}
  expect(copy("en").blocked).toBe("Fulfillment blocked. Preserve the evidence and contact an Admin.");
});
it("reconciliation-required keeps ordinary scan input disabled",()=>{const {c,submit}=fixture("RECONCILIATION_REQUIRED");render(<SafeWorkflowPanel coordinator={c}/>);expect(screen.getByLabelText("Barcode")).toBeDisabled();fireEvent.keyDown(screen.getByLabelText("Barcode"),{key:"Enter"});expect(submit).not.toHaveBeenCalled();});
