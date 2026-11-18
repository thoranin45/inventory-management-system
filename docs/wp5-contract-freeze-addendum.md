# WP-5 Contract Freeze Addendum (DRAFT)

| | |
|---|---|
| **Status** | **DRAFT, revision 3.** The production contract is **NOT frozen.** Nothing in this document is implemented, verified at runtime, mounted or activated. Passing documentation checks is not runtime evidence (§A1, evidence classes) |
| **Authority** | **OWN-1:** owner policy dispositions and addendum draft approval, 2026-10-27. **OWN-2:** owner conditional documentation remediation authorization, 2026-10-27. **OWN-3:** owner Revision 3 documentation remediation authorization, 2026-10-29, resumed by **OWN-3R**. All are **chat authorization, transcript only** (§A1); none is an independently verified signed record. None approves a freeze, W5-1, code, migrations, database work, Git operations or deployment |
| **Baseline** | The accepted W5-0 documentation draft is **unchanged and byte-identical**: `docs/wp5-backend-bff-contract.md` (`9ea3d4b579c0cf97261c19b3ce2857e08731241a35746e52ce614ed33d7add34`), `docs/wp5-acceptance-matrix.md` (`c5594784c9b51413e99792bacd420bdd7e76e1a63b00d0640e768727ade9116c`), `tests/fixtures/wp5_contract_vectors.json` (`d2200f83b6268dd84fab84f3a0c5b00f76b96ea7d7aa758e1a051492d9e92329`) |
| **Revision** | Revision 1 (SHA-256 `62cd8fc42b33196b6e7246c9c49b1d10f4f94324639aa0b15576e2be5da47f64`) was audited by Codex as **BLOCKED** (audit SHA-256 `4bea69a0e0509260b627475298924e62dc889eda00bd086e478607e570dc5f4f`). Revision 2 remediated F-1…F-10 and the A19 precedence note (§A24.1). Revision 2 (SHA-256 `3640845b6a76612951aa9dcb5f4b67684ef06bccc261ea6d1067b4e0ccc0bafb`) was audited by Codex as **BLOCKED** (delta audit SHA-256 `983b25dbd1c0382defb5b3c5f5a080db3b84f4584e16a192dc2b2e884323e442`). This revision 3 remediates R2-1…R2-6 (§A24.2) |
| **Precedence** | This addendum amends W5-0 **only** as listed in §A19, quoting the exact accepted wording. Everything else in W5-0 continues to apply, including invariants I-1…I-8 |
| **Companions** | `docs/wp5-acceptance-matrix-addendum.md`; `tests/fixtures/wp5_contract_vectors_addendum.json` |

## A1. Status labels and sources

| Label | Meaning |
|---|---|
| **OWNER-SELECTED** | A direction stated in owner text (OWN-1 or OWN-2). It is **not** implemented or verified and remains subject to independent review. It covers only the quoted direction, never the implementing detail |
| **PROPOSED** | A design rule proposed by Claude to implement a direction; it needs review and, where marked, an owner decision |
| **CONDITIONAL** | Usable only after named evidence or a feasibility proof exists; until then the stated fail-closed behavior applies |
| **UNRESOLVED** | No decision yet; the gate at which it must be resolved is stated in §A2 |
| **DEFERRED** | Intentionally postponed to a named gate |

| Source | Reference |
|---|---|
| **OWN-1** | Chat authorization, transcript only: session 96ed14b4 transcript line 5855, message `e5d915c9-b1fe-4da1-97db-96982a0d63ea`, 2026-10-27T10:45:27Z, extracted text SHA-256 `fd230f2333fbdca90db283bdc6650f1d556eb09e3970b00dfd798ec282171dcb` |
| **OWN-2** | Chat authorization, transcript only: session 96ed14b4 transcript line 6438, message `4bebe6e5-52d2-464f-99a6-14c85b2dba84`, 2026-10-27T14:35:49Z, extracted text SHA-256 `864d3e3a5a482ccc954440ea2562c8ed851b117719bd7da0f920b62c367bd42f` |
| **OWN-3** | Chat authorization, transcript only: session 96ed14b4 transcript line 6702, message `6d75bf68-d43d-4806-9af1-ba27d178259b`, 2026-10-29T03:40:03Z, extracted text SHA-256 `4cb0370cec143a0b27ffba72ed2bfb6ac1404b40c56458b3168fd2c7541b3845` |
| **OWN-3R** | Chat authorization, transcript only (resumes OWN-3 under its original restrictions): line 6751, message `8e5ec84e-324e-4695-8590-0626df0bdbc0`, 2026-10-29T03:44:17Z, extracted text SHA-256 `6f4e55354b35a1d60235d0b7c6d5180b2c4dfc2ed49f404cb3b220db9b110ed5` |
| **CLD** | Claude design reports (session scratchpad, not durable evidence). The names "Policy A" and the labels O-1…O-9 were defined there and selected by name in OWN-1 |
| **CDX** | Codex CONTRACT FREEZE DECISION REVIEW (SHA-256 `5ca381c754dfd39b894549f62e2603789da1841c6503e2a8c64cee14d381151c`), Codex addendum audit (SHA-256 `4bea69a0e0509260b627475298924e62dc889eda00bd086e478607e570dc5f4f`) and Codex revision 2 delta audit (SHA-256 `983b25dbd1c0382defb5b3c5f5a080db3b84f4584e16a192dc2b2e884323e442`) |

Rule: within any section, rules not quoted from OWN-1, OWN-2 or OWN-3 are PROPOSED unless labelled otherwise.

| Evidence class | Meaning in this addendum |
|---|---|
| **Documentation correctness** | Internal consistency, precedence and fixture arithmetic, checked by document verification and independent audit. It says nothing about runtime behavior |
| **Proposed future functionality** | Everything labelled OWNER-SELECTED, PROPOSED or CONDITIONAL: rules for packages W5-1…W5-7, SAFE.4 and SAFE.5 that do not exist yet |
| **Runtime evidence** | **None.** Every acceptance scenario is OPEN / NOT IMPLEMENTED; computed vectors verify arithmetic only |

## A2. Decision register

