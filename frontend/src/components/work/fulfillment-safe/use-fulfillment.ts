"use client";
import { useSyncExternalStore } from "react";
import type { FulfillmentCoordinator } from "@/lib/fulfillment/coordinator";
import type { LifecyclePayload } from "@/lib/fulfillment/contracts";
/** Callback types live in a .ts module so component signatures carry no JSX-like `>Word<` text. */
export type RunWork=(work:()=>Promise<void>)=>void;
export type ReleaseSubmit=(payload:LifecyclePayload)=>Promise<void>;
export function useFulfillment(coordinator:FulfillmentCoordinator) {
  return useSyncExternalStore(coordinator.subscribe,coordinator.getSnapshot,coordinator.getSnapshot);
}
