# WP-5 Backend/BFF fulfillment contract (W5-0 DRAFT)

| | |
|---|---|
| **Status** | DRAFT, not frozen. Owner decisions in §19 are PROPOSED or UNRESOLVED; none is approved. Nothing in this document is implemented, mounted or activated. Remediated 2026-10-27 for Codex post-implementation findings F-1…F-8 (§22) |
| **Package** | W5-0, documentation only. Companion files: `docs/wp5-acceptance-matrix.md` and `tests/fixtures/wp5_contract_vectors.json` |
| **Baseline** | `integration/v1-final` @ `7a2d9dbfe68d9d4ccd51a59487f28a4632494d89` (uncommitted worktree). R5-SAFE.3 is accepted for **non-routable simulation only** (WP-4) |
| **Labels** | VERIFIED = established from source during W5-0 · INFERENCE = proposed design · UNKNOWN = not established. Every normative "must" below is PROPOSED until the contract is frozen |

## 1. Scope and non-goals

**In scope:** this document defines the proposed production contract between:

- the FastAPI backend;
- PostgreSQL persistence;
- the Next.js BFF;
- the R5-SAFE.3 coordinator and journal;
- a future isolated live transport.

**Out of scope (non-goals for W5-0):**

- code, migrations, route mounting, BFF changes and frontend changes;
- shipment idempotency and recovery (§13.3);
- SAFE.4 reconciliation corrections;
- deployment;
- any change to the accepted SAFE.3 simulation or to the 57 frozen files.

**Guarantee targeted:**

- at most one committed effect per stable operation identity (attempt key or lifecycle intent ID), with durable outcome recovery;
- no claim that two *different* keys are the same physical action.

## 2. Sources

1. **Codex** "WP-5 READ-ONLY AUDIT REPORT" (§1–17). This is the architecture baseline and package numbering.
2. **Claude** W5-0 read-only design report, T1 reconciliation report, and final Codex reconciliation (2026-10-26). These supersede earlier Claude drafts where they conflict.
3. **ChatGPT** independent design-review corrections, as relayed by the owner.
4. The repository source at the baseline, cited inline.

## 3. Verified current state

| ID | Fact | Reference |
|---|---|---|
| C-1 | The claim router exists but is **not mounted**; `app/main.py` has no fulfillment router | `app/routers/fulfillment_claim_router.py`; `app/main.py` |
| C-2 | The mounted scan, undo, start-picking, complete-picking/packing, cancel and ship services contain **no claim or reconciliation checks**. Characterization tests show that identical unkeyed scans both apply and that `Idempotency-Key` is ignored | `app/services/sales_order_service.py`; `app/routers/sales_order_router.py:431-490`; `tests/test_r5safe_characterization.py:208,218,306,318` |
| C-3 | A keyed scan/undo service (non-routable) writes counter, audit and receipt atomically; REJECTED receipts for allowlisted terminal rejections; savepoint rollback | `app/services/fulfillment_integrity_service.py:456-528` |
| C-4 | Attempt receipts are unique per `(sales_order_id, operation_key)`. Replay compares the **fingerprint before the actor**, which discloses key existence across actors | migration `ed1a00000001`; service `:484-489` |
| C-5 | Business fingerprint `attempt_fingerprint` v1 ≠ client digest `sha256(canonical({scope,payload}))` | service `:151-167`; `frontend/src/lib/fulfillment/attempt.ts` |
| C-6 | `_attempt_view` lacks scope, fingerprint, evidence ID and status. The generic `app_exception_handler` **drops** `FulfillmentAttemptRejected.attempt` | service `:443-453`; `app/core/exception_handler.py` |
| C-7 | No lifecycle intent ID, lifecycle receipt or receipt-only lookup exists. Acquire/takeover deliver the token once | service `:238-286`; `app/repositories/sales_order_repository.py:293-308` |
| C-8 | No progress revision, recovery namespace or server-side journal authorization | grep over `app/` (0 matches) |
| C-9 | Authorization is role-wide (warehouse/admin); same-user takeover is allowed with a reason (opens a `SELF_TAKEOVER` REQUIRED reconciliation); cross-user takeover is Admin-only | service `:136-144, :238-286` |
| C-10 | The BFF allow-lists every legacy fulfillment route, forwards only `idempotency-key`, has no Origin check (relying on `SameSite=Lax` cookies) and no upstream timeout | `frontend/src/app/api/bff/[...path]/route.ts:18-171`; `frontend/src/lib/api/server.ts:88-124` |
| C-11 | The request logger records raw query strings | `app/middleware/request_logger.py:43` |
| C-12 | Completion requires exact, fully counted allocations; PACK completion → `READY_TO_SHIP`. The simulated COMPLETE toggles the phase and sends no counts | `sales_order_service.py:174-210`; `frontend/fulfillment-harness/fixture-server.ts:59` |
| C-13 | Client lifecycle evidence settles only when `epoch > expectedEpoch` | `frontend/src/lib/fulfillment/store.ts:164` |
| C-14 | Barcode limits: client `max(200)`, backend `max_length=100`, `products.barcode String(100)` | `contracts.ts:18`; `app/schemas/sales_order_schema.py:71`; `app/models.py:62` |
| C-15 | Locks: the order row `FOR UPDATE`; `lock_inventory` (sorted products → batches → balances), also called by the scan core; `UnitOfWork` rolls back on any exception | `sales_order_repository.py:113-130`; `stock_balance_repository.py:26`; `app/core/unit_of_work.py` |
| C-16 | Migration `ed1a00000001` seeds `LEGACY_CUTOVER` REQUIRED reconciliations and refuses downgrade once history exists | migration `ed1a00000001` |
| C-17 | Client `canonical()` emits the bare word `undefined` for an explicit undefined value, and JSON.stringify escapes lone surrogates, which Python cannot encode | `attempt.ts:11-16`; executed in W5-0 |
| C-18 | `FULFILLMENT_RECONCILIATION_UNRESOLVED` is an **accepted terminal business rejection**: it is in `TERMINAL_REJECTION_CODES`, is raised inside the savepoint, and commits a REJECTED receipt (with `reconciliation_id`). The receipt replay check runs before it, so a recorded key replays REJECTED even after the reconciliation is resolved | service `:81-91`, `:484-516` |
| C-19 | The BFF parses the request body (`req.json()`) and re-serializes it (`JSON.stringify`), so lexical number forms such as `3.0` reach FastAPI as `3` | `route.ts:218`; `server.ts:96`; executed in W5-0 remediation |

