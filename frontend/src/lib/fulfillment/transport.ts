import type { Attempt, Context, Evidence, LifecycleEvidence, LifecycleIntent, Scope, Submission } from "./contracts";

/** FUTURE contracts, exercised ONLY by synthetic fixtures. No network implementation or URL defaults. */
export interface FulfillmentTransport {
  readonly boundary: "SIMULATION_ONLY";
  context(scope: Scope): Promise<Context>;
  submit(attempt: Attempt, credential: string): Promise<Submission>;
  recover(attempt: Attempt): Promise<Evidence | {kind:"ABSENT_NOT_FINAL"}>;
  lifecycle(intent: LifecycleIntent, credential?: string): Promise<{evidence:LifecycleEvidence; token?:string}>;
  recoverLifecycle(intent: LifecycleIntent): Promise<LifecycleEvidence | {kind:"UNKNOWN"}>;
  validate(scope: Scope, epoch: number, credential: string): Promise<Context>;
}
export function requireSimulation(transport: FulfillmentTransport): void {
  if (transport.boundary !== "SIMULATION_ONLY") throw new Error("LIVE_ACTIVATION_NOT_IMPLEMENTED");
}
// HTTP status alone, request IDs, current counters and generic 4xx responses never settle an attempt.
export const transportFailure = () => "TRANSPORT_UNCERTAIN" as const;
