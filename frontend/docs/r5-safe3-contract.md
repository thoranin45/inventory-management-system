# R5-SAFE.3 isolated frontend foundation

**SIMULATION ONLY. NON-ROUTABLE. NON-RELEASE-READY.** No production page imports this workflow. No BFF or backend adapter is added or mounted. Fixtures never represent live inventory evidence.

## Boundary and development

The isolated Vite root is `fulfillment-harness`, bound to `127.0.0.1:5087` with strict port selection. Its synthetic RPC has no upstream network or database implementation. The client refuses a different origin, sends no cookies, and only calls `/__simulation`. The fixture checks Host and Origin, limits body size, and returns `Cache-Control: no-store`. The harness CSP restricts connections. Production transport has no default implementation or legacy unkeyed fallback. No environment flag enables this workflow in the app.

Run from frontend with the existing supported Node environment:

```
node node_modules/vitest/vitest.mjs run src/lib/fulfillment src/lib/query/fulfillment-safe.test.tsx src/components/work/fulfillment-safe
node node_modules/@playwright/test/cli.js test --config playwright.fulfillment.config.ts
node node_modules/vite/bin/vite.js --config fulfillment-harness/vite.config.ts
```

The browser configuration uses installed Edge in a fresh temporary browser context. Browser results use a unique temporary directory; credentials, video and traces are not recorded. The fixture starts with order 101 and operator 1. Operator 2 represents a synthetic Admin in unit tests. Browser tabs are same-origin participants, never asserted to be distinct physical devices.

## Journal and initialization

Native IndexedDB version 1 has stores `attempts`, `orderGates`, `lifecycleIntents`, `metadata`, each with a partition index. Partition identity is the trusted tuple `[deployment, actor, order]`. The fixed harness deployment is `SIMULATION-R5-SAFE3-NO-LIVE-INVENTORY`; no random identity is used to hide previous records. One handle is pinned to one actor/order. Managed separate browser profiles are required per operator. Partition filtering is NOT cryptographic confidentiality against another user or XSS in the same profile.

An empty database cannot distinguish first use from deletion or eviction. `initialize` requires a validated context with explicit synthetic initialization evidence. If remote history exists, the fixture does not authorize an empty journal. Existing journals can load and recover. A local metadata row is only a format marker, not proof of no remote history. Live initialization needs a separately approved server recovery/reconciliation/fenced-cutover contract.

Attempt and order gate are written in one strict-durability readwrite transaction. Promise resolution occurs on transaction `complete`, never individual request success. A later transaction must durably set SENDING before dispatch. Abort, unsupported version, corruption, actor mismatch, missing coordination and lost transaction ownership fail closed. An aborted handle is unusable and must be reopened/re-authorized. Snapshot integrity checks bind immutable scope and payload to SHA-256; this is corruption detection, not an adversarial signature or protection against XSS. IndexedDB cannot guarantee survival of eviction, profile deletion, hardware failure or every browser crash.

Attempt fields: version, scope, secure UUID key, original operation/phase/epoch, barcode (including leading zeros), optional allocation identity, canonical quantity string, SHA-256 fingerprint, revision, creation/update timestamps, state and validated evidence. Omitted allocation is distinct from supplied allocation; explicit undefined is rejected. No credential belongs in these records. Requests are sent only from the committed stored attempt. Immutable payloads cannot be changed on manual retry. `crypto.randomUUID` has no weaker fallback.

## State and evidence

| State | Allowed next state | New physical work |
|---|---|---|
| CREATED | PERSISTED | No dispatch yet |
| PERSISTED | SENDING, CANCELLED_UNSENT | Blocked |
| SENDING | OUTCOME_UNKNOWN, APPLIED, REJECTED, CONFLICT, NOT_APPLIED_FENCED | Blocked |
| OUTCOME_UNKNOWN | SENDING (manual identical retry), APPLIED, REJECTED, CONFLICT, NOT_APPLIED_FENCED | Blocked |
| CONFLICT | APPLIED, REJECTED, NOT_APPLIED_FENCED with correlated evidence | Blocked; no retry |
| APPLIED, REJECTED, NOT_APPLIED_FENCED, CANCELLED_UNSENT | Terminal | Only after every current gate passes |