| ID | Topic | Status | Recorded direction | Source | Resolve by | Section |
|---|---|---|---|---|---|---|
| D-1 | Recovery namespace | OWNER-SELECTED | Persistent server-issued namespace per inventory database; controlled rotation after restore or deliberate clone/replacement | OWN-1 | Contract freeze review | A3 |
| D-2 | Access scope | DEFERRED | Final scope pending; strict no-impersonation | OWN-1 | Before W5-4 (before W5-1 if assignment tables are chosen) | A17 |
| D-3 | Takeover and reconciliation | OWNER-SELECTED | Reasoned same-user and Admin cross-user takeover, both requiring reconciliation; resolution fences the existing claim; resumption requires a separate new ACQUIRE | OWN-1 | Contract freeze review | A4 |
| D-3a | Resumption for non-coordinated and terminal orders | PROPOSED | Class-specific resumption branches (A11 S6) | CLD | Owner confirmation at contract freeze | A11 |
| D-4 | Lifecycle outcomes | OWNER-SELECTED (FENCED authority CONDITIONAL) | Durable APPLIED, REJECTED and conditionally authoritative FENCED; authoritative fencing requires proven W5-7/D-11 enforcement | OWN-1 | FENCED authority: only after W5-7 enforcement and D-11 proof | A5 |
| D-5 | Completion | OWNER-SELECTED | Operator-confirmed exact allocation counts plus progress revision | OWN-1 | Contract freeze review | A6 |
| D-6 | Journal recovery | OWNER-SELECTED | Supervised, fail-closed journal recovery with positive actor-bound authorization evidence | OWN-1 | Contract freeze review | A7 |
| D-7 | Retention | OWNER-SELECTED | No automatic receipt or unresolved-evidence deletion in V1 | OWN-1 | Contract freeze review | A16 |
| D-8 | Cutover, shipment, cancellation | OWNER-SELECTED | Controlled per-order enrollment; guarded shipment; Policy A for ordinary cancellation | OWN-1 | Contract freeze review | A8, A10 |
| D-9 | Ambiguous shipment outcome | DEFERRED | Manual handling; no automatic mutation retry; no keyed shipment recovery in current WP-5 scope | OWN-1 | Before W5-7 | A17 |
| D-10 | Frozen production pages | DEFERRED | Entry changes require later owner approval | OWN-1 | Before W5-7 | A17 |
| D-11 | Writer exclusion | CONDITIONAL / UNRESOLVED | Must be proven independently before admission and before authoritative FENCED evidence | OWN-1 | Strategy and privileged boundary: before contract freeze (may change W5-1). Prevention proof (AX-45): before L1 and before authoritative FENCED (SAFE.5); containment drills (AX-66) never substitute | A12 |
| D-12 | SAFE.4 dependency | OWNER-SELECTED | Minimum SAFE.4 matched-count reconciliation is a prerequisite for live activation | OWN-1 | Before activation | A11 |
| D-13 | Restore | OWNER-SELECTED | Containment, namespace rotation, claim invalidation, uncertainty preservation, physical reconciliation | OWN-1 | Contract freeze review | A13 |
| D-14 | Barcode | OWNER-SELECTED | Exact Unicode identity, ≤ 100 code points, U+001D and leading zeros preserved, no implicit transformation | OWN-1 | Contract freeze review | A14 |
| O-1 | Actor-bound enrollment | OWNER-SELECTED | Actor-bound enrollment; explicit grants for other actors | OWN-1 | Contract freeze review | A7 |
| O-2 | Existing legacy orders | OWNER-SELECTED | Finish only through guarded legacy paths when operational evidence permits; uncertain work held and reconciled; legacy counters never assumed verified | OWN-1 | Contract freeze review | A9 |
| O-3 | ENROLL epoch | OWNER-SELECTED | Atomic ENROLL 0 → 1; marker, start-picking, increment, receipt, audit and actor binding transactional and idempotent | OWN-1 | Contract freeze review | A8 |
| O-4 | Supervised cancellation | OWNER-SELECTED | Minimum supervised cancellation required before live V1 activation | OWN-1 | Before activation | A10 |
| O-5 | Maker-checker | OWNER-SELECTED | No self-approval exception; counter and approving Admin are different authorized people | OWN-1 | Contract freeze review | A10, A11, A13 |
| O-6 | Epoch headroom | OWNER-SELECTED principle; thresholds UNRESOLVED | Phase-aware headroom; a proven safety and liveness budget is required | OWN-1 | Proven budget and thresholds before W5-2 | A15 |
| O-7 | SAFE.5 scope | OWNER-SELECTED scope; exact tests UNRESOLVED | Proposed SAFE.5 scope (A18) | OWN-1 | Exact tests: separate review before SAFE.5 begins | A18 |
| O-8 | Writer-exclusion strategy | CONDITIONAL (provisional candidate) | Operational writer control is a candidate only, **not** proven complete exclusion; DB guard or separated role remain alternatives | OWN-1 | As D-11 | A12 |
| O-9 | Barcode control characters | UNRESOLVED | Further restrictions pending an authorized compatibility assessment | OWN-1 | After the authorized assessment; before W5-4 | A14 |
| N-1 | Legacy start-picking after admission | OWNER-SELECTED | Once coordinated admission is enabled, new legacy start-picking is refused | OWN-1 | Contract freeze review | A8 |
| AC-1 | Epoch of the first ACQUIRE | OWNER-SELECTED | ENROLL stays 0 → 1. The first ACQUIRE expects epoch 1 only when no authorized epoch-advancing transition has intervened; otherwise it must carry and be validated against the actual current authoritative epoch, with actor authorization. The client never derives or fabricates an epoch | OWN-3 | Contract freeze review | A8 |
| AD-1 | N-1 after admission is paused or contained | PROPOSED | N-1 stays in force permanently once `first_activated_at` is set | CLD | Before W5-1 | A8 |
| AD-2 | Admission states | OWNER-SELECTED distinction; matrix PROPOSED | Planned pause is distinct from security containment and suspected restore; guarded shipment may remain available during a planned pause only when all other shipment safety conditions hold; otherwise unsafe mutations are refused until separately verified | OWN-2 | Matrix: before W5-2 | A8 |
| AD-3 | Other mutations during a planned pause | PROPOSED | Guarded legacy continuation, Policy A cancellation and supervised recovery during PAUSED; refused until decided | CLD | Before W5-2 | A8 |
| B-1 | ENROLL bootstrap | OWNER-SELECTED | Approach A: scoped PRE_ENROLLMENT journal bootstrap bound to namespace, order, actor and current eligibility; no scans, claims, completion, shipment or stock mutation | OWN-2 | Contract freeze review | A7, A8 |
| B-2 | ENROLL retry | OWNER-SELECTED | Operator-confirmed retry of the identical ENROLL intent (same identity and fingerprint), after lookup where available; never a silent new identity | OWN-2 | Contract freeze review | A8 |
| G-1 | Grant issuer | OWNER-SELECTED | Only an authenticated, authorized Admin; no impersonation; grants distinct from JOURNAL_RESET | OWN-2 | Contract freeze review | A7 |
| G-2 | Grant fencing and constraints | OWNER-SELECTED | A successful grant atomically advances the epoch with auditable evidence; refused under unsafe claim, operation, history or reconciliation conditions; no-history evidence, revocation and replay protection; unknown history fails closed | OWN-2 | Contract freeze review | A7 |
| G-3 | Grant lifetime | PROPOSED | Work authorization until revoked or the order is terminal | CLD | Before W5-1 | A7 |
| G-4 | JOURNAL_RESET reconciliation | PROPOSED | Every JOURNAL_RESET opens a REQUIRED reconciliation | CLD | Before W5-1 | A7 |
| G-5 | Self-grant | PROPOSED | An Admin may not grant to itself | CLD | Before W5-4 | A7 |
| LC-1 | HELD representation | OWNER-SELECTED | HELD is an operational gate, not a new SalesOrder status | OWN-2 | Contract freeze review | A9 |
| LC-2 | Continuation evidence | OWNER-SELECTED direction; standard PROPOSED | Approved continuation evidence, invalidated on new uncertainty; proposed standard is a positive matched physical count | OWN-2, CLD | Standard: before W5-7 | A9 |
| LC-3 | Continuation authority | PROPOSED | Maker plus approving Admin who is not the maker | CLD | Before W5-7 | A9 |
| LC-4 | HELD by default, including existing `LEGACY_CUTOVER` orders | PROPOSED | Accept the operational impact; production impact UNKNOWN | CLD | Owner confirmation before W5-7 | A9 |
| SC-1 | Supervised cancellation scope | PROPOSED | Also legacy orders past CONFIRMED after first activation (a behavior change) | CLD | Before W5-7 | A10 |
| SC-2 | Put-back quantities | OWNER-SELECTED | Exact allocation-level return quantities, immutable evidence, independent approval, atomic cancellation/reservation/audit/outcome; no stock-in | OWN-2 | Contract freeze review | A10 |
| SC-3 | No settlement by closure | OWNER-SELECTED | Closing a reconciliation or case never settles an UNKNOWN operation | OWN-2 | Contract freeze review | A10, A11 |
| SC-4 | ESCALATED without a V1 exit | PROPOSED | Acknowledge the operational impact: ESCALATED orders stay blocked until a separately authorized recovery process (RC-1) | CLD, CDX | Owner acceptance at contract freeze | A10, A11 |
| SC-5 | Cancellation case abandonment | OWNER-SELECTED | No abandonment in V1: an open case stays blocking until the approved cancellation completes or a separately authorized recovery process establishes valid physical state; if physical handling may have occurred (including failed or lost put-back recording) the block remains; no inference of no handling from missing evidence; no A11 S6 shortcut; otherwise ESCALATED with an auditable operator-escalation requirement; no new inventory correction or automatic restaging workflow | OWN-3 | Contract freeze review | A10 |
| RC-1 | Separately authorized recovery process | UNRESOLVED | Any recovery for ESCALATED cases, unresolvable put-back cases or held claims at MAX; not part of V1 | OWN-3, CDX | Separate owner approval of its own package before it is relied upon | A10, A15 |
| R-1 | Restore detection and containment | OWNER-SELECTED requirement; mechanism UNRESOLVED / CONDITIONAL | Mandatory fail-closed containment; a database OID comparison is supplementary only; a trusted provenance anchor outside the restored database's recovery domain; without trusted provenance, admission and hold release stay blocked | OWN-2 | Mechanism selected before W5-1; independently proven before any restored-system admission (SAFE.5) | A13 |
| R-2 | Restore hold coverage | OWNER-SELECTED | Durable server-enforced holds for every affected order capable of further relevant mutation, including READY_TO_SHIP and applicable terminal orders; no new order statuses | OWN-2 | Contract freeze review | A13 |
| R-3 | Restore release | OWNER-SELECTED | Immutable evidence by one authorized person, approved by a different authorized Admin, bound to order, generation, evidence version, physical state and external shipment evidence | OWN-2 | Contract freeze review | A13 |
| R-4 | Post-backup shipment | OWNER-SELECTED | Such orders remain ESCALATED, blocked from duplicate shipment and automatic deduction; no V1 reconstruction; explicit supervised escalation boundary | OWN-2 | Contract freeze review | A13 |
| R-5 | Physical stock reconciliation after restore | OWNER-SELECTED (procedure PROPOSED) | Mandatory prerequisite to restored-system admission | OWN-2 | Procedure in the W5-7 runbook; rehearsed in SAFE.5 | A13 |
| R-6 | Identifier collision prevention after restore | OWNER-SELECTED (procedure PROPOSED) | Mandatory prerequisite to restored-system admission | OWN-2 | As R-5 | A13 |
| EP-1 | Numeric epoch thresholds | UNRESOLVED | No threshold selected | OWN-1, OWN-2, OWN-3 | Before W5-2 | A15 |
| EP-2 | Held claims at MAX | OWNER-SELECTED direction; gate mechanism PROPOSED | No assumption that no claim exists at MAX; actual claim state checked under the locks; a pre-existing or restored claim at MAX that cannot be safely fenced keeps the order blocked with supervised escalation under a separately approved recovery policy (RC-1); no reset, wraparound, widening or arbitrary advance | OWN-3 | Transition tests (AX-65) before W5-2 | A15 |
| BC-2 | Closed-gate input | PROPOSED | Input received while the gate is closed is discarded | CLD | Before W5-6 | A14 |
| WX-1 | Privileged-operator boundary | UNRESOLVED | Who may hold superuser/owner access; obligations | CDX | Before contract freeze | A12 |
| WX-2 | Exclusion strategy selection | UNRESOLVED | Operational control, DB guard or role separation, with prevention evidence | CDX | Before contract freeze | A12 |
| WX-3 | Session, pool and maintenance controls | UNRESOLVED | Termination, reconnect control, jobs, scripts, direct SQL | CDX | Before contract freeze; proven before L1 | A12 |
| PV-1 | Durable owner decision record | UNRESOLVED | Optional record enabling independent verification of OWN-1/OWN-2 | CDX | Before contract freeze | A1 |

## A3. D-1: recovery namespace

- **One active namespace (OWNER-SELECTED direction; detail PROPOSED):** each inventory database has exactly one active server-issued namespace (UUIDv4) with rotation provenance (previous namespace, reason, actor, time).
- **Rotation:** only in the supervised restore or replacement procedure (A13); never on ordinary deployment or restart.
- **Admission:** coordinated admission requires exactly one usable active namespace with trusted provenance (A13.2).
- **Validation:** every coordinated mutation and recovery path validates the namespace. Order/key uniqueness is preserved across namespaces (W5-0 §9.1).
- **Frontend:** the namespace comes only from trusted context; a mismatch pauses work and cannot authorize a new attempt.
- **Limitation:** rotation blocks stale journals and replay. It is **never** evidence about physical history, shipment or stock.

## A4. D-3: takeover, reconciliation and resumption

- **Existing behavior:** a takeover advances the epoch **and issues a new held claim** to the taker (`fulfillment_integrity_service.py:263-282`); it opens REQUIRED `SELF_TAKEOVER` or `TAKEOVER`, superseding any REQUIRED predecessor (`:215-235`).
- **Fence types:** a takeover fences the previous credential but is **not** a clearing fence. Clearing operations leave no claim (`_fence`, `:318-323`).
- **Resolution (OWNER-SELECTED):** resolving the reconciliation fences the existing claim: the claim is cleared and the epoch advances (A11 S5).
- **Resumption (OWNER-SELECTED for coordinated PICKING/PACKING):** a separate new ACQUIRE. There is no automatic gate release and no reuse or replay of a historical bearer credential.
- **Other order classes (D-3a, PROPOSED):** legacy orders, coordinated READY_TO_SHIP and restored orders resume as in A11 S6.
- **UI:** must distinguish "historical outcome recovered" from "authorized to resume".

## A5. D-4: lifecycle outcomes

- **Outcomes (OWNER-SELECTED):** APPLIED, REJECTED and FENCED, each with a durable per-intent receipt keyed by `(sales_order_id, intent_id)`.
- **Lifecycle receipt kinds (PROPOSED):** ACQUIRE, TAKEOVER, RELEASE, COMPLETE, **ENROLL**, **GRANT** and **JOURNAL_RESET**. Each advances the epoch when APPLIED (W5-0 §9.2 retained).
- **Supervised-operation receipts (PROPOSED, SAFE.4-era):** CASE_OPEN, PUT_BACK_RECORD, COUNT_RECORD, CANCELLATION_APPROVAL, RECONCILIATION_APPROVAL, RESTORE_RELEASE, GRANT_REVOCATION and ESCALATION. They are keyed, durable and atomic with their effect, but are **not** lifecycle receipts, because some of them do not advance the epoch. There is no abandonment operation (SC-5).
- **Receipt contents (PROPOSED):** namespace; `subject_actor` (whose operation it is) and `acting_supervisor` (when a supervisor acts), recorded separately; validated fingerprints and algorithms; expected and resulting epoch; outcome; provenance.
- **Credentials:** ENROLL and GRANT carry no claim credential.
- **REJECTED** only for accepted terminal business rejections. Authentication, malformed-request and infrastructure failures never burn an operation identity.
- **FENCED (CONDITIONAL):**
  - created only by the explicit authorized fence operation (W5-0 §9.4); never overwrites APPLIED/REJECTED; settles a specific intent, never a reconciliation;
  - authoritative emission is prohibited until W5-7 enforcement and D-11 writer exclusion are proven; until then, lookups return UNKNOWN / ABSENT_NOT_FINAL;
  - never derived from missing history alone.

