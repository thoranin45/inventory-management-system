# WP-5 acceptance matrix addendum (DRAFT)

| | |
|---|---|
| **Status** | DRAFT, revision 3. **No scenario is implemented or passed because it appears here;** every row is OPEN / NOT IMPLEMENTED. Documentation checks are not runtime evidence |
| **Baseline** | The 15 mandatory Codex scenarios and the supplementary scenarios stay governed by the accepted `docs/wp5-acceptance-matrix.md` (SHA-256 `c5594784c9b51413e99792bacd420bdd7e76e1a63b00d0640e768727ade9116c`), unchanged. Scenarios here are additive prerequisites |
| **Revision** | Revision 1 (SHA-256 `1e0a44f28c79beb44061c599f20b732d76994e39f0346c3b1933e14a34c7cc5d`) was audited by Codex as BLOCKED; revision 2 revised AX-1…AX-42 and added AX-43…AX-62 (addendum §A24.1). Revision 2 (SHA-256 `9172ca0b1580d25e91412ef6bb2daf708d6b075f53806ad49d73d17e652ae843`) was audited as BLOCKED by the delta audit; this revision 3 adds explicit failure behavior, identity qualifications and AX-63…AX-66 (addendum §A24.2) |
| **Companions** | `docs/wp5-contract-freeze-addendum.md` (section references `A…`); `tests/fixtures/wp5_contract_vectors_addendum.json` |
| **Test levels** | Service / API on disposable PostgreSQL 18; BFF; Browser on a disposable stack. Synthetic tests are never live-integration proof |
| **Activation** | Every row below blocks live activation |

## 1. Admission, enrollment and cutover (A8)

| ID | Scenario | Required behavior | Level | Expected evidence | Fail-closed outcome | Dependency |
|---|---|---|---|---|---|---|
| AX-1 | ENROLL bootstrap and atomicity | Under J-1 the client creates the journal and persists the ENROLL intent (PERSISTED → SENDING) before dispatch; the server commits marker, CONFIRMED → PICKING, epoch 0 → 1, ENROLL receipt (`subject_actor`) and audit in **one** transaction | Service, API, Browser | Journal holds the intent before the request; fault injected at each server step → nothing persisted; success → all visible together | No partial state; no dispatch without a persisted intent | W5-1, W5-2, W5-6 |
| AX-2 | ENROLL replay, conflict, second intent, ineligible, cross-actor | Same key and fingerprint → original receipt; different fingerprint → PAYLOAD_CONFLICT; new intent on an enrolled order → REJECTED `ALREADY_COORDINATED`; ineligible → REJECTED; another actor's key → indistinguishable `FULFILLMENT_KEY_UNAVAILABLE` (W5-0 §8.3) | API | Receipts; epoch unchanged on every REJECTED; no receipt metadata disclosed | No second enrollment | W5-2, W5-4 |
| AX-3 | ENROLL when admission is not ACTIVE | INACTIVE, PAUSED, CONTAINED or RESTORE_SUSPECTED → refused before acceptance, no receipt | API | No marker, status or epoch change | Refuse | W5-2 |
| AX-4 | First activation vs legacy start-picking | Interleavings 1–3 (A8.4): start-picking committed before L1 → legacy order; L1 committed first → start-picking refused `LEGACY_START_REFUSED`; concurrent → serialized on the admission row | Service concurrency | Both orderings: exactly one outcome; never a CONFIRMED order with a marker | Refuse after first activation | W5-2, W5-7 |
| AX-5 | Same-order races after first activation | Legacy start-picking refused at the admission check regardless of order-lock timing. ENROLL delivered twice with the **same** intent identity and fingerprint → one transition; the second delivery replays the recorded receipt. ENROLL with **different** competing intent identities → the first commit applies; the other is REJECTED `ALREADY_COORDINATED` (or stale). Same identity, different fingerprint → PAYLOAD_CONFLICT. ENROLL vs Policy A cancellation → first commit wins, the other refused or REJECTED | Service concurrency | One transition per race; replay returns the original receipt | Refuse | W5-2, W5-7 |
| AX-6 | First ACQUIRE at the current authoritative epoch; premature ACQUIRE at 0 | With no intervening authorized epoch advance since ENROLL: an actor with work authorization acquires at expected 1 (1 → 2, token once). Expected 0 → REJECTED stale. An actor without work authorization → refused. The expected epoch comes only from trusted context (AC-1) | API | Receipts; fixture `lifecycle_vectors` | No claim from a stale, derived or unauthorized request | W5-2, W5-4, AC-1 |
| AX-7 | Old-revision writer before first activation | L1 cannot commit while any A12 gate fails | Operational rehearsal, Service | Admission stays INACTIVE or PAUSED with the failing gate recorded | Admission not ACTIVE | W5-7, D-11, SAFE.5 |
| AX-8 | Admission states | Per the A8.1 matrix: PAUSED refuses coordinated mutations but permits guarded shipment only when every A8.7 condition holds; CONTAINED and RESTORE_SUSPECTED refuse every guarded mutation including shipment; lookups allowed in every state; N-1 per AD-1; CONTAINED → PAUSED only with an independent verification record | API | Per-state refusals and permitted shipments; lookups succeed | Refuse | W5-2, W5-3, W5-7, AD-2, AD-3 |
| AX-43 | ENROLL committed, response lost, browser reload | Reload → OUTCOME_UNKNOWN → receipt-only lookup → RECORDED APPLIED; epoch 1; exactly one enrollment | API, Browser | Receipt; journal intent RESOLVED | Stay blocked until RECORDED | W5-2, W5-3, W5-6 |
| AX-44 | ENROLL lost before arrival | Lookup first → ABSENT_NOT_FINAL; operator-confirmed retry of the identical intent (same `intent_id` and fingerprint) → one receipt; a late original replays it; no new identity is generated; no automatic retry | API, Browser | One receipt; one transition; journal shows the same intent ID throughout | Intent stays blocked without operator confirmation | W5-2, W5-6, B-2 |
| AX-45 | Writer prevention after enrollment (acceptance gate) | Every old-revision, direct-SQL, job, script and maintenance write attempt against an enrolled order is **prevented** by the selected O-8 strategy: no bypass write commits. Required for L1 and for authoritative FENCED / ABSENT_FENCED. Detection or containment (AX-66) never satisfies this scenario | Disposable stack, operational rehearsal | Prevention evidence for each writer class in the writer map | If any bypass write commits, the gate fails: admission stays not ACTIVE and FENCED stays non-authoritative | W5-7, D-11, WX-2, SAFE.5 |
| AX-61 | Lock order | No guarded path acquires the admission row after an order lock; L1, pause, containment and the restore procedure vs concurrent mutations complete without deadlock | Service concurrency | Lock-order test; writer map | A lock timeout aborts with no effect | W5-2, W5-7 |