## 4. Safety invariants (preserved; any violation is a STOP condition)

- **I-1:** Every inventory change is traceable through an auditable transaction. Picked/packed are counters; on-hand stock is deducted only at shipment.
- **I-2:** One committed effect per stable identity. Mutation, audit and receipt commit in **one** transaction.
- **I-3:** HTTP status, request IDs, current counters or a changed context **never** settle an uncertain operation.
- **I-4:** UNKNOWN or ABSENT_NOT_FINAL never releases an input gate. Lookups never mutate.
- **I-5:** No epoch advance is fabricated. A claim bearer token is never stored, replayed or regenerated.
- **I-6:** An empty browser journal never authorizes work without positive server evidence (§11).
- **I-7:** Fail-closed on any uncertain, inconsistent or unavailable evidence.
- **I-8:** The accepted SAFE.3 simulation, the frozen files and historical migrations are unchanged by WP-5 unless separately approved.

## 5. Identity and canonicalization

### 5.1 Request identity

| Element | Rule |
|---|---|
| `contract_version` | Integer `1`, in the request body |
| `scope.deployment` | Server-issued recovery namespace (UUIDv4, lowercase). Must equal the active namespace (D-1) |
| `scope.actor` | Must equal the authenticated database user ID. It is never authority |
| `scope.order` | Must equal the path `order_id` |
| `key` / `intent_id` | UUIDv4, lowercase canonical (`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`). Attempts carry `key`; lifecycle requests carry `intent_id`. The `Idempotency-Key` header must equal the body `key` (attempts) or the body `intent_id` (lifecycle); a mismatch is rejected with no effect. This is narrower than the existing `KEY_PATTERN` |
| `fingerprint` | Client-supplied. **The server recomputes it** (§5.4); a mismatch is rejected with no effect |

### 5.2 Payload fields

**Attempt payload:** `operation` (`SCAN_PICK`, `SCAN_PACK`, `UNDO_PICK`, `UNDO_PACK`), `phase` (`PICK`/`PACK`, which must match the operation), `epoch`, `quantity`, `barcode` (scan only, required), `allocation_id` (required for undo, optional for scan).

**Lifecycle payload:** the existing client fields (`kind`, `phase`, `expectedEpoch`, `progressRevision`, `reason?`, `confirmed?`, `mode?`, `counts?`). COMPLETE gains `counts` (§14).

### 5.3 Canonical JSON (`canonical-json/1`)