## A6. D-5: completion (OWNER-SELECTED)

- **Intent contents:** a COMPLETE intent carries the exact allocation counts the operator confirmed, plus `progress_revision`.
- **Server checks (PROPOSED):** under the order lock, the server validates membership, full counters, claim, epoch, revision and reconciliation, using the existing transaction-free transition core. It **never** fills counters from allocated quantities.
- **Terminal state:** PACK completion → `READY_TO_SHIP`, reported as a terminal context with no active phase.
- **Changed payload:** needs a new reviewed intent after the previous one settles.

## A7. D-6, O-1, B-1, G-1, G-2: journal and work authorization

### A7.1 Two separate authorizations (PROPOSED)

1. **Journal authorization:** whether an **empty** local journal partition `(namespace, actor, order)` may be initialized. The context reports it as `emptyJournalAuthorized` together with the named basis.
2. **Work authorization:** whether an actor may perform claim lifecycle operations on a coordinated order:
   - the enrolling actor (`enrolled_by`);
   - an actor holding an active grant;
   - an Admin, only through the D-3 cross-user takeover.

   **An existing journal is never work authorization.**

### A7.2 Server-known history (PROPOSED)

For `(order, actor)`, any of the following, in **any** namespace, including rows restored from a backup:

- an attempt or lifecycle receipt with `subject_actor` = actor;
- `enrolled_by` = actor;
- any grant to the actor (active, used, revoked or superseded), except that J-2 disregards the single active grant it is evaluating;
- any JOURNAL_RESET or RESTORE_RESET record for the actor.

History is **UNKNOWN** when any source is unavailable or inconsistent, or when the order is under a restore hold, RESTORE_SUSPECTED or CONTAINED. **Unknown history always fails closed.** Missing receipts or erased evidence are never treated as proof that a reset is unnecessary (OWN-2).

### A7.3 Journal bases (closed list; anything else is denied)

| Basis | Valid when | Permits | Fence | Reconciliation |
|---|---|---|---|---|
| **J-1 PRE_ENROLLMENT** (B-1 OWNER-SELECTED; conditions PROPOSED) | Order CONFIRMED, no marker, epoch 0, zero counters, no unresolved reconciliation, no restore hold, admission ACTIVE, trusted provenance, actor authenticated and permitted to enroll (D-2), history not UNKNOWN. Bound to namespace, order, actor and the observed eligibility | Creating the journal and persisting **only** an ENROLL intent. No scan, undo, claim acquisition, completion, shipment or stock mutation | None | None |
| **J-2 FIRST_USE_GRANT** (G-1, G-2 OWNER-SELECTED) | An active grant exists for the actor, and the actor still has **no** server-known history on the order (until its first receipt) | Journal initialization; work authorization per the grant | Grant issuance advances the epoch | None |
| **J-3 JOURNAL_RESET** | A supervised reset record for the actor exists, and the actor has no receipt recorded after it | Journal initialization after erased or inconsistent history | Clearing fence at the reset | REQUIRED `JOURNAL_RESET` (G-4) |
| **J-4 RESTORE_RESET** | In the new namespace, after the order's restore-hold release (A13.5), for actors with work authorization, until their first receipt in the new namespace | Journal initialization after a database restore | Restore fence and resolution fence | `RESTORED`, resolved first |

**Why J-1 is safe even if an earlier pre-enrollment journal was erased (PROPOSED reasoning):**
- **Positive state, not absent receipts:** J-1 rests on the current server state (CONFIRMED, epoch 0, no marker, zero counters).
- **Only ENROLL can apply:**
  - attempts need a claim, and a claim needs coordinated PICKING/PACKING (`fulfillment_integrity_service.py:248-249`);
  - an ACQUIRE at expected epoch 0 is always REJECTED;
  - ENROLL carries no credential and moves no stock;
  - its 0 → 1 advance makes every other epoch-0 intent stale.
- **History that can exist at this stage:** only zero-effect REJECTED receipts.

**After ENROLL:** an empty journal for the enrolling actor is erased history and needs J-3.

### A7.4 First-use grant (G-1, G-2 OWNER-SELECTED; detail PROPOSED)

- **Issuer:** an authenticated Admin acting as itself (`acting_supervisor` recorded). No impersonation. The grantee is a different authenticated user (G-5).
- **Identity and replay protection:**
  - each request carries an immutable grant identity (`Idempotency-Key` = grant intent ID) and a fingerprint over (namespace, order, grantee, expected epoch, reason);
  - same key and fingerprint → original receipt, with no second advance;
  - same key, different fingerprint → PAYLOAD_CONFLICT;
  - another actor's key → indistinguishable refusal (W5-0 §8.3).
- **Issuance conditions** (checked under admission row FOR SHARE → order FOR UPDATE):
  - admission ACTIVE; trusted provenance;
  - order coordinated and in PICKING or PACKING;
  - **no** active claim; no unresolved reconciliation; no open cancellation case; no restore hold;
  - grantee has **no** server-known history and history is **not** UNKNOWN;
  - grantee ≠ `enrolled_by`; grantee has no active grant;
  - expected epoch = current epoch ≤ MAX − 1.
- **Outcome:** one transaction: grant record, epoch + 1 (fencing every request that carries the old epoch), lifecycle receipt (GRANT, APPLIED) and audit.
  - **REJECTED (durable receipt, no effect):** accepted business refusals, such as `GRANT_GRANTEE_HAS_HISTORY` or `GRANT_CLAIM_ACTIVE`.
  - **Pre-acceptance failures:** write nothing.
- **Server-known "unresolved operations":** the server sees open reconciliations, open cases, restore holds and supervised operations in progress. Client-local unknown operations are fenced by the grant's epoch advance.
- **Grant before the first ACQUIRE (AC-1):** a grant may be issued after ENROLL and before any claim. It advances the epoch (for example 1 → 2), so every request still carrying epoch 1, including the enrolling actor's in-flight ACQUIRE, is REJECTED as stale. The next ACQUIRE must carry the current authoritative epoch (A8.3 L5).
- **Revocation:** an Admin may revoke a grant (keyed, durable receipt, audit). Revocation is refused while the grantee holds a claim; an Admin cross-user takeover (D-3) must come first. Authorization is re-checked under the lock at every lifecycle commit, so a revoked grantee's in-flight request cannot apply.
- **Lifetime (G-3, PROPOSED):** work authorization until revoked or the order is terminal. Journal authorization (J-2) ends at the grantee's first receipt.
- **A grant never bypasses J-3:** once the grantee has history, an empty journal for it needs J-3.

### A7.5 JOURNAL_RESET (supervised)

- **Who:** an Admin. Required for any actor with server-known history and no usable journal. An Admin may also reset its own journal.
- **Conditions:** coordinated order; expected epoch ≤ MAX − 1 (a held claim at MAX cannot be reset: A15.2).
- **One transaction:** clearing fence (claim cleared, epoch + 1), reset record, REQUIRED `JOURNAL_RESET` reconciliation (G-4), lifecycle receipt and audit. Earlier requests are fenced by the epoch advance.
- **Authority:** not authoritative for live use until W5-7 and D-11 are proven.

### A7.6 Residual (accepted, documented)

