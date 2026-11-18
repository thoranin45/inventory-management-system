# WP-5 acceptance matrix (W5-0 DRAFT)

| | |
|---|---|
| **Status** | DRAFT, not frozen. **No scenario is implemented or passed because it appears here.** Every row stays open until its tests run against the stated level and the evidence is independently reviewed. Remediated 2026-10-27 for Codex findings F-1, F-2, F-3, F-7 (scenarios 1, 5, 8, 10, 11) |
| **Companions** | `docs/wp5-backend-bff-contract.md` (section references below are to that document) and `tests/fixtures/wp5_contract_vectors.json` |
| **Packages** | Codex numbering: W5-0 contract and vectors, W5-1 persistence, W5-2 lifecycle core, W5-3 context and recovery, W5-4 unmounted HTTP adapters, W5-5 BFF, W5-6 isolated live adapter, W5-7 bypass closure and cutover |

## 1. How to read this matrix

- **Current behavior** distinguishes the **mounted legacy path** from the **service-only (unmounted)** claimed core.
- **Test levels:**

  | Level | Scope |
  |---|---|
  | Service | Python service against disposable PostgreSQL 18 |
  | API | FastAPI HTTP on disposable PostgreSQL |
  | BFF | Next.js route handler |
  | Browser | Real browser against a disposable stack |

- **Synthetic or simulation tests are never live-integration proof.**
- **Activation-blocking:** "Yes" means the scenario must be proven before any live activation decision.

## 2. Mandatory Codex scenarios 1–15