## 2. Journal and work authorization (A7)

| ID | Scenario | Required behavior | Level | Expected evidence | Fail-closed outcome | Dependency |
|---|---|---|---|---|---|---|
| AX-9 | PRE_ENROLLMENT bootstrap (J-1) | An eligible actor on a pre-enrollment order receives J-1; the journal can hold only an ENROLL intent (scan, undo, ACQUIRE, completion and shipment refused); UNKNOWN history → refused; after ENROLL, an empty journal for the enrolling actor → denied (J-3 required) | API, Browser | Context basis J-1; refusals | Deny | W5-3, W5-6 |
| AX-10 | Other actor without a grant | No work authorization (ACQUIRE refused); no empty journal after enrollment | API, Browser | Refusals | Deny | W5-3, W5-6 |
| AX-11 | First-use grant issuance | Only an Admin acting as itself, not to itself; conditions per A7.4 (coordinated PICKING/PACKING, no claim, no unresolved reconciliation, case or hold, history-free grantee with known history, current epoch); APPLIED → grant, epoch + 1, receipt and audit in one transaction; refusals → REJECTED receipt or pre-acceptance refusal | API | Grant record; epoch + 1; receipts | Deny | W5-1, W5-3, W5-4 |
| AX-12 | Erased journal | Only J-3: Admin JOURNAL_RESET with clearing fence and REQUIRED `JOURNAL_RESET` reconciliation; absent receipts never authorize; not authoritative for live use before W5-7 and D-11 | API, Browser (IndexedDB deleted) | Reset record and REQUIRED reconciliation | Deny | W5-3, W5-6, W5-7, SAFE.4, D-11 |
| AX-64 | Grant before the first ACQUIRE | ENROLL (epoch 1) → Admin grant (epoch 2) → an ACQUIRE expecting 1 is REJECTED as stale with a durable receipt; the client re-reads trusted context and a new intent expecting 2 by an actor with work authorization applies (2 → 3). Grant vs ACQUIRE on the order lock: the first commit wins; the other is REJECTED (stale, or `GRANT_CLAIM_ACTIVE`). Grant fencing, history and idempotency rules unchanged | API, Browser | Receipts; epoch values; context reads | No claim from a stale or client-derived epoch; the REJECTED identity is never re-sent | W5-2, W5-3, W5-6, AC-1 |
| AX-60 | Grant fence, history and replay | A pre-grant in-flight request is REJECTED as stale; a grantee with any receipt in any namespace is refused (J-3 path); replay of the same key returns the original receipt with no second advance; a different fingerprint → PAYLOAD_CONFLICT; after revocation the grantee's ACQUIRE is refused; after the grantee's first receipt an empty journal requires J-3 | API | Receipts; epoch values | Deny | W5-3, W5-4 |

