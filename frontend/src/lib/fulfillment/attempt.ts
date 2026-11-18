import { attemptSchema, evidenceSchema, payloadSchema, scopeSchema, sameScope, type Attempt, type AttemptState, type Evidence, type Payload, type Scope } from "./contracts";

export function immutable<T>(value:T):T {
  if(value && typeof value === "object") {Object.values(value).forEach(immutable);Object.freeze(value);}
  return value;
}
export function secureKey(): string {
  if (!globalThis.crypto?.randomUUID) throw new Error("SECURE_UUID_UNAVAILABLE");
  return crypto.randomUUID();
}
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(k => `${JSON.stringify(k)}:${canonical(record[k])}`).join(",")}}`;
}
export async function digest(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2,"0")).join("");
}
export async function createAttempt(scope: Scope, payload: Payload): Promise<Attempt> {
  const identity = { scope: scopeSchema.parse(scope), payload: payloadSchema.parse(payload) };
  const key = secureKey();
  const stamp = new Date().toISOString();
  return immutable(attemptSchema.parse({ ...identity, key, fingerprint: await digest(identity), version:1, state:"CREATED", revision:0, createdAt:stamp, updatedAt:stamp }));
}
export const terminal = (state: AttemptState) => ["APPLIED","REJECTED","NOT_APPLIED_FENCED","CANCELLED_UNSENT"].includes(state);
const transitions: Record<AttemptState, AttemptState[]> = {
  // PERSISTED → OUTCOME_UNKNOWN: a PERSISTED attempt recovered after reload cannot prove it was never sent, so it is
  // treated as uncertain (settled only by correlated evidence). CANCELLED_UNSENT is reserved for in-session proof.
  CREATED:["PERSISTED"], PERSISTED:["SENDING","CANCELLED_UNSENT","OUTCOME_UNKNOWN"], SENDING:["OUTCOME_UNKNOWN","APPLIED","REJECTED","CONFLICT","NOT_APPLIED_FENCED"],
  OUTCOME_UNKNOWN:["SENDING","APPLIED","REJECTED","CONFLICT","NOT_APPLIED_FENCED"], CONFLICT:["APPLIED","REJECTED","NOT_APPLIED_FENCED"],
  APPLIED:[], REJECTED:[], NOT_APPLIED_FENCED:[], CANCELLED_UNSENT:[],
};
export function transition(attempt: Attempt, state: AttemptState, rawEvidence?: Evidence): Attempt {
  attemptSchema.parse(attempt);
  if (!transitions[attempt.state].includes(state)) throw new Error("INVALID_TRANSITION");
  const evidence = rawEvidence === undefined ? undefined : evidenceSchema.parse(rawEvidence);
  if (["APPLIED","REJECTED","NOT_APPLIED_FENCED"].includes(state)) {
    if (!evidence || !sameScope(evidence.scope,attempt.scope) || evidence.key !== attempt.key || evidence.fingerprint !== attempt.fingerprint) throw new Error("EVIDENCE_MISMATCH");
    if (evidence.kind === "RECORDED" ? evidence.outcome !== state || evidence.epoch !== attempt.payload.epoch : state !== "NOT_APPLIED_FENCED" || evidence.fencedEpoch <= attempt.payload.epoch) throw new Error("EVIDENCE_MISMATCH");
  } else if (evidence) throw new Error("UNEXPECTED_EVIDENCE");
  return immutable(attemptSchema.parse({ ...attempt, state, revision:attempt.revision+1, updatedAt:new Date().toISOString(), ...(evidence ? { evidence } : {}) }));
}
export async function verifyAttempt(raw: unknown): Promise<Attempt> {
  const a = attemptSchema.parse(raw);
  if (a.fingerprint !== await digest({scope:a.scope,payload:a.payload})) throw new Error("JOURNAL_CORRUPT");
  return a;
}
// Retention is descriptive only. There is deliberately no deletion/expiry API.
export const retention = Object.freeze({ eligibleSettledDays:7, terminalTombstoneDays:30, automaticCleanup:false });
