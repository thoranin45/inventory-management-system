import { it,expect,vi } from "vitest";
import { render,screen,fireEvent } from "@testing-library/react";
import { ReleaseDialog } from "./release-dialog";
import type { Context } from "@/lib/fulfillment/contracts";
import { copy } from "./copy";
const context:Context={scope:{deployment:"simulation",actor:1,order:1},phase:"PICK",epoch:1,holder:1,reconciliation:"CLEAR",progressRevision:"1",allocations:[{id:1,allocated:"5.000",picked:"1.001",packed:"0.000"}],initialization:{kind:"SIMULATION_AUTHORIZATION",evidenceId:"fixture",journalRecoveryChecked:true,emptyJournalAuthorized:true}};
it("never prefills counts or checks physical attestation; requires explicit review/confirmation",async()=>{const submit=vi.fn().mockResolvedValue(undefined);render(<ReleaseDialog context={context} locale="en" onSubmit={submit} onClose={vi.fn()}/>);expect(screen.getByLabelText("Physically picked 1")).toHaveValue("");expect(screen.getByRole("checkbox")).not.toBeChecked();fireEvent.click(screen.getByText("Review counts"));expect(submit).not.toHaveBeenCalled();expect(screen.getByRole("alert")).toBeVisible();fireEvent.change(screen.getByLabelText("Physically picked 1"),{target:{value:"1.001"}});fireEvent.change(screen.getByLabelText("Physically packed 1"),{target:{value:"0"}});fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(screen.getByText("Review counts"));expect(submit).not.toHaveBeenCalled();fireEvent.click(screen.getByText("Confirm physical attestation and release"));expect(submit).toHaveBeenCalledWith(expect.objectContaining({mode:"VERIFIED",confirmed:true,counts:[{allocation_id:1,picked:"1.001",packed:"0.000"}]}));});
it("unverified release requires a reason and makes no physical-count claim",()=>{const submit=vi.fn().mockResolvedValue(undefined);render(<ReleaseDialog context={context} locale="en" onSubmit={submit} onClose={vi.fn()}/>);fireEvent.click(screen.getByLabelText("UNVERIFIED — blocks fulfillment"));fireEvent.click(screen.getByText("Review counts"));expect(screen.getByRole("alert")).toBeVisible();fireEvent.change(screen.getByLabelText("Reason"),{target:{value:"Count not completed"}});fireEvent.click(screen.getByText("Review counts"));fireEvent.click(screen.getByText("Confirm unverified release"));expect(submit).toHaveBeenCalledWith(expect.objectContaining({mode:"UNVERIFIED",reason:"Count not completed"}));expect(submit.mock.calls[0][0]).not.toHaveProperty("counts");expect(submit.mock.calls[0][0]).not.toHaveProperty("confirmed");});
it("rejects excess precision and stale expected counters",()=>{render(<ReleaseDialog context={context} locale="en" onSubmit={vi.fn()} onClose={vi.fn()}/>);fireEvent.change(screen.getByLabelText("Physically picked 1"),{target:{value:"1.0001"}});fireEvent.change(screen.getByLabelText("Physically packed 1"),{target:{value:"0"}});fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(screen.getByText("Review counts"));expect(screen.getByRole("alert")).toBeVisible();expect(screen.queryByText("Confirm physical attestation and release")).not.toBeInTheDocument();});

/* WP-4 / D5: the review step is a localized table (or reason line), never raw JSON. */
it.each(["en","th"] as const)("verified review shows a localized count table instead of raw JSON (%s)",locale=>{
  const t=copy(locale);const submit=vi.fn().mockResolvedValue(undefined);render(<ReleaseDialog context={context} locale={locale} onSubmit={submit} onClose={vi.fn()}/>);
  fireEvent.change(screen.getByLabelText(`${t.picked} 1`),{target:{value:"1.001"}});fireEvent.change(screen.getByLabelText(`${t.packed} 1`),{target:{value:"0"}});fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(screen.getByText(t.review));
  expect(screen.getByText(t.reviewTitle)).toBeVisible();
  for(const name of [t.allocation,t.picked,t.packed])expect(screen.getByRole("columnheader",{name})).toBeVisible();
  expect(screen.getByRole("cell",{name:"1.001"})).toBeVisible();expect(screen.getByRole("cell",{name:"0.000"})).toBeVisible();
  expect(document.querySelector("pre")).toBeNull();expect(document.body.textContent).not.toMatch(/allocation_id|[{}]/);
  expect(submit).not.toHaveBeenCalled();fireEvent.click(screen.getByText(t.confirm));expect(submit).toHaveBeenCalledOnce();
});
it("unverified review shows the localized reason line, not JSON",()=>{
  const t=copy("th");render(<ReleaseDialog context={context} locale="th" onSubmit={vi.fn().mockResolvedValue(undefined)} onClose={vi.fn()}/>);
  fireEvent.click(screen.getByLabelText(t.unverified));fireEvent.change(screen.getByLabelText(t.reason),{target:{value:"นับไม่ครบ"}});fireEvent.click(screen.getByText(t.review));
  expect(screen.getByText(`${t.reason}: นับไม่ครบ`)).toBeVisible();expect(document.querySelector("pre,table")).toBeNull();
});