| # | Scenario | Current verified behavior | Required behavior | Test level | Expected evidence | Fail-closed outcome | Dependency | Blocks activation? |
|---|---|---|---|---|---|---|---|---|
| 1 | Two devices scan one order | **Mounted:** order lock serializes unkeyed scans and both apply (`test_r5safe_characterization.py:208,306`). **Service-only:** one authorized claim holder | Authorization binds the **claim credential and authenticated actor, not physical device identity**: a second client without the valid current claim credential cannot mutate through the coordinated route; acquiring needs an explicit takeover. **V1 limitation:** a client presenting a shared valid bearer credential is the same claim (no device attestation) | Service, API, Browser (separate clients; same-origin tabs are not separate devices) | Client without the current credential: no counter delta, no receipt, CLAIM_REQUIRED / CLAIM_INVALID (HELD on acquire) | No mutation without the current claim credential | W5-2, W5-4, W5-6; mounted path closed in W5-7 | Yes |
| 2 | Duplicate requests, same key | **Mounted:** key ignored (`:218`). **Service-only:** replay | One committed effect per key | API and BFF, sequential and concurrent | One counter delta, one receipt, one mutation audit row | Replay; never re-execute | W5-4, W5-5; mounted W5-7 | Yes |
| 3 | Same key, different payload | **Mounted:** both apply. **Service-only:** 409 conflict | PAYLOAD_CONFLICT, no second effect | Service, API, fixture `conflict_set` | Original receipt unchanged; conflict variants have distinct fingerprints | Blocked; no replacement key | W5-0 (vectors), W5-2, W5-4 | Yes |
| 4 | Commit succeeds, response lost | No correlated recovery on any mounted path | Tokenless `attempts/lookup` returns RECORDED for the original key | API, BFF, Browser | RECORDED with the same key and fingerprints; no new effect; lookup changes no rows | Gate held until RECORDED | W5-3, W5-4, W5-5, W5-6 | Yes |
| 5 | Request arrives after takeover | **Mounted:** bypasses claims. **Service-only:** stale epoch rejected before acceptance; replay precedes claim verification | Both lock orderings (subsection 2.2 below; contract §15.5): **A** attempt first → exactly one effect, APPLIED receipt durable, takeover follows, authorized historical recovery stays available; **B** takeover first → the old claim/epoch cannot authorize a new effect, no APPLIED effect, no fabricated absence | Service and API concurrency, both lock orders | A: one counter delta, one receipt, RECORDED on lookup after takeover. B: no effect, no receipt, ABSENT_NOT_FINAL | Blocked; ABSENT_FENCED only under contract §10 after W5-7 and D-11 | W5-2, W5-3, W5-4; authoritative absence W5-7 + D-11; client settlement W5-6 | Yes |
| 6 | Release while a scan is in flight | Service-level ordering tests exist; mounted scans bypass the claim | Both race orders per contract §15.3: claim, epoch, counts, `progress_revision`, reconciliation | Service, API concurrency | **Release first:** scan refused pre-acceptance, no receipt. **Scan first:** VERIFIED release 409 count or revision mismatch; UNVERIFIED release REJECTED on revision | Uncertain scan stays blocked; rejected release recorded | W5-1 (revision), W5-2, W5-4 | Yes |
| 7 | Lifecycle intent survives reload | Browser preserves intents (B2-minimal, simulation); backend has no intent correlation | Lifecycle receipts; lookup never reissues a token or repeats a transition | Service, API, Browser (reload before and after dispatch/commit) | APPLIED/REJECTED receipt per intent; no token in any receipt or log | Blocked until a correlated receipt; REJECTED/FENCED unrepresentable until W5-6 | W5-1, W5-2, W5-3, W5-6 | Yes |
| 8 | Journal erased, server history exists | Simulation refuses an empty journal; no live authority | Positive-evidence authorization only (contract §11): initial enrollment, or a supervised journal-reset fence | API, Browser (delete IndexedDB) | Context `journal_authorization` with its basis; ordinary work denied otherwise | Deny; supervised recovery | **Preliminary:** W5-3 (refusal and initial enrollment, service/API, isolated). **Authoritative restoration basis:** W5-7 enforcement + D-11 old-writer exclusion. **Browser settlement:** W5-6. **Reconciliation resolution:** SAFE.4 | Yes |
| 9 | BFF ambiguous error | Generic 502 envelope; no settlement proof | `TRANSPORT_UNCERTAIN`; no automatic retry | BFF unit, Browser (timeout, reset, abort, malformed body, commit then disconnect) | Attempt remains uncertain; no second request | Gate held | W5-5, W5-6 | Yes |
| 10 | Legacy routes bypass fencing | **Open** for scan, undo, completion, cancel, ship (contract C-2) | Action-specific single service-layer guard (contract §13.2; cases in subsection 2.1 below): legacy scan/undo/pick-pack completion refused; guarded shipment permitted only under its conditions with unchanged deduction semantics; cancellation per its PROPOSED conditional policy (owner resolution required) | API: direct FastAPI and BFF, every route; separate permitted and denied cases | Refused actions: 409 `ORDER_COORDINATED` or the guard refusal, with no effect. Permitted shipment: existing deduction, movements, stock transactions and audit exactly as today | Refuse before effects | W5-7 (cancellation also D-8) | Yes |
| 11 | Admin takeover during unresolved work | Core fences and opens a reconciliation; no client-intent receipt | Old attempt settles only historically (RECORDED) or by proven fence; Admin gets no automatic resume | Service, API | Receipts plus a REQUIRED reconciliation; no gate released | Blocked until SAFE.4 | **Preliminary:** W5-2, W5-3 (historical RECORDED; otherwise ABSENT_NOT_FINAL). **Authoritative fenced settlement:** W5-7 + D-11. **Frontend settlement:** W5-6. **Resume after reconciliation:** SAFE.4 | Yes |
| 12 | Transaction fails midway | UnitOfWork / savepoint design; non-terminal errors write no receipt | No partial commit for flush, receipt insert, audit insert or commit failure; ambiguous commit resolved by lookup (contract §15.2) | Service and API with fault injection | Counters, receipt and audit all absent after rollback; ambiguous case stays uncertain | Uncertain, never terminal | W5-2, W5-4 | Yes |
| 13 | Competing stock demand | Order lock + `lock_inventory`; constraints | Counters stay separate from stock; no negative availability | Service/API concurrency (`tests/test_wp5_inventory_regression.py`, W5-7) | Concurrent scans on one allocation (remaining limit); scan vs ship; ship vs stock-out; confirm vs stock-out / adjustment / transfer; ship vs return: no negative available, reservations consistent, complete ledger rows | Refuse conflicting operation | W5-7 (existing `tests/test_inventory_concurrency.py` retained) | Yes |
| 14 | Receipt exists, client metadata mismatches | Frontend rejects mismatched evidence; backend envelope incomplete | Wrong actor, order, deployment, key, digest, epoch or status → INCONSISTENT or the privacy response (contract §8.3) | Service, API, client unit (fixture `binding_vectors`) | No gate release; no receipt metadata or secrets leaked | Blocked | W5-3, W5-6 | Yes |
| 15 | Recovery unavailable / inconsistent | Frontend fails closed; live recovery absent | DB failure, incomplete history, replica lag, missing audit or fence, namespace mismatch, legacy receipt → blocked | API, Browser | UNAVAILABLE / INCONSISTENT; journal preserved | Blocked; escalate | W5-3, W5-6 | Yes |