All journal changes use revision/CAS checks. Reload changes SENDING to OUTCOME_UNKNOWN. A successful GET of current progress never changes attempt state. Missing receipt without a committed fence never settles an attempt. Receipts must match original actor/deployment/order/key/fingerprint/epoch and valid outcome/status pairing. Applied status is 200; recognized rejected receipts use 404/409. Generic errors, 401/403/409/422, transport failures, BFF failures and malformed responses are uncertainty, not evidence. A conflict response blocks and cannot authorize a new key. Historical results remain historical, separate from current counters.

RECONCILIATION_REQUIRED is an order gate. REQUIRED, CORRECTION_IN_PROGRESS and ESCALATED block ordinary fulfillment. Resolved statuses do not erase attempt or claim gates. Correction and Admin acceptance controls are intentionally absent; they require R5-SAFE.4.

No automatic mutation retry, queue, dismissal, expiry or cleanup API exists. Policy targets are seven days for eligible settled rows and thirty days for minimal terminal tombstones, but destructive cleanup is disabled. Unresolved, conflict and reconciliation evidence has no automatic expiry. Eligibility and evidence-preservation proofs are prerequisites for any later cleanup implementation.

## Claims, lifecycle and ownership

Raw token remains inside a closure. Only the explicitly injected request callback receives it. It is absent from IndexedDB, local/session storage, React state, query caches, URLs, broadcasts and normalized errors. Logout, actor invalidation, release and completion clear credentials. Generation checks reject late responses. True reload loses the token and pauses work; receipt observation can settle history but cannot recreate a credential. No automatic acquire, takeover or epoch rotation exists.

Acquire, Takeover, Release and Completion each persist a nonsecret lifecycle intent and gate before dispatch. Lost lifecycle responses remain unresolved; a changed phase or cleared holder is not proof of completion or physical verification. Only correlated future lifecycle evidence can resolve the intent. No automatic lifecycle retry exists. Tokenless recovery does not return the original bearer token. A recovered Acquire requires explicit supervised takeover to work again. Original actor loss requires later supervised reconciliation, not impersonation.

Web Locks hold exclusive same-origin deployment/order ownership across all actors. `ifAvailable` refuses a second owner immediately; no heartbeat or timeout steals ownership. BroadcastChannel carries only journal-change and actor-logout notifications. Neither API's absence permits a weaker fallback. Every coordinator entry closes the synchronous input gate before any await. Logout discards credentials and suspends the handle. Ownership release alone never proves settlement.

Keyboard scanner Enter, manual Scan, Undo, claim, release and completion share the coordinator gate. Repeated Enter and simultaneous clicks are not queued. Explicit new-physical-action confirmation is required for each scan/undo; this deliberately favors safety over throughput in the harness. A separate legitimate action obtains a new key only after settlement and all current gates pass. Event suppression is not backend idempotency. Existing scanner hooks and timing tests are unchanged.

## Exact quantities and release UX

Only locale-independent plain decimal strings are accepted. Validate type, syntax, scale and 15-integer-digit bound BEFORE padding or BigInt arithmetic. Scan/undo must be positive; physical counts may be zero. No Number, parseFloat or toFixed determines authoritative quantities. Allocation identifiers are integers, distinct from quantity parsing.

Valid internal scan payload:

```json
{"operation":"SCAN_PICK","phase":"PICK","epoch":1,"barcode":"00001234","quantity":"1.001"}
```

Valid physical count line:

```json
{"allocation_id":1,"picked":"1.001","packed":"0.000"}
```