## 3. Legacy orders and guarded shipment (A8.5, A8.7, A9)

| ID | Scenario | Required behavior | Level | Expected evidence | Fail-closed outcome | Dependency |
|---|---|---|---|---|---|---|
| AX-13 | Legacy order with an unresolved reconciliation (incl. `LEGACY_CUTOVER`) | HELD: guarded legacy scan, undo, completion, shipment and cancellation refused `LEGACY_ORDER_HELD` | API | No counter, status, stock or audit change | Hold | W5-7 |
| AX-14 | Legacy order without a continuation record after first activation | HELD by default | API | Refusal | Hold | W5-7, LC-4 |
| AX-15 | Legacy order with a valid continuation record | Approved, current restore generation, not revoked, no later reconciliation → finishes on guarded legacy paths with legacy (unkeyed) semantics; never enrollable | API | Existing behavior unchanged; ENROLL REJECTED | A missing, revoked, stale or invalidated record → HELD with no effect (AX-13, AX-14, AX-48); ENROLL always REJECTED | W5-7 |
| AX-16 | Legacy scan, undo or completion on a coordinated order | Refused 409 `ORDER_COORDINATED` through direct FastAPI and the BFF | API | No effect | Refuse | W5-7 |
| AX-46 | Guarded shipment of a coordinated READY_TO_SHIP order | No claim, no unresolved reconciliation, no restore hold, no open or ESCALATED cancellation case, admission ACTIVE (or PAUSED with every condition) → shipment with the existing deduction, movements, stock transactions and audit | API | Ledger rows identical to the existing shipment path | If any A8.7 condition fails → refused with no effect (AX-47) | W5-7 |
| AX-47 | Shipment refusals | Active claim, unresolved reconciliation, restore hold, HELD legacy order, wrong status, CONTAINED or RESTORE_SUSPECTED → refused with no effect | API | No ledger, reservation or audit change | Refuse | W5-7 |
| AX-48 | Continuation invalidated | A new reconciliation, restore-generation change, revocation or detected unattributed mutation → HELD; CONTAINED or RESTORE_SUSPECTED hold the order while they last; the order's own legacy progress does not invalidate | API | Refusals after each invalidating event | Hold | W5-7, SAFE.4 |

## 4. Cancellation (A10)