### 2.1 Scenario 10 action cases (coordinated orders; contract §13.2)

| Case | Action and state | Expected | Evidence |
|---|---|---|---|
| 10-D1 | Legacy scan or undo | Refused 409 `ORDER_COORDINATED` | No counter, receipt or audit change |
| 10-D2 | Legacy complete-picking / complete-packing | Refused 409 `ORDER_COORDINATED` | No status or audit change |
| 10-P1 | Ship: `READY_TO_SHIP`, no active claim, no unresolved reconciliation | Permitted | Existing on-hand and reserved deduction, inventory movements, stock transactions and audit exactly as the current shipment path |
| 10-D3 | Ship: status not `READY_TO_SHIP` | Refused | No stock, reservation, movement, stock-transaction or audit change |
| 10-D4 | Ship: active claim present | Refused | Same: no effect |
| 10-D5 | Ship: unresolved reconciliation | Refused | Same: no effect |
| 10-C1 | Cancel: active claim or unresolved reconciliation | Refused (**PROPOSED**, D-8) | No reservation release, status or audit change |
| 10-C2 | Cancel: no active claim, no unresolved reconciliation | Permitted (**PROPOSED**, D-8) | Existing cancellation semantics (reservation release, audit) |
| 10-S1 | Start-picking (CONFIRMED → PICKING) | Permitted | Existing transition |

Keyed shipment idempotency and receipt recovery are **not** claimed (D-9).

### 2.2 Scenario 5 lock orderings (contract §15.5)

| Case | Order | Expected | Evidence |
|---|---|---|---|
| 5-A | Attempt commits, then takeover | Exactly one effect; APPLIED receipt durable; the takeover follows | One counter delta and one receipt; the original actor's authorized lookup returns RECORDED after the takeover |
| 5-B | Takeover commits, then the old attempt | The old claim/epoch cannot authorize a new effect | No counter delta, no receipt; client uncertain; lookup ABSENT_NOT_FINAL (authoritative absence only under contract §10 after W5-7 + D-11) |

## 3. Supplementary Claude scenarios (kept separately)