Within a J-2 or J-3 window (before the actor's first receipt), a second empty journal for the same actor, on another device or after erasure, is still authorized. This is safe:

- epoch fencing lets at most one claim-creating request apply;
- a token is accepted only by a live journal (`coordinator.ts:208-211`);
- a device left without a credential sees PAUSED and must use self-takeover, which opens a reconciliation.

**Absent receipts, client timestamps and local metadata never authorize. Before W5-7 / D-11, no basis is authoritative for live use.**

## A8. D-8, O-3, N-1, B-1, B-2: admission, enrollment and cutover

### A8.1 Admission states (AD-2: distinction OWNER-SELECTED; matrix PROPOSED)

The admission singleton stores `state`, one of the following, plus a permanent `first_activated_at`.

| Stored state | Meaning |
|---|---|
| INACTIVE | Never activated |
| ACTIVE | Coordinated admission enabled |
| PAUSED | Planned pause |
| CONTAINED | Security containment, with a reason: writer-exclusion failure, integrity incident or restore procedure |

**RESTORE_SUSPECTED** is a **derived** condition that overrides the stored state whenever trusted restore provenance is not established (A13.2). A restored database carries its own stored state, so that state cannot vouch for itself.

| Action | INACTIVE | ACTIVE | PAUSED | CONTAINED | RESTORE_SUSPECTED |
|---|---|---|---|---|---|
| ENROLL, grants, coordinated lifecycle and attempts | Refused | Allowed (eligibility) | Refused | Refused | Refused |
| Legacy start-picking | Allowed only if `first_activated_at` is unset | Refused (N-1) | Refused (AD-1) | Refused | Refused |
| Guarded legacy scan/undo/complete on a non-HELD legacy order | Current behavior (HELD gate starts at first activation) | Allowed | Refused until AD-3 | Refused | Refused |
| Guarded shipment | Allowed under state guards | Allowed under A8.7 | **Allowed only when every A8.7 condition holds** (OWNER-SELECTED) | Refused | Refused |
| Policy A ordinary cancellation | Allowed under Policy A | Allowed under Policy A | Refused until AD-3 | Refused | Refused |
| Supervised recovery (fences, counts, approvals, cases, releases) | Not applicable | Allowed (each with its own prerequisites) | Refused until AD-3 | Refused, except the incident procedure (for a restore, the A13.4 procedure) | Only the supervised restore procedure (A13.4) |
| Returns and Admin complete | Restore hold applies | Restore hold applies | Restore hold applies | Refused | Refused |
| Lookups and context | Allowed | Allowed | Allowed | Allowed | Allowed (read-only) |

**State transitions (PROPOSED):**

| Transition | Authority and prerequisites |
|---|---|
| INACTIVE or PAUSED → ACTIVE | L1 only |
| ACTIVE → PAUSED | Admin |
| ACTIVE or PAUSED → CONTAINED | Admin or the incident runbook |
| CONTAINED → PAUSED | Only with an independent verification record: fresh A12 evidence and an incident closure by an Admin other than the reporter |

Order creation and confirmation are not governed by admission; only restore containment applies to them.

### A8.2 Lock order (PROPOSED; corrects revision 1)

Every guarded mutation takes these locks in this order:

1. the admission row `FOR SHARE`;
2. the order row `FOR UPDATE`;
3. the existing `lock_inventory` order (products → batches → balances).

This applies to legacy and v1 fulfillment, shipment, cancellation, returns and Admin complete.

- **Split guard:** the guard is split into an admission, namespace and provenance check before the order lock, and the order-level check inside it. **Acquiring the admission row after an order lock is prohibited.**
- **State changes** (L1, pause, containment, the restore procedure) take the admission row `FOR UPDATE`. The restore procedure then locks orders in the same order as everyone else.
- **Writer map:** a writer map listing every participating path and every excluded writer is a W5-7 deliverable.
- **No runtime proof yet:** no runtime deadlock proof exists (AX-61).

### A8.3 Linearization points

| # | Event | Transaction and lock | Linearization point |
|---|---|---|---|
| L1 | **Enable coordinated admission** (INACTIVE or PAUSED → ACTIVE) | Admission row `FOR UPDATE`; refused unless the A12 evidence gates pass and trusted provenance holds (A13.2); after a restore, also R-5 and R-6 (A13.4). Records evidence reference, required revision, `enabled_by`, `enabled_at` and (the first time) `first_activated_at` | Commit of L1 |
| L2 | **Reject new legacy start-picking (N-1)** | Legacy start-picking reads the admission row `FOR SHARE` **before** the order lock | If `first_activated_at` is set, refused 409 `LEGACY_START_REFUSED` with no effect, regardless of order-lock timing |
| L3 | **ENROLL from CONFIRMED (O-3)** | Admission row `FOR SHARE` (ACTIVE, provenance trusted) → order `FOR UPDATE` → receipt-first replay/conflict check → eligibility (CONFIRMED, no marker, epoch 0, zero counters, no unresolved reconciliation, no restore hold, actor permitted, headroom) → **one transaction:** permanent marker (`coordinated_at`, `cutover_id`, namespace, `enrolled_by`) + existing start-picking core + epoch 0 → 1 + ENROLL receipt (APPLIED, `subject_actor`) + audit | Commit of L3 |
| L4 | **Coordinated marker effective** | — | Same as L3. From then on the **action-specific** guard table (A8.5) applies to the order; it is not a blanket refusal |
| L5 | **First ACQUIRE** (`expectedEpoch` = the current authoritative epoch, AC-1) | Admission `FOR SHARE` (ACTIVE) → order `FOR UPDATE` → coordinated, PICKING, current epoch = expected epoch, no holder, no unresolved reconciliation, actor has work authorization, headroom → epoch + 1 + token (delivered once) + receipt + audit. The expected epoch is 1 only when no authorized epoch-advancing transition has occurred since ENROLL; after a grant fence it is the current value (for example 2 → 3) | Commit of L5 |

**Epoch source (AC-1 OWNER-SELECTED):**
- The client takes every expected epoch only from the trusted server context. It never derives, increments or fabricates an epoch.
- A stale expectation is an accepted terminal REJECTED outcome with a durable receipt. That identity never becomes executable again (W5-0 §8.5). The client re-reads the context and creates a new intent; it never re-sends a REJECTED intent.
- Grant fencing, history checks, idempotency and reconciliation requirements (A7.4) are unchanged.

### A8.4 Interleavings (replaces revision 1's "first commit wins")

| # | Interleaving | Outcome |
|---|---|---|
| 1 | Legacy start-picking commits before the first L1 | A legacy PICKING order (A9); never enrollable |
| 2 | L1 commits before legacy start-picking | Legacy start-picking refused at the admission check before the order lock, regardless of which transaction would lock the order first |
| 3 | Legacy start-picking and L1 concurrent | Serialized on the admission row: start-picking holds `FOR SHARE` → L1 waits → case 1; L1 holds `FOR UPDATE` → start-picking waits → case 2 |
| 4 | ENROLL vs ENROLL on the same order | Same intent identity and fingerprint: one transition; the second delivery replays the recorded receipt. Different intent identities: order lock; the first commit applies; the second is REJECTED `ALREADY_COORDINATED` (or stale). Same identity, different fingerprint: PAYLOAD_CONFLICT |
| 5 | ENROLL vs Policy A cancellation at CONFIRMED | Order lock; the first commit wins. Cancel first → ENROLL REJECTED (ineligible). ENROLL first → ordinary cancellation refused (supervised only) |
| 6 | Pause, containment or suspected restore | Per A8.1 |
| 7 | Old-revision writer before L1 | L1 refused while any A12 gate fails |
| 8 | Old or direct writer after enrollment | Old code ignores admission and the marker. **Prevention:** only the selected O-8 strategy (A12). **Detection:** an integrity check (counters ≠ the sum of APPLIED attempt deltas, or a status change without a lifecycle receipt) holds the order through a `DISCREPANCY_REPORTED` reconciliation and moves admission to CONTAINED. **Containment:** pausing or containing admission does not stop old code; the runbook must stop or exclude the writer itself. **Detection and containment never satisfy the prevention gate and never authorize FENCED / ABSENT_FENCED (A12)** |
| 9 | Grant before the first ACQUIRE | ENROLL (epoch 1) → grant (epoch 2) → an ACQUIRE expecting 1 is REJECTED as stale; a new ACQUIRE expecting 2 by an actor with work authorization applies (2 → 3). Grant vs ACQUIRE on the order lock: grant first → the ACQUIRE expecting 1 is stale; ACQUIRE first → claim held → grant REJECTED `GRANT_CLAIM_ACTIVE` |

### A8.5 Guard action table (amends W5-0 §13.2; X-10, X-11)

| Action | CONFIRMED, no marker | Coordinated PICKING/PACKING | Coordinated READY_TO_SHIP | Legacy PICKING/PACKING/READY_TO_SHIP |
|---|---|---|---|---|
| Legacy start-picking | Only while `first_activated_at` is unset (L2) | — | — | — |
| ENROLL | L3 eligibility | REJECTED `ALREADY_COORDINATED` | REJECTED `ALREADY_COORDINATED` | REJECTED (not eligible) |
| Legacy scan, undo, complete-picking, complete-packing | — | Refuse 409 `ORDER_COORDINATED` | Refuse 409 `ORDER_COORDINATED` | Allowed only when **not HELD** (A9) |
| v1 claimed operations | — | Claimed contract only | — | Refused (not coordinated) |
| Ordinary cancellation | Policy A (A10) | Refused → supervised | Refused → supervised | Refused → supervised (SC-1) |
| Shipment | — | — | Guarded shipment (A8.7) | Allowed only for READY_TO_SHIP, not HELD, and every A8.7 condition |

**Admin complete** (SHIPPED → COMPLETED) and **returns** (SHIPPED or COMPLETED) are unchanged, except for the restore hold (A13.3) and the admission state (A8.1).

**In every column,** a restore hold, CONTAINED or RESTORE_SUSPECTED refuses the action as in A8.1 and A13. An open or ESCALATED cancellation case (A10.2) or the exhausted-claim gate (A15.2) refuses every action except the case's own operations. **Denied actions have no effect:** no counter, status, reservation, stock, movement, stock-transaction, receipt or audit change.

### A8.6 ENROLL identity, retry and recovery (B-1, B-2 OWNER-SELECTED; detail PROPOSED)

- **Before dispatch:** under J-1 the client persists the ENROLL intent (PERSISTED → SENDING) **before** dispatch. This is the SAFE.3 ordering, unchanged (`coordinator.ts:202-206`). The gate allows one pending intent.
- **Duplicates and conflicts:**
  - same key and fingerprint → original receipt;
  - same key, different fingerprint → PAYLOAD_CONFLICT;
  - a different intent on an enrolled order → REJECTED `ALREADY_COORDINATED`;
  - ineligible → REJECTED with a reason; REJECTED never advances the epoch;
  - another actor's key → indistinguishable refusal (W5-0 §8.3).
- **Lost response or reload:** OUTCOME_UNKNOWN → receipt-only lifecycle lookup (never mutates; W5-0 §10) → RECORDED settles it.
- **Lost request (ABSENT_NOT_FINAL):**
  1. Perform the lookup first wherever it is available.
  2. The operator may then explicitly confirm a **retry of the identical stored intent**: same `intent_id`, payload, fingerprint, namespace, actor and order.
  3. The server treats the retry like any arrival: the receipt-first check replays an existing receipt; otherwise it evaluates eligibility and records APPLIED or REJECTED. A late original replays that receipt.
- **Retry limits:**
  - never automatic;
  - **never under a new identity**: no new intent is created while the original is unsettled;
  - a retry that fails before acceptance (for example admission not ACTIVE, or a namespace mismatch) leaves the intent OUTCOME_UNKNOWN;
  - retry applies **only to ENROLL** (credential-free); all other kinds keep receipt-only recovery.
- **Client changes (W5-6):**
  - ENROLL kind;
  - ENROLL sent without a claim;
  - pre-enrollment context (current `phase` allows only PICK/PACK);
  - REJECTED representation (W5-0 §9.5);
  - store transition OUTCOME_UNKNOWN → SENDING for ENROLL only.

### A8.7 Guarded shipment (D-8 OWNER-SELECTED; conditions PROPOSED)

- **Permitted only when all of these hold:**
  - status `READY_TO_SHIP`;
  - no active claim;
  - no unresolved reconciliation;
  - no restore hold;
  - no open or ESCALATED cancellation case (A10.2);
  - not HELD (legacy orders, from first activation);
  - admission INACTIVE (before first activation), ACTIVE, or PAUSED when every other condition holds;
  - neither CONTAINED nor RESTORE_SUSPECTED.

  The existing allocation, expiry, stock and reservation checks are kept.
- **Effects:** the existing on-hand and reserved deduction, movements, stock transactions and audit are unchanged.
- **Denied cases:** no effect. **No keyed shipment recovery** (D-9).

## A9. O-2, LC-1…LC-4: existing legacy orders

- **Legacy order:** a non-coordinated order in PICKING, PACKING or READY_TO_SHIP. After first activation, an unmarked CONFIRMED order can only be enrolled or cancelled under Policy A.
- **HELD is an operational gate, not a `SalesOrder.status` (LC-1 OWNER-SELECTED).** It is evaluated under the order lock at every guarded legacy mutation. Classification at L1 is **not** persisted.
- **From first activation, an order is HELD when any of these holds:**
  - an unresolved reconciliation, including `LEGACY_CUTOVER`;
  - a restore hold;
  - CONTAINED or RESTORE_SUSPECTED;
  - no valid continuation record.
- **Continuation record** (LC-2 direction OWNER-SELECTED; standard and authority PROPOSED, LC-2/LC-3):
  - a maker records a physical count of staged quantities (picked and packed) per allocation that **exactly** matches the counters; legacy counters are never assumed verified;
  - an Admin who is not the maker approves;
  - the record is immutable, digest-bound to order, status, counters snapshot and restore generation;
  - for an order with an unresolved reconciliation, it is issued only by the SAFE.4 approval that resolves it (A11).
- **Invalidation:** a later reconciliation, a restore-generation change, Admin revocation, or a detected unattributed mutation. CONTAINED and RESTORE_SUSPECTED hold the order while they last. The order's own permitted legacy progress does **not** invalidate the record.
- **Legacy semantics retained:**
  - guarded legacy routes stay unkeyed; no receipts, no idempotency, no lost-response recovery;
  - a lost response is checked manually (status, counters, audit);
  - a continuation record grants no coordinated guarantees;
  - legacy orders are never enrollable.
- **Existing `LEGACY_CUTOVER` orders:** orders seeded with REQUIRED `LEGACY_CUTOVER` by migration `ed1a00000001` (PICKING/PACKING at migration time) stay HELD until SAFE.4 resolves them (LC-4).
  - **This changes current legacy behavior.**
  - Production impact is **UNKNOWN**: no operational database query is authorized.

## A10. D-8 Policy A, O-4, SC-1…SC-4: cancellation

### A10.1 Policy A (ordinary cancellation)

- **Allowed** only for DRAFT or CONFIRMED with no active claim, no unresolved reconciliation and no restore hold, subject to the admission state (A8.1). Coordinated orders are never DRAFT or CONFIRMED.
- **Refused** for coordinated PICKING, PACKING and READY_TO_SHIP: 409 `CANCELLATION_REQUIRES_SUPERVISED_PROCEDURE`, no effect. After first activation, also for legacy orders in those states (SC-1, PROPOSED). Today the existing service allows that.
- **Zero counters** do not prove zero physical work.

### A10.2 Supervised cancellation (O-4, SC-2, SC-3, SC-5 OWNER-SELECTED; mechanism PROPOSED; requires SAFE.4)

```
OPEN ──maker records put-back PB_n (supersedes PB_n-1)──► EVIDENCE_RECORDED ──Admin ≠ maker approves──► APPROVED (order CANCELLED)
  │                                                            ├──► ESCALATED (mismatch; no release; still blocking)
  └──Admin escalates (cannot complete safely)──► ESCALATED     └──► REJECTED receipt (stale; no effect; case stays open)
```

**There is no abandonment transition in V1 (SC-5).** A case ends only as APPROVED or ESCALATED.

**1. Open.**
- An Admin opens a case (keyed).
- The claim state is checked under the order lock:
  - **epoch ≤ MAX − 1:** the opening commits an epoch-advancing case fence, clearing any active claim;
  - **epoch = MAX with no held claim:** no fence is needed, because no request can apply at the current epoch (attempts need a claim; `_check_epoch` refuses expected ≥ MAX);
  - **epoch = MAX with a held claim:** the claim cannot be fenced. The case is refused, and the order is blocked by the exhausted-claim gate with supervised escalation (A15.2). No claim is assumed absent at MAX: current code permits an ACQUIRE from MAX − 1 (`fulfillment_integrity_service.py:190-196`), and the attempt path does not bound the epoch (`:170-182`).
- The case binds order, status S, epoch E and `progress_revision` V.
- While the case is open or ESCALATED, every other mutation of the order is refused: ACQUIRE, takeover, scans, completion, shipment, grants, resets, legacy mutations and every epoch-advancing operation.

**2. Settle (prerequisite; never implied).**
- Every uncertain operation known for the order (server-side items and operations reported from participating client journals) must be settled:
  - by correlated evidence (RECORDED / REJECTED); or
  - by authoritative FENCED / ABSENT_FENCED, which is CONDITIONAL on W5-7/D-11 and a committed newer epoch.
- **If any remains UNKNOWN, there is no approval.**
- **Closing a reconciliation or a case never settles an operation** (SC-3).

**3. Put-back evidence.** A maker records an immutable put-back record (PB):
- **Bindings:** order, case, S, E, V, maker, time.
- **Allocation snapshot:** id, allocated, picked and packed.
- **Lines:** `(allocation_id, expected_return, returned)`, where **`expected_return = picked_quantity`**. Packed quantities are a subset of picked (DB CHECK picked ≥ packed) and are **never added**.
- **Digest:** SHA-256 over `canonical-json/1`.
- **Validated at recording:** full membership, one line per allocation, exact 3-dp decimal strings, `returned ≥ 0`.
- A new PB supersedes the previous one.
- **Recording is keyed (PUT_BACK_RECORD).**
  - A lost recording response is resolved by lookup or by replaying the same key and fingerprint.
  - A failed recording leaves the case open and blocking; a new keyed recording may follow.
  - **A missing, failed or unconfirmed recording is never evidence that no physical handling occurred.**

**4. Approval.**
- Requested by an Admin ≠ PB maker (O-5), keyed, citing case ID, PB ID, PB digest, E, V and S.
- Under admission `FOR SHARE` → order `FOR UPDATE` → `lock_inventory`, the server checks:
  - the case is open;
  - the PB is the latest and its digest matches;
  - S, E and V are unchanged and no claim is active;
  - step 2 holds;
  - writer-exclusion evidence is current (A12, CONDITIONAL);
  - admission is not CONTAINED or RESTORE_SUSPECTED;
  - **`returned = expected_return` for every allocation** (SC-2).
- **Outcomes:**
  - a short count (including zero while goods are staged) or an excess count → **ESCALATED**, no release;
  - stale data → REJECTED receipt, no effect;
  - a PB is approved at most once.

**5. Approved: one transaction, all or nothing.**
- approval record;
- a **transaction-free cancellation core extracted from** `cancel_sales_order_service`: status CANCELLED, `reserved_qty` released by allocated quantity with the existing guard;
- audit (`CANCEL_SALES_ORDER` and `SUPERVISED_CANCELLATION` with the PB digest);
- supervised-operation receipt;
- case APPROVED;
- a referenced reconciliation → CANCELLED, only when step 2 holds.

The existing service owns a `UnitOfWork` whose exit always commits (`app/core/unit_of_work.py:16`), so it **must not be wrapped**.

**6. Inventory.**
- `on_hand` is unchanged. Put-back creates **no** stock-in, movement or stock transaction, because picking never reduced on-hand.
- Reservations are released exactly once, only in step 5.
- The approval does not advance the epoch.

**7. Lost response.** Look up the approval key, or replay the same key and fingerprint; either returns the single recorded outcome.

**8. No abandonment; escalation (SC-5 OWNER-SELECTED).**
- **No resumption from a case.** An open case never restores fulfillment or shipment eligibility. A11 S6 is **not** available from a cancellation case: S6 applies only after its own settlement, physical count, approval and resolution (A11 S2–S5).
- **The block stays.** Once a case is open, physical handling may have occurred, including when put-back recording failed or its response was lost. The order therefore stays blocked until the approved cancellation completes, or until a separately authorized recovery process (RC-1, not part of V1) establishes valid physical state.
- **Escalation.** An Admin may escalate a case that cannot complete safely. This writes an immutable escalation record (reason, evidence references, reporting user, an approving Admin who is not the reporter, time), with audit and an **auditable operator-escalation requirement**. A mismatch at approval writes the same record inside the approval transaction, where the put-back maker and the checking Admin are already different people.
- **ESCALATED has no V1 exit (SC-4).** The order stays blocked with its reservations.
- **Nothing new is introduced:** no inventory correction and no automatic restaging workflow.

**Reservations are never released while staged goods may still be physically outstanding without verified put-back.**

## A11. D-12, O-5, SC-3: minimum SAFE.4 (not implemented)

**Definitions (PROPOSED):**
- **Epoch-advancing fence:** any committed transition with a resulting epoch greater than an operation's epoch. This covers a takeover, a clearing fence, a case fence and a grant fence.
- **Clearing fence:** a transition that leaves no claim: RELEASE, COMPLETE, JOURNAL_RESET, restore fence, resolution fence, grant fence, case fence.
- **A takeover is epoch-advancing but not clearing.**

| Step | Operation | Rule |
|---|---|---|
| S0 | **Contain** | Client gates block; the reconciliation is visible |
| S1 | **Fence if needed** | If any uncertain operation (server-known or reported) has epoch = current epoch, commit an epoch-advancing fence before settling. A takeover during REQUIRED supersedes the reconciliation and invalidates counts bound to it. A fence needs current epoch ≤ MAX − 1; with a held claim at MAX, S1 and S5 are impossible and the order stays blocked with supervised escalation (A15.2) |
| S2 | **Settle** | Each operation: RECORDED / REJECTED by lookup, or FENCED / ABSENT_FENCED (authoritative only after W5-7/D-11 and a committed newer epoch). **Matched counts never settle an ambiguous attempt;** closure never settles (SC-3) |
| S3 | **Count (maker)** | Immutable count record: id, reconciliation ID, epoch, `progress_revision`, status, maker, allocation snapshot, exact picked/packed lines with full membership, reported uncertain operation keys with their settlement evidence, digest. A newer count supersedes an older one |
| S4 | **Approve (checker)** | An Admin ≠ count maker (O-5), keyed, citing count ID and digest. Under the locks: reconciliation still REQUIRED, same epoch, revision and status, S2 satisfied, writer exclusion current, admission not CONTAINED or RESTORE_SUSPECTED. Exact match → RESOLVED_MATCHED. Mismatch → ESCALATED (no fence, no epoch consumed; ordinary transitions stay blocked by the existing `_ordinary_transition_allowed`) |
| S5 | **Resolution fence** | In the S4 transaction on a match: a clearing fence; any existing claim is cleared and the epoch advances (D-3) |
| S6 | **Resume by class** (D-3a PROPOSED; coordinated branch OWNER-SELECTED) | **Only after S4 RESOLVED_MATCHED and S5 for this reconciliation; never reachable from a cancellation case (A10.2).** **Coordinated PICKING/PACKING:** a separate new ACQUIRE by an actor with work authorization, at the current authoritative epoch (AC-1); the client gate requires that actor's local operations to be settled. **Legacy:** the S4 transaction issues the continuation record (A9); guarded legacy paths. **Coordinated READY_TO_SHIP:** stays READY_TO_SHIP with no claim, eligible for guarded shipment; no PICK/PACK re-entry. **Restored:** A13.5. **Uncertain lifecycle intents:** stay blocked until RECORDED or authoritatively FENCED. **Inconsistent client journal** (receipt regression, fingerprint or namespace mismatch): INCONSISTENT → J-3 or J-4 |

**Authorization:**
- maker: an active warehouse or admin user;
- checker: an Admin who is not the maker;
- **an Admin acts only as itself** (no impersonation; `acting_supervisor` recorded).

**AX-22 is a legitimate workflow, not an injected inconsistency.** The server can resolve a reconciliation while a client still holds an unreported local attempt. The resolution fence makes that attempt unable to apply, and the client stays blocked until lookup settles it.

**Fail-closed:** missing or uncertain evidence → no approval; the order stays blocked; escalation is recorded. Resolution never replays a bearer token and never resumes automatically.

## A12. D-11, O-8, WX-1…WX-3: writer exclusion (CONDITIONAL; complete exclusion NOT proven)

**O-8 status:** operational writer control is a **provisional candidate only.** A database guard (trigger) or a separated database role remains an alternative pending feasibility evidence on disposable PostgreSQL. **None is proven.**

**Evidence gates.** These are necessary inputs and are **never by themselves proof of complete exclusion.**

| Gate | Evidence | Fails when | Does not establish |
|---|---|---|---|
| E-1 Process inventory | Every process able to write the inventory database, with revision and image digest | Any process unaccounted for or below the required revision | That no unlisted process can reconnect |
| E-2 Session inventory | Database sessions by role, `application_name` and client address. **Needs separate authorization to query an operational database** | Any unattributable or old-revision session | Trusted binary identity (`application_name` is self-declared) or future exclusion |
| E-3 Credential custody | Holders of write-capable credentials | Any holder not in E-1 or unknown | Technical prevention of bypass writes |
| E-4 Direct-writer control | Audit of scripts and tools; a rule against direct writes during coordinated operation; privileged access logged | Any unreviewed writer | Prevention of direct SQL by a privileged session (superusers bypass permission checks) |
| E-5 Continuity | Ongoing monitoring of E-2 | An unattributable session → CONTAINED and the incident runbook | Prevention before an unauthorized write commits |

**Explicitly insufficient:**
- a single API service in a Compose file;
- `/ready`, which checks only connectivity and revision;
- disabling, pausing or containing admission, which does not stop code that ignores admission.

**Required before contract freeze (UNRESOLVED):**
- **WX-1:** the trusted privileged-operator boundary: named superuser and owner-role holders; a direct-write prohibition during coordinated operation; session logging (availability UNKNOWN); maintenance only while admission is not ACTIVE.
- **WX-2:** the selected strategy, with **prevention** evidence.
- **WX-3:** pool and session termination, reconnect control, and coverage of jobs, scripts, direct SQL, owner/superuser access and maintenance.

**Required before L1 and before authoritative FENCED:**
1. guard coverage of every mutation path (writer map);
2. prevention evidence for the selected strategy;
3. WX-1 attested;
4. E-1…E-5 passing continuously;
5. a SAFE.5 **prevention** test of post-enrollment writer re-entry, in which no bypass write commits (AX-45).

**Containment is tested separately:** a drill with a deliberately injected bypass write in a disposable environment (AX-66) validates detection and containment only. **Detection and containment never satisfy the prevention gate, never count toward L1 acceptance, and never authorize FENCED / ABSENT_FENCED.**

**Failure behavior:** if complete exclusion cannot be proven, **coordinated admission (L1) stays disabled and authoritative FENCED / ABSENT_FENCED stay disabled.** Lookups return UNKNOWN / ABSENT_NOT_FINAL.

**Known feasibility questions (UNRESOLVED; disposable PostgreSQL only, separately approved):**
- **Trigger:** behavior under UnitOfWork, savepoints and pooling.
- **Role separation:** established sessions can survive NOLOGIN or a password change until terminated; REVOKE semantics for existing sessions; superusers and table owners bypass privileges, so the API role must not own the tables.
- **Topology:** the production compose gives `db`, `api` and `migrate` one environment file, so the API role may be the bootstrap superuser (UNKNOWN).

## A13. D-13, R-1…R-6: restore containment

### A13.1 Principles (OWNER-SELECTED)

- Restore containment is mandatory and fail-closed.
- Namespace rotation, a missing receipt or a missing shipment record is **never** evidence that an order was not shipped or otherwise changed after the backup.
- No hold or escalation is ever released automatically or by elapsed time.

### A13.2 Trusted provenance (R-1: requirement OWNER-SELECTED; mechanism UNRESOLVED / CONDITIONAL)

- **Problem:** a restored database contains its own admission state (possibly ACTIVE) and its own restore bookkeeping, so in-database state cannot detect its own rollback.
- **Requirement:** a trusted provenance anchor **outside the recovery domain** of the restored database. The anchor must be:
  - not backed up or restored with it, and not writable by its application roles;
  - monotonic and append-only, integrity-protected;
  - consulted before L1, before any hold release and at service start.
- **Fail-closed:** an unavailable or inconsistent anchor gives RESTORE_SUSPECTED.
- **Without trusted provenance, admission and restore-hold release stay blocked.**
- **Candidate mechanism (PROPOSED, not selected, not proven):**
  - a provenance writer periodically records to the anchor a database high-water mark (for example the highest committed audit and receipt identifiers), the namespace and the restore generation;
  - a database whose high-water mark is **behind** the anchor is RESTORE_SUSPECTED;
  - known limits: a backup taken after the last checkpoint may go undetected; detection must happen **before** any write to the restored database (an R-6 identifier advance could otherwise mask the rollback); the anchor is re-baselined only at the end of the procedure (A13.4 step 8).
- **Database OID:** a comparison against the bound `pg_database` OID is **supplementary evidence only**. It changes on a logical restore into a fresh database but not on a physical or volume restore.
- **Automatic restoration safety is not claimed** until the detection and containment mechanism is independently proven (SAFE.5 restore drill and Codex review).

### A13.3 Restore generation and holds (R-2 OWNER-SELECTED; mechanism PROPOSED)

- **Columns:** `fulfillment_namespaces.restore_generation` (integer). Every sales order carries `restore_cleared_generation` (existing rows 0; new orders = current generation).
- **An order is held** when `restore_cleared_generation < restore_generation` and the order is mutation-capable:

| Status | Held mutations |
|---|---|
| DRAFT, CONFIRMED, PICKING, PACKING, READY_TO_SHIP | Every fulfillment, cancellation, shipment and stock-affecting mutation |
| SHIPPED | Returns and Admin complete |
| COMPLETED | Returns |
| CANCELLED | Not held (no mutation path) |

- **Durability:** the hold is derived from durable columns and recomputed under the order lock. A forgotten order stays held.
- **No new SalesOrder status is introduced.**
- **Enforcement:** the guard covers every listed path, including the return service (`return_sales_order_items_service`) and Admin complete (W5-7 scope).

### A13.4 Supervised restore procedure (the trusted recovery mechanism; steps PROPOSED; R-5 and R-6 OWNER-SELECTED as mandatory)

1. **Before any API serves the restored data:** API stopped; writer exclusion per A12.
2. **Detect and record:** RESTORE_SUSPECTED detected or declared; restore event recorded in the anchor (CONDITIONAL on A13.2).
3. **One transaction** (admission row `FOR UPDATE`): admission CONTAINED (reason: restore procedure); namespace rotated with provenance; `restore_generation + 1`; restore record (backup file and its SHA-256, backup timestamp, operator, reason).
4. **Claims:** restore fence (clearing, + 1) on every order with an active claim. Stale tokens become unusable. A restored claim at MAX cannot be fenced: that order stays held and blocked by the exhausted-claim gate, with supervised escalation (A15.2).
5. **Journals and reconciliations:** every client journal becomes NAMESPACE_MISMATCH and is retained read-only as evidence, never replayed. Old-namespace requests fail before acceptance and never apply. PICKING/PACKING orders get a REQUIRED `RESTORED` reconciliation.
6. **R-6 (mandatory):** advance identifier sequences (sales order IDs, `so_number` generation, the `SHIP-{id}` basis, receipts, audit) beyond every identifier that may have been issued after the backup, from external evidence.
7. **R-5 (mandatory):** a physical stock reconciliation, applied only through existing auditable adjustment transactions, including the effects of orders created after the backup that are absent from the restored data.
8. **Re-baseline and re-admit:** re-baseline the anchor. Admission leaves CONTAINED only to PAUSED with an independent verification record (A8.1). L1 is then permitted only with trusted provenance, R-5 and R-6 complete, and fresh A12 evidence. Held orders stay held after L1; releases (A13.5) follow while admission is ACTIVE.

### A13.5 Release (R-3 OWNER-SELECTED; per-class evidence PROPOSED)

- **Who:** a maker records immutable release evidence; an Admin who is **not** the maker approves (keyed). No self-approval.
- **Binding:** order identity, restore generation, evidence version ID and digest, order status, epoch and revision, the physical-state evidence, and external shipment evidence: carrier manifests, dispatch logs and shipping documents dated after the backup timestamp.
- **Blocked** while provenance is untrusted.
- **Atomic:** `restore_cleared_generation` = current generation, receipt and audit. For PICKING/PACKING orders, also RESOLVED_MATCHED with a resolution fence (A11); for legacy orders, also a continuation record.

| Class at restore | Required evidence | Continuation after release |
|---|---|---|
| DRAFT, CONFIRMED | Shipment-status check (no pickup, manifest or shipment document after the backup) and physical check (nothing staged) | DRAFT unchanged; CONFIRMED enrollable only through ENROLL (N-1) |
| PICKING, PACKING (coordinated) | Shipment-status check and a SAFE.4 matched count of staged quantities | Resolution fence → new ACQUIRE (J-4 journals) |
| PICKING, PACKING (legacy) | Shipment-status check and a SAFE.4 matched count | Continuation record → guarded legacy paths |
| **READY_TO_SHIP** | Shipment-status check **and** physical presence of packed goods matching the packed counters | Guarded shipment eligibility only; no PICK/PACK re-entry |
| SHIPPED, COMPLETED | Return-status check (no return received after the backup) | Returns, and Admin complete for SHIPPED |

### A13.6 Post-backup shipment (R-4 OWNER-SELECTED)

- **When it applies:** evidence shows an order was physically shipped or otherwise fulfilled after the backup.
- **The order is ESCALATED:** it stays held. Shipment, cancellation, reservation release, stock deduction and returns are refused. There is **no automatic reconstruction in V1**.
- **Inconclusive evidence:** the order simply stays held.
- **Supervised escalation boundary:** an immutable escalation record (evidence, maker, approving Admin ≠ maker). Beyond it only three things are permitted:
  - read-only investigation;
  - recording further evidence;
  - a separately approved future reconstruction procedure.
- **Inventory effect:** stock differences are corrected only through R-5 adjustments. The escalated order's reservation remains, and any resulting inconsistency needs that separate procedure.

### A13.7 Clone or replacement

| Use | Rule |
|---|---|
| Used as a replacement (failover, migration) | The A13.4 procedure applies in full |
| Non-production clone | Rotate the namespace, keep admission not ACTIVE, and never connect production clients. If it later serves production, the full procedure applies |

## A14. D-14 and O-9: barcode

- **Identity (OWNER-SELECTED):** the exact Unicode scalar sequence, **including the GS1 Group Separator U+001D**. Leading zeros preserved; **no** trim, case conversion, normalization or GS1 parsing. NFC and NFD forms are distinct identities.
- **Length:** 1…100 **code points** on every layer. JavaScript UTF-16 length is not used.
- **Always rejected:** U+0000 and lone surrogates.
- **Other control characters, whitespace and zero-width characters (O-9):** UNRESOLVED pending an authorized compatibility assessment. Until resolved, they are neither rejected nor transformed.
- **Fingerprints:** existing accepted calculations unchanged.
- **Live input contract.** The coordinated input must **not** apply the legacy `use-scanner.ts` behaviors: `trim()`, the three-character minimum, or silent suppression of an identical code within 120 ms. Behavior is **state-based, never time-based:**
  - **While a scan or lifecycle request is pending** (BUSY, OUTCOME_UNKNOWN, RECONCILIATION_REQUIRED, PAUSED or BLOCKED), any new scan is refused visibly: no attempt is created, nothing is queued, there is no second dispatch. This preserves the accepted SAFE.3 gate (`coordinator.ts:101-104`, `:114-120`; `safe-workflow-panel.tsx:16-26`, `:36`).
  - **After settlement,** each new **accepted** physical scan (with explicit operator confirmation of a new physical action, as in SAFE.3) gets a fresh idempotency key, even for an identical barcode. An identical payload yields the identical client fingerprint.
  - **Closed-gate input (BC-2, PROPOSED):** input received while the gate is closed is discarded and never forms part of a later submission.
- **Required assessments (not authorized here):**
  - a read-only data inventory (encoding, collation, character classes, collisions, lengths);
  - a scanner compatibility check (hardware wedge prefixes, suffixes and GS transmission; camera decoder output; manual entry).

## A15. O-6, EP-1: epoch headroom (principle OWNER-SELECTED; thresholds UNRESOLVED)

**Never:** wraparound, silent reset, arbitrary epoch advancement, or BIGINT widening. MAX = 2147483647.

### A15.1 Transition classes and proof obligations

| Class | Transitions |
|---|---|
| Creates a held claim | ACQUIRE, TAKEOVER |
| Advances and leaves no claim | RELEASE, COMPLETE, JOURNAL_RESET, restore fence, resolution fence, grant fence, case fence, ENROLL (0 → 1 only) |
| Does not advance | Supervised cancellation approval, guarded shipment, restore release (other than its SAFE.4 resolution fence), FENCE tombstone, every REJECTED outcome |

**Proof obligations (P1 safety, P2 liveness; not established guarantees):**
- every "advances and leaves no claim" transition remains permitted up to `expected_epoch ≤ MAX − 1`;
- claim creation requires headroom, so a claim **created after the headroom rule is enforced** exists only at an epoch ≤ MAX − 1. This is **not assumed for existing or restored data**: current code permits an ACQUIRE from MAX − 1 to MAX (`_check_epoch` refuses only expected ≥ MAX), and the attempt path does not bound the epoch. Such claims are handled by A15.2;
- at MAX with no held claim (checked under the order lock), the "does not advance" exits (supervised cancellation, guarded shipment) remain available;
- the model must also cover phase transitions, already-cleared orders at MAX, restored claims near exhaustion, and recovery while admission is not ACTIVE.

**A finite reserve cannot guarantee completion through unbounded recovery.** The guaranteed exit is supervised cancellation, provided its own prerequisites are proven feasible.

**Operational limits:**
- near the threshold, claim-creating transitions are REJECTED (durable receipt, `FULFILLMENT_EPOCH_HEADROOM_EXHAUSTED`);
- monitoring warns earlier.

**Gate:** numeric thresholds (EP-1) are UNRESOLVED. A proven safety and liveness transition budget (model plus tests) is required **before W5-2**.

### A15.2 Held claims at MAX (EP-2 direction OWNER-SELECTED; gate mechanism PROPOSED)

- **Detection:** under the order lock, `fulfillment_claim_epoch = 2147483647` with a held claim (`fulfillment_claim_token_hash` present). It can arise from pre-existing data or a restore. This **exhausted-claim gate** is derived from durable columns and recomputed by the guard, so it fails closed.
- **What is refused:** every guarded mutation of the order, with no effect. This includes:
  - the holder's claimed attempts and lifecycle operations (RELEASE and COMPLETE cannot fence beyond MAX; `_check_epoch` already refuses them);
  - grants, resets, case opening, resolution and restore fences;
  - shipment and cancellation.

  Lookups stay available.
- **No settlement by absence:** operations at epoch MAX cannot become ABSENT_FENCED, because no newer epoch can be committed. They remain UNKNOWN.
- **Supervised escalation:** an immutable escalation record (reporting user, an approving Admin who is not the reporter, evidence, time), with audit and an auditable operator-escalation requirement.
- **Recovery:** only a separately approved recovery policy (RC-1). **No reset, wraparound, widening or arbitrary advance.** Until such a policy exists the order stays blocked.
- **Tests:** future transition tests (AX-65) before W5-2. Thresholds remain UNRESOLVED (EP-1).

## A16. D-7: retention (OWNER-SELECTED)

No automatic deletion of any of these in V1:
- attempt and lifecycle receipts, supervised-operation receipts;
- reconciliation, count, put-back, case, grant, reset and continuation records;
- restore, release and escalation records;
- audit evidence.

Unresolved evidence is kept indefinitely. Archival is a later decision.

## A17. Deferred items

| Item | Status |
|---|---|
| **D-2** | DEFERRED until before W5-4 (before W5-1 if assignment tables are chosen). Strict no-impersonation applies throughout: an Admin acts only as itself |
| **D-9** | DEFERRED until before W5-7. Ambiguous shipment outcomes are handled manually (order status, `shipment_number`, movement ledger, audit); no automatic mutation retry; no keyed shipment recovery |
| **D-10** | DEFERRED until before W5-7. Production-page entry changes need later owner approval; the frozen files stay unchanged |

## A18. O-7: SAFE.5 scope (OWNER-SELECTED scope; exact tests UNRESOLVED)

SAFE.5 is the runtime validation gate before live activation. It is distinct from **W5-5** (the BFF package).

**Proposed scope:**
- end-to-end disposable-stack validation (Backend → BFF → browser);
- writer-exclusion evidence (A12): a prevention test of post-enrollment writer re-entry, plus a separate containment drill that never substitutes for prevention;
- multi-client and multi-device races;
- restore drills (A13), including restore after a post-backup shipment and proof of the provenance mechanism;
- R-5 and R-6 rehearsal;
- recovery paths (A10, A11);
- frontend/BFF integration;
- operational rehearsals;
- an independent Codex acceptance review.

The exact tests are subject to separate review before SAFE.5 begins.

## A19. Amendments to the accepted W5-0 draft (W5-0 files unchanged)

Each row quotes the accepted W5-0 wording verbatim.

| # | Accepted W5-0 provision (verbatim) | Amendment |
|---|---|---|
| X-1 | §11, Initial enrollment row: “`fulfillment_claim_epoch = 0` **and** no cutover marker” | Replaced by J-1 (A7.3), which adds CONFIRMED, zero counters, no unresolved reconciliation, no restore hold, admission ACTIVE, trusted provenance and actor binding, and authorizes only an ENROLL intent. After ENROLL the epoch-0 basis no longer applies. The complete §11 basis model is replaced as stated in X-19 |
| X-2 | §13.2, cancel row: “refused while a claim is active or a reconciliation is unresolved; otherwise allowed” | Replaced by A10: Policy A for ordinary cancellation; supervised cancellation otherwise, with no abandonment (SC-5) |
| X-3 | §13.1: “It is set atomically with the first coordinated action and never cleared.” and §13.2, start-picking row: “Allowed (CONFIRMED → PICKING precedes any claim)” | The first coordinated action is ENROLL (A8.3 L3), the only coordinated route from CONFIRMED to PICKING; after first activation legacy start-picking is refused (N-1, L2) |
| X-4 | §5.2: “**Lifecycle payload:** the existing client fields” | ENROLL added as a lifecycle kind; GRANT and JOURNAL_RESET as lifecycle receipt kinds; supervised-operation receipts added (A5). New unmounted routes in W5-4 (A21) |
| X-5 | §5.5: “**Charset and length are UNRESOLVED (D-14):** client 200 vs backend 100 (C-14).” | Replaced by A14: 1…100 code points, exact identity; O-9 remains UNRESOLVED |
| X-6 | §3, C-16: “seeds `LEGACY_CUTOVER` REQUIRED reconciliations” | Such orders are HELD until SAFE.4 resolution (A9). Reasons `RESTORED` and `JOURNAL_RESET` need a reason-CHECK migration (A20) |
| X-7 | §16: “non-negative epochs and revisions” | Added: epoch-headroom classes and proof obligations (A15.1) and the exhausted-claim gate for held claims at MAX (A15.2). No reset, wraparound or widening |
| X-8 | §9.2: “`resulting_epoch > expected_epoch`” | Retained for lifecycle receipts: ENROLL, GRANT and JOURNAL_RESET comply. Operations that do not advance use supervised-operation receipts (A5) |
| X-9 | §9.3: “Resuming requires an explicitly authorized new claim action.” | For coordinated PICKING/PACKING: resolution fence, then a separate new ACQUIRE at the current authoritative epoch (A4, A11, AC-1). Other classes per A11 S6 (D-3a). Never from a cancellation case (SC-5) |
| X-10 | §13.2: “is called **inside the order row lock** by every fulfillment-affecting service” | The guard is split: the admission, namespace and provenance check runs **before** the order lock; acquiring admission inside an order lock is prohibited (A8.2). The same amendment applies to §8.1 (X-16), §15.1 (X-17) and §15.5 (X-18) |
| X-11 | §13.2, legacy row: “Refuse 409 `ORDER_COORDINATED` before any effect”; ship row: “Allowed **only** when status is `READY_TO_SHIP`” | Retained and made action-specific (A8.5). Shipment additionally requires no restore hold and an admission state permitting it (A8.7). Revision 1's blanket wording is withdrawn |
| X-12 | §11, Restoration row: “A recorded **supervised journal-reset fence** for this actor and order at epoch E, committed after the loss” | Refined into J-3 JOURNAL_RESET (always with a REQUIRED reconciliation, G-4) and J-4 RESTORE_RESET for a database restore (A7.3); complete model in X-19 |
| X-13 | §16: “Recovery is a verified backup restore **with namespace rotation**, which blocks old journals.” | Rotation is necessary but not containment: restore generation holds, trusted provenance, the supervised procedure, R-5 and R-6 (A13) |
| X-14 | §13.2: “Old server processes must be drained or excluded before admission (D-11).” | Refined by the A12 gates, the admission states (A8.1) and post-enrollment writer re-entry handling (A8.4 case 8) |
| X-15 | §10: “**Never mutates:** a lookup performs no business write” | Retained. The ENROLL retry (B-2) is a separate keyed submission of the identical intent, made after lookup, never a lookup side effect (A8.6). The W5-0 §9.5 limitation stays until W5-6 |
| X-16 | §8.1, step 3: “Lock the order.” | Preceded by the admission, namespace and provenance check holding the admission row `FOR SHARE`; then the order is locked (A8.2). Lookups take no admission lock |
| X-17 | §15.1: “**Lock order:** the order row `FOR UPDATE` first, then `lock_inventory` (sorted products → batches → balances).” | Replaced by A8.2: admission row `FOR SHARE`, then the order row `FOR UPDATE`, then `lock_inventory`. Admission state changes take the admission row `FOR UPDATE` |
| X-18 | §15.5: “Both paths take the order row lock first, so they serialize.” | Both paths first take the admission row `FOR SHARE`, which does not serialize them, then the order row lock, which does. Outcomes A and B of §15.5 are unchanged |
| X-19 | §11, complete basis model: “Uncertain or inconsistent history” (the “Anything else” row) and “**Before W5-7:** only initial enrollment applies, in isolated test environments.” | The §11 basis table is replaced in full by the closed list J-1 PRE_ENROLLMENT, J-2 FIRST_USE_GRANT, J-3 JOURNAL_RESET and J-4 RESTORE_RESET (A7.3). Anything else is still denied. Before W5-7 only J-1 applies, in isolated test environments; J-2, J-3 and J-4 are not authoritative for live use before W5-7 and D-11 |

**Coverage.**
- **Amended above:** every accepted W5-0 statement that fixes a lock order (§8.1 step 3, §13.2, §15.1, §15.5) and the complete §11 basis model.
- **Still true without amendment:** statements that an operation runs under the order row lock (§9.4, §10, §14). The admission row is acquired before, not instead of, the order lock, and lookups take no admission lock.
- **Not amended:** §3 (C-15), which records current code rather than a contract rule.

**All W5-0 invariants I-1…I-8 are preserved.**

## A20. W5-1 persistence implications (not an implementation authorization)

**Additive only;** proposed migration `ee1a00000001` (name to be checked for collisions):

- `fulfillment_namespaces`: one active row, rotation provenance, `restore_generation`, bound database OID (supplementary);
- `fulfillment_lifecycle_receipts`: kinds incl. ENROLL, GRANT, JOURNAL_RESET; outcomes APPLIED / REJECTED / FENCED; `subject_actor`, `acting_supervisor`; APPLIED ⇒ advance;
- attempt-receipt columns: namespace, client fingerprint and algorithm, contract version;
- `sales_orders`: `fulfillment_progress_revision`; marker columns (`coordinated_at`, `cutover_id`, `enrolled_by`, namespace); `restore_cleared_generation`;
- `fulfillment_admission`: state, containment reason, required revision, evidence reference, `enabled_by` / `enabled_at`, `first_activated_at`;
- grants: identity, issuer, grantee, fence epoch, status (active, revoked, superseded);
- journal reset records; legacy continuation records;
- reconciliation reasons `RESTORED`, `JOURNAL_RESET` (CHECK migration);
- no TTL (D-7).

**A later SAFE.4-era migration (not W5-1):**
- supervised-operation receipts;
- cancellation cases, put-back records, count records, approvals;
- restore release records;
- escalation records (cancellation cases, post-backup shipment, held claims at MAX).

**Excluded:**
- a DB guard trigger (CONDITIONAL on proof);
- the provenance anchor store (outside the database by definition);
- D-2 tables unless chosen.

## A21. Package dependencies

| Package | Additions |
|---|---|
| W5-1 | A20. R-1 mechanism selected first (its columns); AD-1, G-3, G-4 decided |
| W5-2 | ENROLL core (one transaction with start-picking), admission-state checks before the order lock, N-1, grants and reset fences, ACQUIRE validated against the current authoritative epoch (AC-1), headroom classes, the exhausted-claim gate (A15.2), lifecycle receipts. **Proven O-6 budget, AX-65 transition tests and the AD-2/AD-3 matrix required first** |
| W5-3 | Context (marker, admission state, journal basis J-1…J-4, legacy HELD status, restore hold), lookups |
| W5-4 | Unmounted routes: enroll, grant, grant revocation, journal reset, fence |
| W5-5 | BFF allow-list and headers |
| W5-6 | Client: ENROLL kind and pre-enrollment context, ENROLL retry transition, REJECTED and FENCED states, terminal context, code-point barcode input with the state-based gate, BC-2, regression detection |
| W5-7 | Split guard on every fulfillment, shipment, cancellation, return and Admin-complete path; N-1; HELD gate and continuation; Policy A; shipment guard; restore holds; case and exhausted-claim gates; writer map; admission procedures; restore runbook incl. R-5/R-6; A12 evidence; inventory regression |
| SAFE.4 | A11, A10 supervised cancellation without abandonment (SC-5), A13.5 restore release, escalation records (all required before activation); extraction of the transaction-free cancellation core |
| SAFE.5 | A18 |

## A22. Freeze criteria and change control

The contract may be frozen only when **all** of the following hold:

1. the owner explicitly resolves D-1, D-3 (incl. D-3a), D-4, D-5, D-6, D-8 and D-14, subject to review;
2. verifiable owner policy provenance is available (PV-1) or the owner accepts transcript-only provenance;
3. the enrollment, recovery, cancellation and restore details are unambiguous;
4. the W5-1-affecting choices are settled (R-1 mechanism selection, AD-1, G-3, G-4, WX-2);
5. receipt identity, rejection boundaries, replay and FENCED prerequisites are unambiguous;
6. no recovery returns a historical bearer credential;
7. missing evidence remains blocking;
8. barcode expectations are explicit and the assessment is assigned;
9. the SAFE.4 / SAFE.5 prerequisites have activation gates, and the operational limitations without a V1 exit (SC-4, SC-5, A15.2) are explicitly accepted;
10. Codex confirms package scope and dependencies;
11. **the owner separately approves the freeze.**

A documentation freeze is not runtime validation. Runtime scenarios stay OPEN until implemented and tested. This draft changes only through owner-approved packages.

## A23. Items requiring further owner decision

| Item | Gate |
|---|---|
| D-3a class-specific resumption | Contract freeze |
| AD-1 N-1 permanence; G-3 grant lifetime; G-4 JOURNAL_RESET reconciliation | Before W5-1 |
| AD-2 matrix detail; AD-3 mutations during a planned pause | Before W5-2 |
| G-5 self-grant prohibition | Before W5-4 |
| LC-2 standard, LC-3 authority, LC-4 HELD-by-default impact; SC-1 legacy supervised-cancellation scope | Before W5-7 |
| SC-4 acceptance that ESCALATED has no V1 exit (incl. cancellation cases under SC-5 and held claims at MAX) | Contract freeze |
| RC-1 separately authorized recovery process | Separate owner approval of its own package before it is relied upon |
| EP-2 held claims at MAX: transition tests | Before W5-2 |
| R-1 provenance mechanism | Selected before W5-1; independently proven before restored-system admission |
| WX-1, WX-2, WX-3 (D-11, O-8) | Before contract freeze; proof before L1 |
| EP-1 numeric thresholds | After the proven budget, before W5-2 |
| O-9 barcode restrictions | After the authorized assessment, before W5-4 |
| BC-2 closed-gate input | Before W5-6 |
| O-7 exact SAFE.5 tests | Before SAFE.5 |
| D-2, D-9, D-10 | At their gates (A17) |
| PV-1 durable owner decision record | Before contract freeze |
| Authorization for the read-only barcode checks, operational database checks and disposable-PostgreSQL feasibility tests | Before the dependent decisions |

## A24. Remediation record

### A24.1 Revision 1 → revision 2 (Codex addendum audit)

The delta audit classified F-1, F-5, F-6, F-9 and the A19 note as PARTIALLY RESOLVED in revision 2, because of R2-1, R2-2, R2-5 and R2-6. Their completion is recorded in A24.2.

| Finding | Correction | Sections | Acceptance scenarios |
|---|---|---|---|
| F-1 (MAJOR) grants vs erased history | Journal and work authorization separated; server-known history across namespaces; closed basis list; Admin-only fenced grants with no-history, replay and revocation rules; unknown history fails closed | A7 | AX-9, AX-10, AX-11, AX-12, AX-60 |
| F-2 (BLOCKER) ENROLL bootstrap | J-1 PRE_ENROLLMENT (B-1); ENROLL persisted before dispatch; identical-intent retry after lookup (B-2); post-ENROLL empty journal → J-3 | A7, A8.6 | AX-1, AX-9, AX-43, AX-44 |
| F-3 (MAJOR) first-commit-wins | Admission-relative interleavings; split guard with admission before the order lock | A8.2, A8.4 | AX-4, AX-5, AX-61 |
| F-4 (MAJOR) blanket legacy refusal | Action-specific guard table; guarded shipment preserved | A8.5, A8.7 | AX-16, AX-46, AX-47 |
| F-5 (MAJOR) put-back validation | `expected_return = picked`; exact match; immutable PB with digest; checker binding; one atomic transaction with an extracted cancellation core; no stock-in | A10.2 | AX-18, AX-19, AX-20, AX-21, AX-49, AX-50, AX-51, AX-52 |
| F-6 (MAJOR) SAFE.4 sequencing | Takeover ≠ clearing fence; fence before settlement; immutable count record; class-specific resumption; AX-22 clarified | A4, A11 | AX-22, AX-23, AX-25, AX-26, AX-59, AX-62 |
| F-7 (BLOCKER) restored READY_TO_SHIP | Durable restore generation holds incl. READY_TO_SHIP and terminal return paths; trusted provenance requirement; per-class release with maker and different Admin; post-backup shipment ESCALATED; R-5, R-6 | A13 | AX-31, AX-32, AX-53, AX-54, AX-55 |
| F-8 (MAJOR) rapid repeat | State-based gate: refusal while pending, fresh key after settlement with explicit confirmation | A14 | AX-35, AX-57, AX-58 |
| F-9 (MAJOR) missing AX cases | AX-1…AX-42 revised where required; AX-43…AX-62 added; every row has all fields | Matrix | AX-1…AX-62 |
| F-10 (MINOR) fixture assertions | `scan-no-trim` barcode corrected; schema validity separated from UI and backend capability; 14 digests unchanged | Fixture | AX-33, AX-35 |
| A19 note (MINOR) | Exact W5-0 quotations; X-10…X-15 added | A19 | — |
| Provenance (audit §5) | Source column; OWNER-SELECTED limited to quoted directions; transcript-only provenance stated | A1, A2 | — |

### A24.2 Revision 2 → revision 3 (Codex delta audit)

| Finding | Owner disposition (OWN-3) | Correction | Sections | Acceptance scenarios |
|---|---|---|---|---|
| R2-1 (BLOCKER) cancellation abandonment | Conservative V1 policy: no abandonment restores fulfillment or shipment eligibility (SC-5) | Abandonment transition removed. A case ends only as APPROVED or ESCALATED and blocks the order until then. Put-back recording is keyed; failed or lost recording keeps the block; missing evidence never implies no handling. No A11 S6 shortcut. Escalation record with an operator-escalation requirement. No new correction or restaging workflow (RC-1 UNRESOLVED) | A5, A10.2, A11, A2 (SC-4, SC-5, RC-1) | AX-18, AX-63 |
| R2-2 (MAJOR) grant before first ACQUIRE | Preserve ENROLL 0 → 1; ACQUIRE validates the current authoritative epoch; never a client-derived epoch (AC-1) | L5 validates the current authoritative epoch (1 only without an intervening authorized epoch advance). Epoch-source rule. Interleaving 9. Grant text notes the effect on in-flight requests | A7.4, A8.3, A8.4, A11 S6, A2 (AC-1) | AX-6, AX-64 |
| R2-3 (MAJOR) claim at MAX | No assumption that no claim exists at MAX; locked check; block with supervised escalation; no reset, wrap, widen or arbitrary advance (EP-2) | Case opening checks the claim state under the lock. New exhausted-claim gate (A15.2). Proof obligations qualified for existing and restored data. Restore fence, JOURNAL_RESET, S1 and S5 refuse at MAX | A7.5, A10.2, A11, A13.4, A15.1, A15.2, A2 (EP-2, RC-1) | AX-56, AX-65 |
| R2-4 (MINOR) prevention vs incident response | Prevention proof mandatory; containment tested separately; never substitutes | AX-45 is prevention-only. New containment drill AX-66. A12 and A8.4 case 8 state that detection never satisfies prevention or authorizes FENCED / ABSENT_FENCED | A8.4, A12, A18, A2 (D-11) | AX-28, AX-45, AX-66 |
| R2-5 (MINOR) W5-0 precedence coverage | Address §15.1, §15.5, §11 and the complete basis model with accurate quotations | X-16 (§8.1), X-17 (§15.1), X-18 (§15.5), X-19 (complete §11 model) added. X-1, X-2, X-7, X-9, X-10 and X-12 cross-referenced. Coverage statement added | A19 | — |
| R2-6 (MINOR) matrix ambiguities | Explicit failure behavior; identity qualifications; minimal new scenarios | Failure behavior for AX-15, AX-18, AX-33, AX-35, AX-38, AX-40, AX-46 and AX-58. AX-5 and AX-50/AX-52 identity rules. AX-63…AX-66 added | Matrix | AX-5, AX-15, AX-18, AX-33, AX-35, AX-38, AX-40, AX-46, AX-50, AX-52, AX-58, AX-63, AX-64, AX-65, AX-66 |