Rejected quantities include JSON `1.001`, `true`, `"1e3"`, `"1,000"`, `"-1"`, `"1.0001"`, `"1000000000000000"` and nonfinite values. Thai/English validation copy does not change wire syntax.

VERIFIED release lists every authoritative allocation with expected counters alongside initially blank physical count inputs. Attestation is unchecked. All counts, membership, bounds and current progress/epoch must match, then the operator reviews and explicitly confirms. A final preflight checks fresh context. UNVERIFIED requires a reason, sends no counts/attestation, and explains reconciliation blocking. Lost release response is displayed honestly. Radix handles dialog focus and Escape; existing Concept B buttons/tokens are reused. TH/EN, explicit light/dark theme, roles, narrow layouts and keyboard input are covered by isolated tests. Production dictionaries and session provider are untouched.

## Missing live integration contracts: approval required

The accepted backend claim router remains unmounted. Existing scan/undo/completion routes remain unkeyed. Existing BFF forwards Idempotency-Key but not claim credentials. The following are FUTURE dependencies, not implemented endpoints:

1. Fulfillment context: trusted deployment/actor/order, exact allocation strings, phase, current epoch/holder, reconciliation and progress revision, plus authoritative initialization/recovery/cutover evidence. Empty local storage must not authorize mutation.
2. Receipt-only recovery: original authenticated actor, key and immutable fingerprint/payload; returns RECORDED, ABSENT_NOT_FINAL or authoritative ABSENT_FENCED. It must never execute stock mutation. Fenced absence requires locked absence plus a committed newer epoch and proof every mutation path is fenced/quiesced.
3. Lifecycle evidence: immutable intent identity/fingerprint/expected epoch correlated with durable server audit evidence. A generic current claim state cannot prove which lifecycle action committed. Token-bearing responses must never be journaled.
4. Keyed scan/undo and claimed completion adapters: atomic receipt behavior, original-actor replay, validated response metadata, status/message error classification and claim fencing. Current service metadata lacks the complete recovery envelope modeled here.
5. BFF: explicitly allow coordinated routes; forward `Idempotency-Key`, `X-Fulfillment-Claim-Token`, `X-Fulfillment-Claim-Epoch`; bind the request to the captured authenticated actor/session, normalize envelopes without secrets, prohibit caches and return historical replay metadata. No old unkeyed fallback.

The fixture envelope and local fingerprint are deliberately NOT claimed wire-compatible with current backend `_attempt_view` or its canonical digest. A future adapter must validate and translate the agreed server fingerprint contract; fixtures are not acceptance evidence for that integration.

## Coordinated activation blocker

There is no production activation mechanism in this slice. Future owner authorization must coordinate backend claim/recovery/receipt/completion contracts, BFF forwarding and actor binding, frontend durable attempts, reconciliation blocking, and old unkeyed route fencing in one reviewed gate. Backend integration, R5-SAFE.4, Docker and deployment remain outside scope. The existing full frontend scanner timing RED gate and `/ready` versus `/health` admission decision remain separate release blockers.

## Independent review checklist

- Compare every changed path with the approved allowlist and accepted protected snapshots.
- Inspect transaction-completion, atomic abort, CAS and corruption handling; inspect erased-journal refusal.
- Test dispatch/response-loss/reload windows in a real browser as well as fake-indexeddb; do not call a reload test proof of hardware crash durability.
- Verify stable immutable keys, historical rejection/application, conflict and fenced absence, no GET-based settlement and no automatic mutation retry.
- Verify actor isolation, late responses, memory-only tokens, lifecycle uncertainty, all-allocation attestation and stale progress fencing.
- Verify Web Locks, nonsecret notifications, no input queue, scanner bursts, roles, locales, themes and keyboard/mobile behavior.
- Recheck production import boundary, local-only fixtures, dependencies, focused/full process exit codes and remaining test failures independently.
- Keep NON-RELEASE-READY status; do not infer permission to activate from focused or browser passes.