| ID | Scenario | Relation | Level | Dependency |
|---|---|---|---|---|
| S3 | Cross-actor key reuse and existence privacy (status, body, headers identical; timing risk documented) | Extends #14 | API | W5-4 |
| S13 | Old server process during deployment | Extends #10 | Deployment runbook + database writer guard spike | W5-7, D-11 |
| S14 | Completion translation, count and revision mismatch, terminal context | Extends #6 / #7 | Service, API | W5-2, W5-6, D-5 |
| S15 | Backup restore, namespace rotation, rollback refusal | Codex §9 | Restore drill on disposable PG | W5-1, D-1, D-13 |
| S16 | Separate profiles/devices claim contention | Sub-case of #1 | Browser | W5-6 |
| S17 | Release-first and scan-first race variants | Sub-case of #6 | Service | W5-2 |
| S18 | Reload with PERSISTED/SENDING lifecycle intent, then live lookup | Sub-case of #7 | Browser | W5-6 |
| S19 | 502/504/timeout/non-JSON classification | Sub-case of #9 | BFF | W5-5 |
| S20 | Fault injection after the counter update, before the receipt | Sub-case of #12 | Service | W5-2 |
| S21 | Concurrent scans on allocations of the same product + stock-out vs shipment | Sub-case of #13 | Service | W5-7 |
| S22 | Matching key and business fingerprint but mismatching namespace/actor/client fingerprint | Sub-case of #14 | Service | W5-3 |
| S23 | Lookup endpoint unavailable; legacy NULL-metadata receipts | Sub-case of #15 | API | W5-3 |
| V-1 | Fixture vectors reproduced by the **repository** `digest()` (Vitest) and `attempt_fingerprint()` (pytest) | Vector acceptance | Unit | W5-2 (backend), W5-6 (frontend) |
| V-2 | Independent Codex recomputation of every computed vector | Vector acceptance | Independent audit | W5-0 post-implementation audit |

## 4. Cross-cutting acceptance criteria (from Codex §14)

1. The same stable identity produces at most one committed effect.
2. Mutation, receipt and audit commit atomically.
3. Lifecycle duplicates never rotate epochs twice.
4. Receipt recovery never executes a mutation or returns a bearer token.
5. No absence result settles an unfenced request.
6. Every terminal response is fully correlated and independently validated.
7. Generic HTTP statuses never settle uncertainty.
8. Release and completion validate current progress under the lock.
9. Reconciliation-required states block ordinary work.
10. Every applicable legacy path is closed for coordinated orders.
11. Restore and cutover invalidate incompatible old journals.
12. Existing stock, reservation, shipment, FEFO, receiving, return and transfer behavior stays intact.
13. The full backend suite and the 90% coverage gate pass on PostgreSQL 18.
14. Frontend `npm run check` passes on Node 22.
15. Real Backend → BFF → browser evidence supplements synthetic tests.
16. All approved-path diffs and protected hashes are reviewed before activation.

## 5. Existing suites to retain and rerun (never weakened)

**Suites:**

- `tests/test_r5safe_characterization.py`
- `tests/test_r5safe_receipts.py`
- `tests/test_r5safe_claims.py`
- `tests/test_r5safe_claim_api.py`
- `tests/test_r5safe_claimed_completion.py`
- `tests/test_r5safe_release.py`
- `tests/test_r5safe_fencing_concurrency.py`
- `tests/test_r5safe_migration.py`
- `tests/test_sales_order_fulfillment.py`
- `tests/test_fulfillment_undo.py`
- `tests/test_inventory_concurrency.py`
- `tests/test_quantity_precision.py`
- `tests/test_stock.py`
- `tests/test_sales_order.py`

**Rules for these suites:**

- Characterization assertions that document legacy gaps are **not rewritten**. Coordinated-mode assertions are added alongside them.
- The accepted SAFE.3 simulation suites (WP-1 to WP-4) stay green.

## 6. Evidence requirements per package

Each package delivers:

- a protected preflight and postflight;
- an exact diff limited to its allowlist;
- the test logs with exit codes;
- disposable-database provenance (never an operational database);
- SHA-256 manifests;
- an independent Codex audit before owner acceptance.

The W5-0 deliverables are these three files only; no test runs are required beyond the vector recomputation.

## 7. Status of this matrix

All 15 mandatory scenarios and all supplementary scenarios are **OPEN / NOT IMPLEMENTED**.