- **Encoding and layout:** UTF-8; object keys sorted (keys are ASCII); no whitespace.
- **String escaping:** exactly ECMAScript `JSON.stringify`: `"`, `\`, `\b \f \n \r \t`, other U+0000–U+001F as `\u00xx`. Every other character is raw.
- **Numbers (owner-approved W5-0 documentation rule, 2026-10-27):** integer fields (`epoch`, `expectedEpoch`, `allocation_id`, `actor`, `order`) are validated **semantically after JSON parsing and BFF normalization**:
  - the parsed value must be an integer value within the field's bounds (epochs 0…2147483647; identifiers 1…2147483647);
  - JSON `3` and JSON `3.0` are equivalent after parsing and are both accepted as the integer 3;
  - `3.5`, the string `"3"`, booleans, negative values where prohibited, and out-of-range values are rejected;
  - strings are never coerced to numbers;
  - the canonical digest is computed over the parsed, validated representation, in which the value is the integer `3`;
  - lexical distinctions such as `3` versus `3.0` are not guaranteed to survive the existing BFF transformation (C-19), so nothing may depend on them. This is a documentation rule only; it authorizes no BFF change.
- **`null`:** forbidden in requests. Optional fields are **omitted**.
- **`undefined`:** impossible in JSON. The client adapter must reject it before hashing (C-17).
- **Unicode:** scalar values only; lone surrogates are rejected; **no normalization** (byte-exact identity).
- **Python equivalent:** `json.dumps(v, sort_keys=True, separators=(",",":"), ensure_ascii=False)`.

### 5.4 Fingerprints

| Algorithm | Definition | Where |
|---|---|---|
| `client-fingerprint/1` | Lowercase hex SHA-256 of the UTF-8 `canonical-json/1` of `{"scope":{actor,deployment,order},"payload":…}`; identical to today's client `digest({scope,payload})` | Client computes; server recomputes from the session actor, active namespace, path order and received payload |
| `business-fingerprint/attempt/1` | Existing `attempt_fingerprint()` version 1 (actor excluded) | Server only; never returned |
| `business-fingerprint/lifecycle/1` | **PROPOSED:** SHA-256 of canonical `{version:1, sales_order_id, kind, phase, expected_epoch, progress_revision, mode?, confirmed?, reason?, counts?}`, with `counts` sorted by `allocation_id` and absent optional members omitted | Server only |

Both validated fingerprints and their algorithm IDs are stored per receipt. A supplied fingerprint is never accepted without recomputation.

### 5.5 Decimal and barcode rules

- **Quantity:** `^(0|[1-9]\d{0,14})\.\d{3}$`. Scan and undo require a value > `0.000`. The maximum is `999999999999999.999`. Non-canonical text and JSON numbers are rejected.
- **Barcode:** byte-exact; leading zeros preserved; no trim; no normalization. **Charset and length are UNRESOLVED (D-14):** client 200 vs backend 100 (C-14).

### 5.6 Test vectors

The vectors live in `tests/fixtures/wp5_contract_vectors.json`:

- the seven preserved positive vectors;
- boundary vectors;
- a same-key conflict set;
- negative vectors, with descriptors where JSON cannot represent the input;
- D-14-pending vectors;
- binding vectors.

**All computed values come from copied algorithms.** They are pending verification against the backend `attempt_fingerprint()` in W5-2 (pytest), against the frontend `digest()` in W5-6 (Vitest), and an independent Codex recomputation.

**A valid digest is not an authorized or successful business operation.** Each computed vector carries a machine-readable `classification` (digest validity, request-schema validity, business prerequisites, digest-only boundary, and its role as a positive, baseline or conflicting variant).

## 6. API surface (PROPOSED; built as unmounted HTTP adapters in W5-4, mounted only by the W5-7 integration, activated only by a separate owner decision)

Prefix: `/api/v1/sales-orders/{order_id}/fulfillment`. This reuses the existing claim-router prefix.

| Method / path | Purpose | Mutates? |
|---|---|---|
| `GET /context` | Trusted context (§11) | No |
| `POST /attempts` | Keyed scan/undo | Yes, at most once per key |
| `POST /attempts/lookup` | Receipt-only attempt lookup | **No** |
| `POST /claim/acquire` | Lifecycle ACQUIRE | Yes, at most once per intent |
| `POST /claim/takeover` | Lifecycle TAKEOVER (explicit confirmation and reason) | Yes |
| `POST /claim/release` | Lifecycle RELEASE (verified counts or unverified reason) | Yes |
| `POST /claim/complete` | Lifecycle COMPLETE (§14) | Yes |
| `POST /claim/validate` | Validate the current credential; never rotates | No |
| `POST /lifecycle/lookup` | Receipt-only lifecycle lookup | **No** |
| `POST /history/lookup` | Authorized, paginated history for restoration assessment | **No** |
| `POST /lifecycle/fence` | Explicit, authorized fence of an unresolved intent (§9.4) | Yes |

**Common rules:**

- Lookups use a POST body because query strings are logged (C-11).
- Responses are `Cache-Control: no-store`.
- Tokens appear only in the single successful acquire/takeover response.
- Private route handling must preserve receipt evidence on business errors (C-6).

## 7. Envelopes

### Request

```json
{"contract_version":1,"scope":{"deployment":"<ns>","actor":17,"order":101},"key":"<uuid>","fingerprint":"<64hex>","payload":{"operation":"SCAN_PICK","phase":"PICK","epoch":8,"barcode":"00001234","allocation_id":501,"quantity":"1.001"}}
```

Headers:

- `Idempotency-Key` (= `key` for attempts; = `intent_id` for lifecycle requests, which use the same envelope with `intent_id` in place of `key`);
- `X-Fulfillment-Claim-Token` and `X-Fulfillment-Claim-Epoch`, where the route requires them.

### Attempt evidence (client-compatible shape)

```json
{"kind":"RECORDED","scope":{"deployment":"<ns>","actor":17,"order":101},"key":"<uuid>","fingerprint":"<64hex>","outcome":"APPLIED","epoch":8,"historical":true,"replayed":true,"recordedAt":"2026-10-26T16:00:00Z","evidenceId":"<stable>","status":200}
```

- `status` is the **recorded operation status**: 200 for APPLIED; the allowlisted 404/409 for REJECTED. It is distinct from the lookup's HTTP status.
- Snapshots are historical; current progress comes from `/context`.

### Absence and other results

- `ABSENT_NOT_FINAL`;
- `ABSENT_FENCED` (§10; never authoritative before W5-7);
- lifecycle `UNKNOWN`;
- `UNAVAILABLE` / `INCONSISTENT`, which keep the gate held.

### Lifecycle evidence

The same scope, `intentId` and `fingerprint`, plus `outcome` (`APPLIED`, `REJECTED` or `FENCED`), `expectedEpoch`, `resultingEpoch`, `evidenceId` and `status`. It is never token-bearing.

## 8. Attempt semantics

### 8.1 Processing order (one `UnitOfWork`; no nested committing wrappers)

1. Authenticate.
2. Validate the envelope (§5).
3. Lock the order.
4. **Authorize receipt ownership** (§8.3), then look up `(order, key)`.
5. Existing receipt:
   - matching fingerprints → RECORDED replay;
   - otherwise → PAYLOAD_CONFLICT (no effect).
6. New effect, pre-acceptance checks: verify the namespace, the coordinated mode (§13) and the claim (token, holder, epoch, phase and status). A failure here writes no receipt (§8.4).
7. Accepted attempt: inside a savepoint, check the unresolved-reconciliation gate, then run the existing shared core, which already takes `lock_inventory`. An allowlisted terminal business rejection, **including `FULFILLMENT_RECONCILIATION_UNRESOLVED`**, rolls back the savepoint and commits a REJECTED receipt (§8.5).
8. Write the counter, audit, receipt and `progress_revision + 1`.
9. Commit, then return the evidence.

### 8.2 Replay and conflict

- **Replay:** never re-executes; returns the original outcome with `replayed: true` and `historical: true`.
- **Conflict:** blocking; never authorizes a replacement key.

### 8.3 Cross-actor privacy

- **Authorization first:** ownership is checked **before** any fingerprint comparison.
- **Indistinguishable responses:** a wrong-actor submission returns 409 `FULFILLMENT_KEY_UNAVAILABLE`, and a wrong-actor lookup returns 404 `FULFILLMENT_RECORD_NOT_AVAILABLE`. Each is identical in status, body and headers to an absent key the caller may not use, with no receipt metadata.
- **Residual timing risk [INFERENCE]:** a lookup of an existing key performs an extra read and may wait on the order lock. UUIDv4 keys make probing infeasible. No artificial delay is specified.

### 8.4 Fail-closed

Pre-acceptance failures (authentication, malformed request, namespace, actor or order binding, invalid or missing claim) write no receipt and are **not terminal** for the client. The client stays uncertain and uses lookup. An unresolved reconciliation is **not** a pre-acceptance failure (§8.5).

### 8.5 Reconciliation rejection (existing backend behavior, preserved)

- `FULFILLMENT_RECONCILIATION_UNRESOLVED` is an accepted terminal business rejection (C-18). It produces a durable, correlated REJECTED receipt, which the client may settle as REJECTED.
- Once recorded, that stable operation identity **never becomes executable again**, even after the reconciliation is resolved: replay returns REJECTED, and new work needs a new key.
- This contract does not change the backend rejection allowlist or the receipt replay policy.

## 9. Lifecycle semantics

### 9.1 Identity and replay

- Each lifecycle request carries a stable `intent_id` and a validated fingerprint. The `Idempotency-Key` header must equal `intent_id`.
- Receipts are unique on `(sales_order_id, intent_id)`. The namespace is stored and validated but deliberately **not** part of the unique key: including it would let an intent re-execute after a namespace rotation.
- A duplicate with the same fingerprint returns the original nonsecret outcome. A different fingerprint is a conflict, with no second transition.

### 9.2 Outcomes

| Outcome | Durable evidence | Epoch |
|---|---|---|
| APPLIED | Receipt + audit + transition in one transaction | `resulting_epoch > expected_epoch` |
| REJECTED | Receipt with the recorded code/status, committed under the lock | Unchanged; settles **only** as this fingerprint-matched per-intent receipt |
| FENCED | §9.4 only | A genuinely committed newer epoch is required |
| UNKNOWN | No receipt | Never settles |

### 9.3 Tokens and takeover

- An APPLIED acquire/takeover receipt never contains the token. Recovering it settles history but leaves work **paused**.
- Resuming requires an explicitly authorized new claim action. Under current behavior (D-3) that is a same-user takeover with a reason, which opens a REQUIRED reconciliation; the gate is never released automatically.
- **Claim credentials are not device identity.** Authorization binds the current claim credential (bearer token, epoch, holder) and the authenticated actor. A second client without the valid current claim credential cannot mutate through the coordinated routes. A client presenting a *shared* valid credential is the same claim (as `app/core/fulfillment_claim.py` states), so V1 does not establish unique device identity. Device attestation or device binding is out of scope without separate authorization.

### 9.4 FENCED (PROPOSED extension; not a production guarantee)

FENCED evidence may be created **only** by `POST /lifecycle/fence`, an explicit operation authorized for an Admin, or for the original actor through takeover. It runs in one transaction under the order row lock and must:

1. find **no** lifecycle receipt for the intent;
2. verify that `current_epoch > intent.expected_epoch`, from a genuinely committed fence or transition (**no** epoch is fabricated);
3. write the FENCED row with provenance (fencing actor, observed epoch, reason) and an audit row.

**Ordering:** if a late request locks first, it applies and the fence is refused. If the fence locks first, the late request finds FENCED and replays it with no transition.

**FENCED is NOT authoritative until W5-7 proves that:**

- the v1 lifecycle route is the only path accepting intent IDs;
- every serving process has the receipt-first check;
- legacy writers are excluded.

FENCED proves *this intent can never apply*, not that the effect never happened (legacy paths could produce the same effect before W5-7). An HTTP 403/409, a missing receipt or a changed context is **never** proof.

### 9.5 Current frontend limitation (unchanged until the W5-6 package)

The client lifecycle states are `PERSISTED`, `SENDING`, `OUTCOME_UNKNOWN` and `RESOLVED`, and RESOLVED requires `epoch > expectedEpoch` (C-13). REJECTED and FENCED cannot be represented yet. Until then such intents stay blocked under the accepted B2-minimal behavior: supervised takeover, no cancellation.

## 10. Receipt-only recovery

- **Never mutates:** a lookup performs no business write, creates no receipt or tombstone, rotates no claim, issues no credential and cancels nothing. It may take the order row lock to read consistently.
- **RECORDED:** a matching committed receipt (namespace, original actor, key and both fingerprints).
- **ABSENT_NOT_FINAL:** no receipt observed. An earlier request may still apply, so it **never settles**.
- **ABSENT_FENCED (attempts)** requires all of:
  1. the order lock;
  2. receipt absence checked under that lock;
  3. a committed newer epoch;
  4. durable fence provenance;
  5. enforcement of the coordinated mode on every applicable path;
  6. no serving legacy writer;
  7. a matching namespace and original scope.
- **Before W5-7 proves conditions 5–6:** return ABSENT_NOT_FINAL unless an isolated test environment demonstrably supplies the complete fence.
- **Legacy receipts** (pre-contract rows with NULL client metadata) → `INCONSISTENT`; never served as v1 evidence.

## 11. Context and journal authorization

`GET /context` returns:

- namespace, actor and order;
- order status, plus phase **or terminal state**;
- epoch and holder;
- reconciliation status;
- `progress_revision` (string);
- exact allocation strings;
- the coordinated-cutover marker;
- `journal_authorization`.

**Empty-journal authorization requires positive, durable evidence. Absent receipts are never enough.**

| Basis | Condition | Meaning |
|---|---|---|
| **Initial enrollment** | `fulfillment_claim_epoch = 0` **and** no cutover marker | No claimed request can exist without a token, and the order has never been coordinated |
| **Restoration** | A recorded **supervised journal-reset fence** for this actor and order at epoch E, committed after the loss | Earlier in-flight claimed requests cannot apply under the claim check; the new journal starts at ≥ E |
| Anything else | Uncertain or inconsistent history | **Deny**, then supervised recovery (D-6) |

- **Automatic restoration** (rehydrating a journal from `/history/lookup`) is a future extension and is not part of this contract.
- **Before W5-7:** only initial enrollment applies, in isolated test environments.

## 12. BFF contract (W5-5)

- **Routes:** a dedicated allow-list for the §6 routes. The legacy fulfillment routes stay listed for legacy orders, but the backend refuses them for coordinated orders (§13).
- **Session:** capture **one** session credential per request and use it both to validate identity and to forward. Actor and role come only from the backend. The request scope actor must match, otherwise `ACTOR_MISMATCH` with no effect; this also covers a session change between attempt creation and dispatch.
- **Forwarded headers:** only the route-specific ones (`Idempotency-Key`, `X-Fulfillment-Claim-Token`, `X-Fulfillment-Claim-Epoch`). Caller-supplied actor or role headers are never accepted.
- **Same-origin:** every mutation requires a JSON content type and same-origin evidence (`Origin` equal to the app origin, or `Sec-Fetch-Site: same-origin`); otherwise 403.
- **Timeout:** bounded upstream timeout (value TBD in W5-5). A timeout, abort, reset or malformed body is classified `TRANSPORT_UNCERTAIN`.
- **No retries:** no automatic mutation retries or redirect fallback.
- **Error envelopes:** validated receipt evidence is preserved on business-error responses.
- **Secrets:** responses are `private, no-store`. Credentials never appear in URLs, logs, query strings, error envelopes or diagnostics.

## 13. Legacy bypass closure and the single guard (W5-7)

### 13.1 Marker

A persistent per-order coordinated marker (D-8). It is set atomically with the first coordinated action and never cleared.

### 13.2 Guard

One service-layer function, `assert_fulfillment_mutation_allowed(order, action)`, is called **inside the order row lock** by every fulfillment-affecting service, legacy or v1. For coordinated orders:

| Action | Policy |
|---|---|
| Legacy scan / undo / complete-picking / complete-packing | Refuse 409 `ORDER_COORDINATED` before any effect |
| v1 actions | Allowed only through the claimed contract |
| start-picking | Allowed (CONFIRMED → PICKING precedes any claim) |
| cancel | **PROPOSED, requires owner resolution (D-8):** refused while a claim is active or a reconciliation is unresolved; otherwise allowed. Supervised fence-and-cancel is future |
| ship | Allowed **only** when status is `READY_TO_SHIP`, **no** active claim (`fulfillment_claim_token_hash IS NULL`, guaranteed after a coordinated COMPLETE) and **no** unresolved reconciliation. A permitted shipment keeps the existing on-hand and reserved deduction, inventory movements, stock transactions and audit unchanged |
| Admin complete (`SHIPPED → COMPLETED`) | Unchanged |

**Denied actions have no effect:** no counter, status, reservation, stock, movement, stock-transaction, receipt or audit change.

**Coverage:** direct FastAPI calls, old browsers and API clients (clear upgrade/block response, no fallback). Old server processes must be drained or excluded before admission (D-11).

### 13.3 Shipment

- The existing physical stock deduction (on-hand and reserved), movements, stock transactions and audit are preserved unchanged.
- **Keyed shipment idempotency and recovery are NOT provided** (D-9); only the existing state guard prevents a second shipment.

## 14. Completion and terminal context

- **COMPLETE intent:** carries the exact allocation counts the operator confirmed, plus `progress_revision` (D-5).
- **Translation:** the server maps PICK → `complete-picking` and PACK → `complete-packing` through a transaction-free core (no nested commit). It validates exact membership, full counts and the revision under the lock, then fences.
- **Terminal context:** after PACK completion the order is `READY_TO_SHIP`, and the context reports a terminal state with no phase. This needs the client extension (W5-6).
- **Fixture behavior:** the simulated phase toggle (C-12) is not production evidence.

## 15. Transactions, locks and failure semantics

### 15.1 Locks

- **Lock order:** the order row `FOR UPDATE` first, then `lock_inventory` (sorted products → batches → balances).
- **Atomicity:** mutation, audit, receipt and revision commit atomically.
- **No nested commits:** transaction-free cores are extracted where needed.

### 15.2 Failures

| Failure | Required behavior |
|---|---|
| Flush failure | Rollback; no receipt; client uncertain |
| Receipt insert failure | Rollback, including the counter and audit |
| Audit insert failure | Rollback. Audit text is bounded to 500 characters |
| Commit failure | Rollback. If the commit may have succeeded, the outcome is **uncertain**: never terminal, resolved by lookup |
| Lost response after commit | RECORDED via lookup only |
| Deadlock or timeout | Uncertain |

### 15.3 Race orders: release vs in-flight scan

**Release first:**

1. Release verifies the claim and the epoch; VERIFIED counts must equal the counters, and `expected_progress_revision` must match.
2. Release fences the claim.
3. The scan then fails its claim check before acceptance (no receipt) and stays uncertain.

**Scan first:**

1. The scan applies and increments the revision.
2. A later VERIFIED release fails the count check and the revision check.
3. An UNVERIFIED release fails the revision check with a REJECTED receipt.

**Both orders:** an unresolved reconciliation blocks both paths.

### 15.4 Inventory concurrency

Scans and undo change counters only; shipment deducts stock. The required cross-operation tests are listed in the acceptance matrix (Codex #13).

### 15.5 Race orders: takeover vs in-flight attempt

Both paths take the order row lock first, so they serialize.

**A. The attempt commits before the takeover:**

1. The attempt's outcome is final and durably recorded:
   - **APPLIED:** exactly one committed business effect and a durable APPLIED receipt.
   - **REJECTED** (an accepted terminal business rejection, §8.5): zero business effects and a durable REJECTED receipt.
   - A rejected stable operation identity never becomes executable again merely because the blocking business condition later changes.
2. The takeover then advances the epoch and rotates the credential.
3. Both outcomes remain historically recoverable after the takeover: the original actor's authorized lookup, or an identical resubmission, still returns the historical RECORDED receipt (APPLIED or REJECTED): the replay check runs before claim verification (service `:484-493`), and this invariant is preserved.

**B. The takeover commits before the old attempt:**

1. The old attempt finds no receipt, and its claim verification fails (old token or epoch) **before acceptance**: no effect and no receipt (§8.4).
2. The old claim and epoch can never authorize a new effect, and no APPLIED effect is produced.
3. The client stays uncertain. A lookup returns ABSENT_NOT_FINAL until the ABSENT_FENCED conditions of §10 are proven (W5-7 enforcement and old-writer exclusion, D-11).
4. **No authoritative absence is fabricated**, and the backend business logic is unchanged.

## 16. Additive persistence (W5-1; PROPOSED)

- **Migration:** `ee1a00000001_wp5_fulfillment_contract.py`. Check the revision name for collisions immediately before W5-1; never edit `ed1a00000001`.
- **New tables and columns:**
  1. `fulfillment_namespaces`, with exactly one active row; rotated by the restore procedure (D-1, D-13);
  2. `fulfillment_lifecycle_receipts`: intent ID, scope (namespace, actor, order), validated fingerprints and algorithms, kind, phase, expected epoch and revision, outcome (`APPLIED`/`REJECTED`/`FENCED`), recorded status and code, resulting epoch, fence provenance, actor, timestamps. Unique on `(sales_order_id, intent_id)`. No token-bearing payloads;
  3. additive nullable columns on `fulfillment_attempt_receipts`: namespace, client fingerprint and algorithm, `contract_version`, canonical request. **Legacy rows are never back-filled with fabricated evidence**;
  4. on `sales_orders`: `fulfillment_progress_revision` (non-negative) and cutover marker and provenance columns.
- **Constraints:**
  - the existing `(sales_order_id, operation_key)` uniqueness is retained;
  - actor is **not** added to attempt uniqueness;
  - outcome/field checks;
  - an APPLIED lifecycle receipt requires `resulting_epoch > expected_epoch`;
  - non-negative epochs and revisions;
  - indexed actor/order history;
  - the existing partial unique reconciliation index is preserved.
- **Test impact:** the migration tests that hard-code the head (`test_migrations.py` and the phase 5/6/8/9 migration tests) are updated in W5-1.
- **Rollback:** a downgrade refuses once history exists. Recovery is a verified backup restore **with namespace rotation**, which blocks old journals.
- **Testing:** disposable PostgreSQL 18 only.

## 17. Frontend compatibility (no frontend change in W5-0)

The SAFE.3 simulation and its accepted behavior are unchanged. The future W5-6 package (separately approved) would need:

- lifecycle REJECTED and FENCED evidence and states;
- terminal context;
- the COMPLETE `counts` field;
- the D-14 barcode limits;
- a live transport, kept separate from the simulation transport.

## 18. Package sequence (Codex numbering)

| Package | Content |
|---|---|
| W5-0 | Contract decisions and vectors (this draft) |
| W5-1 | Additive persistence |
| W5-2 | Idempotent lifecycle core |
| W5-3 | Context and receipt-only recovery |
| W5-4 | Unmounted HTTP adapters |
| W5-5 | BFF contract |
| W5-6 | Isolated live adapter validation (+ client extension) |
| W5-7 | Legacy bypass closure and coordinated cutover |
| Activation | A separate owner decision |

**Dependencies:** W5-7 depends on both W5-2 and W5-6. Per-package file allowlists are those in Codex audit §13, and each package needs its own approval.

## 19. Owner decision register

**No decision is approved.** "Freeze gate" marks decisions that must be resolved before the contract can be frozen.

| ID | Topic (Codex §16) | Status | Recorded position | Freeze gate |
|---|---|---|---|---|
| D-0 | First package and allowlist (#1) | Owner-authorized **W5-0 draft only** | — | — |
| D-1 | Recovery namespace (#2) | **PROPOSED, NOT APPROVED** | Server-issued persistent namespace, rotated after backup restoration | Yes |
| D-2 | Access scope (#3) | Open | Role-wide as today; warehouse/order scoping reserved | No (before W5-4) |
| D-3 | Same-/cross-user takeover (#4) | **PROPOSED, NOT APPROVED** | Existing reasoned same-user takeover with a mandatory reconciliation; no automatic gate release | Yes |
| D-4 | Lifecycle rejection / fenced non-application (#5) | **PROPOSED, NOT APPROVED** | Durable lifecycle APPLIED, REJECTED and conditionally provable FENCED outcomes (§9.4) | Yes |
| D-5 | Completion / terminal context (#6) | **PROPOSED, NOT APPROVED** | Explicit allocation counts plus progress revision | Yes |
| D-6 | Erased-journal recovery (#7) | **PROPOSED, NOT APPROVED** | Supervised, fail-closed recovery without automatic restoration (§11) | Yes |
| D-7 | Receipt retention (#8) | Open | Retain all; unresolved evidence indefinitely | No (before W5-1) |
| D-8 | Per-order cutover (#9) | **PROPOSED, NOT APPROVED** | Persistent per-order coordinated cutover with server-side enforcement (§13); the conditional cancellation policy in §13.2 also requires owner resolution | Yes |
| D-9 | Shipment recovery scope (#10) | Open | Outside WP-5 | No (before W5-7) |
| D-10 | Frozen picking/packing pages (#11) | Open | Requires explicit scope at W5-7 | No (before W5-7) |
| D-11 | Readiness admission and writer drain (#12) | Open | Drain plus revision readiness gate, and/or a database writer guard | No (before W5-7/activation) |
| D-12 | SAFE.4 dependency (#13) | Open | Nothing blocked is released without SAFE.4 | No (before activation) |
| D-13 | Rollback / backup restore (Codex §9) | Open | Restore with namespace rotation; no history-discarding downgrade | No (before W5-1) |
| D-14 | Barcode policy (Codex §11) | **UNRESOLVED** | Charset compatibility; the 200 vs 100 length discrepancy (C-14); preservation of existing barcodes (database contents UNKNOWN); Unicode and canonicalization requirements | Yes |

## 20. Unknowns, blockers and STOP conditions

**Unknown:**

- the deployed database schema and version;
- the deployment topology and whether old writers can overlap;
- proxy timeout, retry and logging behavior;
- access-scope requirements;
- retention obligations;
- the restore procedure;
- other counter writers (scripts, admin tools);
- database-trigger feasibility;
- existing barcode contents;
- real multi-device behavior.

**Blockers (Codex §15, all open):**

1. mounted unkeyed paths;
2. missing lifecycle receipts;
3. missing recovery;
4. incompatible fingerprints and envelopes;
5. missing trusted context and restoration authorization;
6. missing progress revision;
7. missing BFF forwarding and actor binding;
8. the completion mismatch;
9. incomplete lifecycle failure resolution;
10. no coordinated activation mechanism.

**STOP if:**

- the protected baseline changes;
- edits exceed an approved allowlist;
- a receipt cannot be correlated without guessing;
- an old writer can bypass fencing;
- a migration would discard history;
- recovery would need to replay credentials or invent evidence;
- a test would need a weakened assertion;
- readiness cannot establish the schema and writer state;
- a register decision is treated as approved without owner sign-off.

## 21. Change control

This draft is amended only through owner-approved packages. Freezing requires:

1. owner approval of the freeze-gate decisions;
2. Codex's independent audit of this file, the matrix and the vectors;
3. explicit owner acceptance.

## 22. Remediation record (Codex post-implementation audit F-1…F-8, 2026-10-27)

| Finding | Correction | Location |
|---|---|---|
| F-1 Takeover race (blocker) | Both lock orderings specified; historical replay preserved; no fabricated absence | §15.5; matrix scenario 5 and matrix subsection 2.2 |
| F-2 Coordinated shipment / cancellation | Action-specific policy; permitted and denied shipment cases; denied actions have no effect; cancellation PROPOSED, owner resolution required | §13.2; §19 D-8; matrix scenario 10 and matrix subsection 2.1 |
| F-3 Credentials vs devices | Authorization binds the claim credential and actor, not device identity; shared-credential limitation | §9.3; matrix scenario 1 |
| F-4 Reconciliation rejection | `FULFILLMENT_RECONCILIATION_UNRESOLVED` is an accepted terminal rejection with a durable REJECTED receipt; never re-executable | C-18; §8.1; §8.4; §8.5 |
| F-5 Numeric canonicalization | Owner-approved semantic integer rule after parsing/BFF normalization | C-19; §5.3; fixture |
| F-6 Vector classifications | Machine-readable classification on every computed vector; conflict baseline separated | §5.6; fixture |
| F-7 Dependency gates | Preliminary vs authoritative fenced recovery; W5-6 for frontend settlement; SAFE.4 for reconciliation resolution | matrix scenarios 8 and 11 |
| F-8 Lifecycle identity and packages | `Idempotency-Key` = `intent_id`; W5-4 unmounted adapters only; frontend digest verification in W5-6 | §5.1; §5.6; §6; §7; §9.1 |
