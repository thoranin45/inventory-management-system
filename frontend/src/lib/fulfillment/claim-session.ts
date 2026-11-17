import { epochSchema, sameScope, scopeSchema, type Scope } from "./contracts";

/** Credentials live only in this closure; no serializable public token property. */
export function createClaimSession() {
  let generation = 0;
  let credential: { scope: Scope; epoch: number; token: string } | undefined;
  return {
    generation: () => generation,
    clear() { credential = undefined; generation++; },
    accept(scope: Scope, epoch: number, token: string, expectedGeneration: number) {
      if (expectedGeneration !== generation) throw new Error("STALE_ACTOR_RESPONSE");
      scopeSchema.parse(scope); epochSchema.parse(epoch);
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("INVALID_CREDENTIAL");
      credential = {scope:{...scope},epoch,token};
    },
    has(scope: Scope, epoch: number) { return !!credential && sameScope(scope,credential.scope) && credential.epoch===epoch; },
    withCredential<T>(scope: Scope, epoch: number, consume: (token: string) => T): T {
      if (!credential || !sameScope(scope,credential.scope) || credential.epoch !== epoch) throw new Error("CREDENTIAL_LOST");
      return consume(credential.token);
    },
  };
}
export type ClaimSession = ReturnType<typeof createClaimSession>;