| ID | Scenario | Required behavior | Level | Expected evidence | Fail-closed outcome | Dependency |
|---|---|---|---|---|---|---|
| AX-17 | Ordinary cancellation after picking starts | Coordinated PICKING/PACKING/READY_TO_SHIP refused `CANCELLATION_REQUIRES_SUPERVISED_PROCEDURE`; legacy orders in those states refused after first activation (SC-1) | API | No reservation release | Refuse | W5-7, SC-1 |
| AX-18 | Supervised cancellation, happy path | Case opened (case fence; at MAX only when no claim is held) → every uncertain operation settled → put-back record with `returned = picked` per allocation → approval by an Admin who is not the maker → one atomic cancellation | Service, API | PB digest; approval record; reservations released once at the end; `on_hand` unchanged; no stock-in, movement or stock transaction | Any failed prerequisite → no cancellation and no release (AX-19 to AX-21, AX-49 to AX-52); the case keeps blocking the order (AX-63) | SAFE.4 |
| AX-19 | Unsettled operation | Approval refused while any operation is UNKNOWN; closing the reconciliation or case never settles it | Service | No effect | Refuse | SAFE.4, D-11 |
| AX-20 | Maker = checker | Refused (O-5) | Service | No effect | Refuse | SAFE.4 |
| AX-21 | Stale state at approval | Changed epoch, revision, status or reconciliation, or a superseded put-back record → REJECTED receipt | Service concurrency | Receipt; no effect | Refuse | SAFE.4 |
| AX-49 | Put-back quantity failures | Short, zero while staged, or excess → ESCALATED at approval; duplicate, unknown or missing allocation lines, or non-canonical decimals → refused 422 at recording; no release in any case | Service | No reservation change | Refuse or hold | SAFE.4 |
| AX-50 | Approval binding | The approval cites PB ID and digest; a digest mismatch or a non-latest PB → REJECTED. A request with a **different** approval identity after the case is resolved is a distinct business operation and is REJECTED (case already resolved); a PB is approved at most once. The **same** approval identity → replay (AX-52) | Service | Receipt; uniqueness | Refuse | SAFE.4 |
| AX-51 | Cancellation atomicity | Fault at each step of the approval transaction → nothing persisted; success → approval, status, reservation release, audit, receipt and case closure all present | Service | Fault-injection log | No partial state | SAFE.4 |
| AX-52 | Cancellation approval response lost | Lookup of the approval key, or replay with the **same** approval identity and fingerprint → the single recorded outcome (idempotent replay). Same identity, different fingerprint → PAYLOAD_CONFLICT | API | One receipt; one reservation release | No second cancellation | SAFE.4 |
| AX-63 | Put-back recording failed or lost, then attempted abandonment | The case stays OPEN and blocking. No abandonment operation exists. ACQUIRE, scans, completion, shipment, grants and legacy mutations are refused. A lost recording response is resolved by lookup or replay of the same key; a failed recording may be followed by a new keyed recording. A missing record is never treated as "no physical handling". A case that cannot complete safely → ESCALATED with an escalation record and operator escalation; there is no A11 S6 resumption | Service, API | Case state; refusals; escalation record | Order blocked; ESCALATED has no V1 exit | SAFE.4, SC-5, RC-1 |

## 5. Minimum SAFE.4 (A11)

| ID | Scenario | Required behavior | Level | Expected evidence | Fail-closed outcome | Dependency |
|---|---|---|---|---|---|---|
| AX-22 | Matched count does not settle an attempt | Legitimate workflow: after RESOLVED_MATCHED the client gate still blocks a new ACQUIRE until its own local operation is RECORDED or authoritatively ABSENT_FENCED | Service, Browser | Gate blocks; lookup result | Block | SAFE.4, W5-6 |
| AX-23 | Count binding, supersession and fence-before-settle | Approval cites count ID and digest bound to reconciliation, epoch, revision and status; a takeover or unverified release supersedes the reconciliation and the approval is refused; an operation at the current epoch is settled only after a committed newer epoch; a takeover is not treated as a clearing fence | Service concurrency | No resolution after supersession; fence before settlement | Refuse | SAFE.4 |
| AX-24 | Maker = checker | Refused (no exception) | Service | No resolution | Refuse | SAFE.4 |
| AX-25 | Coordinated active resumption | RESOLVED_MATCHED clears the claim and advances the epoch; work resumes only through a new ACQUIRE by an actor with work authorization | Service, API | Epoch + 1; old token unusable; new token only from ACQUIRE | No automatic resume | SAFE.4, W5-2 |
| AX-26 | Mismatch | ESCALATED; no counter change; no epoch consumed; ordinary transitions blocked | Service | Epoch unchanged | Hold | SAFE.4 |
| AX-27 | Admin no impersonation | `acting_supervisor` recorded; the Admin never acts as another actor | API | Receipt fields | Refuse impersonation | W5-1, W5-4 |
| AX-59 | Resumption by order class | Legacy → continuation record issued in the approval transaction; coordinated READY_TO_SHIP → shipment eligibility without PICK/PACK re-entry; restored orders → A13.5 release | Service, API | Per-class records | No automatic resume | SAFE.4, W5-7, D-3a |
| AX-62 | Inconsistent lifecycle evidence | Receipt regression, fingerprint mismatch or namespace mismatch → client INCONSISTENT and blocked; recovery only through J-3 or J-4 | Browser, API | Journal state | Block | W5-6, SAFE.4 |

