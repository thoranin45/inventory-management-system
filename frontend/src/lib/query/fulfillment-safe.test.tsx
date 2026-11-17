import { it,expect,vi } from "vitest";
import { fulfillmentObserver } from "./fulfillment-safe";
import type { FulfillmentCoordinator } from "../fulfillment/coordinator";
it("refresh is observation only, with no query cache or automatic mutation retry",async()=>{const refresh=vi.fn().mockResolvedValue(undefined);const coordinator={subscribe:vi.fn(),getSnapshot:vi.fn(),observeContext:refresh} as unknown as FulfillmentCoordinator;const observer=fulfillmentObserver(coordinator);await observer.refresh();expect(refresh).toHaveBeenCalledOnce();expect(Object.keys(observer).sort()).toEqual(["getSnapshot","refresh","subscribe"]);});
