import { z } from "zod";

export const scopeSchema = z.object({ deployment: z.string().min(1).max(120), actor: z.number().int().positive(), order: z.number().int().positive() }).strict();
export type Scope = z.infer<typeof scopeSchema>;
export const scopeKey = (scope: Scope) => JSON.stringify([scope.deployment, scope.actor, scope.order]);
export const orderLockKey = (scope: Scope) => JSON.stringify([scope.deployment, scope.order]);
export const phaseSchema = z.enum(["PICK", "PACK"]);
export const operationSchema = z.enum(["SCAN_PICK", "SCAN_PACK", "UNDO_PICK", "UNDO_PACK"]);
export const epochSchema = z.number().int().min(0).max(2147483647);
export function quantity(value: unknown, zero = false): string {
  if (typeof value !== "string" || value.length > 19 || !/^(0|[1-9]\d{0,14})(\.\d{1,3})?$/.test(value)) throw new Error("INVALID_QUANTITY");
  const [whole, fraction = ""] = value.split(".");
  const canonical = `${whole}.${fraction.padEnd(3, "0")}`;
  if (!zero && /^0\.000$/.test(canonical)) throw new Error("POSITIVE_QUANTITY_REQUIRED");
  return canonical;
}
const exactQuantity = z.string().refine(v => { try { return quantity(v) === v; } catch { return false; } });
export const payloadSchema = z.object({ operation: operationSchema, phase: phaseSchema, epoch: epochSchema, barcode: z.string().min(1).max(200).optional(), allocation_id: z.number().int().positive().optional(), quantity: exactQuantity }).strict().superRefine((p, ctx) => {
  if (Object.hasOwn(p,"allocation_id") && p.allocation_id===undefined)ctx.addIssue({code:"custom",message:"EXPLICIT_UNDEFINED_ALLOCATION"});
  if (!p.operation.endsWith(p.phase) || (p.operation.startsWith("SCAN") ? p.barcode === undefined : p.barcode !== undefined || p.allocation_id === undefined)) ctx.addIssue({ code: "custom", message: "INVALID_OPERATION_PAYLOAD" });
});
export type Payload = z.infer<typeof payloadSchema>;
export const stateSchema = z.enum(["CREATED", "PERSISTED", "SENDING", "OUTCOME_UNKNOWN", "APPLIED", "REJECTED", "CONFLICT", "NOT_APPLIED_FENCED", "CANCELLED_UNSENT"]);
export type AttemptState = z.infer<typeof stateSchema>;
export const receiptSchema = z.object({ kind: z.literal("RECORDED"), scope: scopeSchema, key: z.string().uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), outcome: z.enum(["APPLIED", "REJECTED"]), epoch: epochSchema, historical: z.boolean(), replayed: z.boolean(), recordedAt: z.string().datetime(), evidenceId: z.string().min(1), status: z.number().int().min(200).max(499) }).strict().superRefine((r,c) => {
  if ((r.outcome === "APPLIED" && r.status !== 200) || (r.outcome === "REJECTED" && ![404,409].includes(r.status))) c.addIssue({code:"custom",message:"INVALID_RECEIPT_STATUS"});
});
export const absenceSchema = z.object({ kind: z.literal("ABSENT_FENCED"), scope: scopeSchema, key: z.string().uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), fencedEpoch: epochSchema, evidenceId: z.string().min(1), allMutationPathsFenced: z.literal(true) }).strict();
export const conflictSchema=z.object({kind:z.literal("PAYLOAD_CONFLICT"),scope:scopeSchema,key:z.string().uuid(),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),evidenceId:z.string().min(1)}).strict();
export type Submission=Evidence|z.infer<typeof conflictSchema>;
export const evidenceSchema = z.union([receiptSchema, absenceSchema]);
export type Evidence = z.infer<typeof evidenceSchema>;
export const attemptSchema = z.object({ version: z.literal(1), scope: scopeSchema, key: z.string().uuid(), payload: payloadSchema, fingerprint: z.string().regex(/^[a-f0-9]{64}$/), state: stateSchema, revision: z.number().int().nonnegative(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(), evidence: evidenceSchema.optional(), error: z.enum(["TRANSPORT_UNCERTAIN", "CONFLICT", "CREDENTIAL_LOST"]).optional() }).strict();
export type Attempt = z.infer<typeof attemptSchema>;
export const reconciliationSchema = z.enum(["CLEAR", "REQUIRED", "CORRECTION_IN_PROGRESS", "ESCALATED", "RESOLVED_MATCHED", "RESOLVED_CORRECTED", "RESOLVED_ACCEPTED"]);
export type Reconciliation = z.infer<typeof reconciliationSchema>;
const nonnegativeQuantity = z.string().refine(v => { try { return quantity(v, true) === v; } catch { return false; } });
export const allocationSchema = z.object({ id: z.number().int().positive(), allocated: nonnegativeQuantity, picked: nonnegativeQuantity, packed: nonnegativeQuantity }).strict();
export const contextSchema = z.object({ scope: scopeSchema, phase: phaseSchema, epoch: epochSchema, holder: z.number().int().positive().nullable(), reconciliation: reconciliationSchema, progressRevision: z.string().min(1), allocations: z.array(allocationSchema), initialization: z.object({ kind: z.literal("SIMULATION_AUTHORIZATION"), evidenceId: z.string().min(1), journalRecoveryChecked: z.literal(true), emptyJournalAuthorized: z.boolean() }).strict() }).strict();
export type Context = z.infer<typeof contextSchema>;
export type LifecycleKind = "ACQUIRE" | "TAKEOVER" | "RELEASE" | "COMPLETE";
export const lifecyclePayloadSchema = z.object({ kind: z.enum(["ACQUIRE","TAKEOVER","RELEASE","COMPLETE"]), phase: phaseSchema, expectedEpoch: epochSchema, progressRevision: z.string().min(1), reason: z.string().min(1).max(200).optional(), confirmed: z.boolean().optional(), mode: z.enum(["VERIFIED","UNVERIFIED"]).optional(), counts: z.array(z.object({ allocation_id: z.number().int().positive(), picked: nonnegativeQuantity, packed: nonnegativeQuantity }).strict()).optional() }).strict();
export type LifecyclePayload = z.infer<typeof lifecyclePayloadSchema>;
export const lifecycleSchema = z.object({ scope: scopeSchema, id: z.string().uuid(), payload: lifecyclePayloadSchema, fingerprint: z.string().regex(/^[a-f0-9]{64}$/), revision: z.number().int().nonnegative(), state: z.enum(["PERSISTED","SENDING","OUTCOME_UNKNOWN","RESOLVED"]), evidenceId: z.string().optional() }).strict();
export type LifecycleIntent = z.infer<typeof lifecycleSchema>;
export const lifecycleEvidenceSchema = z.object({ scope: scopeSchema, intentId: z.string().uuid(), fingerprint: z.string(), kind: z.literal("LIFECYCLE_RECORDED"), evidenceId: z.string().min(1), epoch: epochSchema }).strict();
export type LifecycleEvidence = z.infer<typeof lifecycleEvidenceSchema>;
export const sameScope = (a: Scope, b: Scope) => scopeKey(a) === scopeKey(b);
export const blocksReconciliation = (r: Reconciliation) => ["REQUIRED","CORRECTION_IN_PROGRESS","ESCALATED"].includes(r);