## 6. Writer exclusion (A12)

| ID | Scenario | Required behavior | Level | Expected evidence | Fail-closed outcome | Dependency |
|---|---|---|---|---|---|---|
| AX-28 | Gates E-1…E-5 | Each failing gate prevents L1 and is recorded; continuous monitoring moves admission to CONTAINED on an unattributable session; passing gates alone are not accepted as complete exclusion | Operational rehearsal | Evidence record | Admission not ACTIVE | W5-7, SAFE.5 |
| AX-29 | Authoritative FENCED / ABSENT_FENCED before proof | Never emitted; lookups return UNKNOWN / ABSENT_NOT_FINAL | API | Lookup results | Block | W5-3, D-11 |
| AX-66 | Incident containment drill (injected bypass write) | In a disposable environment, a deliberately injected bypass write is detected (counters differ from applied receipts, or a status change without a lifecycle receipt) → order held through `DISCREPANCY_REPORTED`, admission CONTAINED, writer stopped by the runbook. Validates detection and containment **only**; never satisfies AX-28 or AX-45 and never authorizes FENCED / ABSENT_FENCED | Disposable stack, operational rehearsal | Detection and containment record | Held; admission CONTAINED until independently verified | W5-7, SAFE.5, D-11 |
| AX-30 | DB guard or role-separation feasibility | Only after separately approved disposable-PostgreSQL tests; if selected, the strategy covers every writer in the writer map, including jobs, scripts and maintenance | Disposable PostgreSQL | Test evidence | Not relied upon until proven | D-11, O-8, WX-2 |

## 7. Restore containment (A13)

| ID | Scenario | Required behavior | Level | Expected evidence | Fail-closed outcome | Dependency |
|---|---|---|---|---|---|---|
| AX-31 | Restore drill | Procedure: CONTAINED, rotation, generation + 1, claim fences, `RESTORED` reconciliations, R-6, R-5, anchor re-baseline; every mutation-capable order held, including READY_TO_SHIP and SHIPPED/COMPLETED return paths; release per class by a maker and a different Admin; old journals NAMESPACE_MISMATCH | Disposable stack | Drill evidence | Admission not ACTIVE until the procedure completes | W5-7, SAFE.4, SAFE.5 |
| AX-32 | Clone or replacement | A clone used as a replacement follows the full procedure; a non-production clone has its namespace rotated, admission not ACTIVE and no production clients | Disposable stack | Rotation and procedure records | Block old journals | W5-1, W5-7 |
| AX-53 | READY_TO_SHIP shipped after the backup, then restored | Held; shipment refused; release refused without shipment-status evidence; evidence of shipment → ESCALATED; no duplicate deduction | Disposable stack | Hold and escalation records; refusals | Held indefinitely | W5-7, SAFE.4, SAFE.5 |
| AX-54 | PICKING at backup, shipped after the backup, restored | Held; a matched count alone is insufficient; the shipment-status check → ESCALATED | Disposable stack | Hold and escalation records | Held | W5-7, SAFE.4 |
| AX-55 | Untrusted restore provenance | Anchor unavailable, anchor ahead of the database, or inconsistent provenance → RESTORE_SUSPECTED: every guarded mutation, every hold release and L1 refused; an OID comparison alone never establishes trust | Disposable stack | Refusals | Refuse all | W5-1, W5-7, R-1 (CONDITIONAL) |

## 8. Barcode and scanning (A14)

