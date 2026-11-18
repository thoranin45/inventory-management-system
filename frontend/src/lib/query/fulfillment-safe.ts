import type { FulfillmentCoordinator } from "../fulfillment/coordinator";
/** Isolated observer adapter. Neither credentials nor historical receipts enter the production query cache. */
export function fulfillmentObserver(coordinator:FulfillmentCoordinator) {
  return { subscribe:coordinator.subscribe, getSnapshot:coordinator.getSnapshot, refresh:()=>coordinator.observeContext() };
}