| ID | Scenario | Required behavior | Level | Expected evidence | Fail-closed outcome | Dependency |
|---|---|---|---|---|---|---|
| AX-33 | Exact identity incl. U+001D, Thai, astral, NFC ≠ NFD, leading zeros | Accepted byte-exact; distinct digests for NFC and NFD | Service, Browser | Fixture `barcode_positive_vectors` | No implicit equivalence: a barcode differing in any code point does not match (no transformation or normalization is applied to make it match); invalid input → AX-34 | W5-2, W5-6 |
| AX-34 | NUL, lone surrogate, 101 code points (ASCII and astral), empty | 422; no effect | API | Fixture `barcode_negative_vectors` | Refuse | W5-4 |
| AX-35 | Live input transformations | No trim, minimum 1 code point, code-point length (never UTF-16 units), no time-based suppression | Browser | Fixture `scanner_transformation_vectors` (`scan-no-trim`, `scan-min-one`) | Input is submitted unchanged or refused visibly; it is never transformed. Out-of-range input → AX-34 | W5-6 |
| AX-36 | Whitespace, other controls and zero-width characters (O-9) | Decision placeholder: not executable until O-9 is decided; until then identity-preserving (neither rejected nor transformed) | Decision gate | Fixture `barcode_pending_o9_vectors`; owner decision record | No transformation | O-9 (before W5-4) |
| AX-37 | Existing data and scanner compatibility | Authorized read-only inventory and device checks | Operational | Assessment report | Activation blocked until done | SAFE.5 |
| AX-57 | Repeated scan while the first is pending | Refused visibly; no attempt created, nothing queued, no second dispatch | Browser | Fixture `scanner_transformation_vectors` (`scan-repeat-while-pending`): attempts 1, dispatches 1 | Refuse | W5-6 |
| AX-58 | Identical repeated scan after settlement | With explicit confirmation of a new physical action: a new key, an equal client fingerprint, dispatched only after the first settled | Browser | Fixture `scanner_transformation_vectors` (`scan-repeat-after-settle`) | Without explicit confirmation, or before the first settles → refused as in AX-57; never queued | W5-6 |

## 9. Epoch headroom (A15)

| ID | Scenario | Required behavior | Level | Expected evidence | Fail-closed outcome | Dependency |
|---|---|---|---|---|---|---|
| AX-38 | P1 safety | Every "advances and leaves no claim" transition permitted up to MAX − 1; no permanently held claim is created after the headroom rule is enforced; existing or restored claims at MAX → AX-65 | Service (model and tests) | Budget proof | Without the proof W5-2 does not start; at runtime a transition that would exceed MAX is refused with no effect | Before W5-2 |
| AX-39 | P2 liveness | Phase-aware reserve; supervised-cancellation exit; no claim that finite reserves guarantee completion | Service | Budget proof | Refuse claim creation with `FULFILLMENT_EPOCH_HEADROOM_EXHAUSTED` | Before W5-2, SAFE.4 |
| AX-40 | No wrap, reset or arbitrary advance | Never | Service | Constraint tests | Any request that would wrap, reset, widen or advance beyond MAX is refused with no effect (`FULFILLMENT_EPOCH_EXHAUSTED`); a held claim at MAX → AX-65 | W5-2 |
| AX-56 | Recovery at or near MAX | Clearing fences permitted at expected ≤ MAX − 1; claim creation refused near the threshold; at MAX the claim state is checked under the order lock, and only with no held claim do supervised cancellation and guarded shipment remain available | Service (model and tests) | Budget proof and boundary tests | Refuse claim creation; a held claim at MAX → AX-65 | Before W5-2, SAFE.4 |
| AX-65 | Pre-existing or restored held claim at MAX | The exhausted-claim gate refuses every guarded mutation, including the holder's attempts and lifecycle operations. Case opening, JOURNAL_RESET, resolution fence, restore fence and grants are refused. Operations at MAX stay UNKNOWN (no authoritative absence). A supervised escalation record is required. No reset, wraparound, widening or arbitrary advance | Service (model and tests), Disposable stack | Refusals; escalation record; epoch unchanged at MAX | Order blocked until a separately approved recovery policy (RC-1) | Before W5-2, W5-7, EP-2 |

## 10. Deferred and governance items (A17)

| ID | Scenario | Required behavior | Level | Expected evidence | Fail-closed outcome | Dependency |
|---|---|---|---|---|---|---|
| AX-41 | D-9 ambiguous shipment | Manual handling; no automatic retry; the state guard prevents double deduction | API, operational | Order status, `shipment_number`, movement ledger and audit | No retry; a second shipment is refused | W5-7 |
| AX-42 | D-2 access scope | Governance gate: decided before W5-4 | Decision gate | Owner decision record | W5-4 blocked until decided | D-2 |

## 11. Status

All 66 AX scenarios (AX-1…AX-66) are **OPEN / NOT IMPLEMENTED**.
