# Inventory Management System V3
## Database Design - Phase V3.1 Foundation

---

# 1. categories

Purpose:
เก็บหมวดหมู่สินค้า และรองรับหมวดหมู่ย่อย

Grain:
1 row = 1 Category

Primary Key:
id

Foreign Keys:
parent_id -> categories.id

Columns:

id
BIGINT
PK
NOT NULL

category_code
VARCHAR(50)
UNIQUE
NULL

category_name
VARCHAR(255)
UNIQUE
NOT NULL

parent_id
BIGINT
FK -> categories.id
NULL

is_active
BOOLEAN
NOT NULL
DEFAULT TRUE

created_at
TIMESTAMP
NOT NULL

updated_at
TIMESTAMP
NOT NULL

Indexes:

UNIQUE(category_code)
UNIQUE(category_name)
INDEX(parent_id)
INDEX(is_active)

Relationships:

Category 1:N Product

Category 1:N Category
(parent-child hierarchy)

Analytics:

Sales by Category
Stock Value by Category
Profit by Category
Product Count by Category

---

# 2. brands

Purpose:
เก็บ Brand ของสินค้า

Grain:
1 row = 1 Brand

Primary Key:
id

Foreign Keys:
None

Columns:

id
BIGINT
PK
NOT NULL

brand_code
VARCHAR(50)
UNIQUE
NULL

brand_name
VARCHAR(255)
UNIQUE
NOT NULL

is_active
BOOLEAN
NOT NULL
DEFAULT TRUE

created_at
TIMESTAMP
NOT NULL

updated_at
TIMESTAMP
NOT NULL

Indexes:

UNIQUE(brand_code)
UNIQUE(brand_name)
INDEX(is_active)

Relationships:

Brand 1:N Product

Analytics:

Sales by Brand
Profit by Brand
Stock Value by Brand
Product Count by Brand

---

# 3. units

Purpose:
เก็บหน่วยสินค้า เช่น kg, g, pcs, box, bag, liter

Grain:
1 row = 1 Unit

Primary Key:
id

Foreign Keys:
None

Columns:

id
BIGINT
PK
NOT NULL

code
VARCHAR(20)
UNIQUE
NOT NULL

name
VARCHAR(100)
NOT NULL

unit_type
VARCHAR(30)
NOT NULL

decimal_places
SMALLINT
NOT NULL
DEFAULT 3

is_active
BOOLEAN
NOT NULL
DEFAULT TRUE

created_at
TIMESTAMP
NOT NULL

updated_at
TIMESTAMP
NOT NULL

Indexes:

UNIQUE(code)
INDEX(unit_type)
INDEX(is_active)

Example Data:

KG | Kilogram | WEIGHT | 3
G | Gram | WEIGHT | 3
PCS | Piece | QUANTITY | 0
BOX | Box | PACKAGING | 0
BAG | Bag | PACKAGING | 0
L | Liter | VOLUME | 3
ML | Milliliter | VOLUME | 3

Relationships:

Unit 1:N Product

Unit 1:N ProductUnitConversion

Analytics:

Products by Unit Type
Normalized Quantity Analysis
Sales Quantity by Unit
Stock Quantity by Unit

---

# 4. products

Purpose:
เก็บ Product Master

Grain:
1 row = 1 Product

Primary Key:
id

Foreign Keys:

category_id -> categories.id
brand_id -> brands.id
base_unit_id -> units.id

Columns:

id
BIGINT
PK
NOT NULL

sku
VARCHAR(50)
UNIQUE
NOT NULL

barcode
VARCHAR(100)
UNIQUE
NULL

product_name
VARCHAR(255)
NOT NULL

product_type
VARCHAR(30)
NOT NULL

category_id
BIGINT
FK -> categories.id
NULL

brand_id
BIGINT
FK -> brands.id
NULL

base_unit_id
BIGINT
FK -> units.id
NULL

selling_price
NUMERIC(18,2)
NOT NULL
DEFAULT 0

standard_cost
NUMERIC(18,4)
NOT NULL
DEFAULT 0

stock_qty
NUMERIC(18,3)
NOT NULL
DEFAULT 0

minimum_stock
NUMERIC(18,3)
NOT NULL
DEFAULT 0

maximum_stock
NUMERIC(18,3)
NULL

safety_stock
NUMERIC(18,3)
NOT NULL
DEFAULT 0

shelf_life_days
INTEGER
NULL

track_batch
BOOLEAN
NOT NULL
DEFAULT FALSE

track_expiry
BOOLEAN
NOT NULL
DEFAULT FALSE

track_weight
BOOLEAN
NOT NULL
DEFAULT FALSE

image_url
VARCHAR(500)
NULL

is_active
BOOLEAN
NOT NULL
DEFAULT TRUE

created_at
TIMESTAMP
NOT NULL

updated_at
TIMESTAMP
NOT NULL

Indexes:

UNIQUE(sku)
UNIQUE(barcode)
INDEX(category_id)
INDEX(brand_id)
INDEX(base_unit_id)
INDEX(product_type)
INDEX(is_active)

Product Types:

RAW_MATERIAL
FINISHED_GOOD
PACKAGING
MERCHANDISE
SERVICE

Relationships:

Category 1:N Product
Brand 1:N Product
Unit 1:N Product
Product 1:N ProductBatch
Product 1:N StockTransaction
Product 1:N ProductUnitConversion

Analytics:

Revenue by Product
Profit by Product
Stock Value
Slow Moving Product
Fast Moving Product
Margin %
Sales Quantity
Purchase Quantity
Production Consumption

Important:

stock_qty remains temporarily during V3 transition.

Later V3.2:
stock_balances becomes the primary stock source.

---

# 5. product_unit_conversions

Purpose:
เก็บ Conversion หน่วยเฉพาะสินค้า

Example:

1 BAG = 5 KG
1 BOX = 12 PCS
1 BOTTLE = 750 ML

Grain:
1 row = 1 conversion rule ของ Product

Primary Key:
id

Foreign Keys:

product_id -> products.id
from_unit_id -> units.id
to_unit_id -> units.id

Columns:

id
BIGINT
PK
NOT NULL

product_id
BIGINT
FK -> products.id
NOT NULL

from_unit_id
BIGINT
FK -> units.id
NOT NULL

to_unit_id
BIGINT
FK -> units.id
NOT NULL

conversion_factor
NUMERIC(18,6)
NOT NULL

is_active
BOOLEAN
NOT NULL
DEFAULT TRUE

created_at
TIMESTAMP
NOT NULL

updated_at
TIMESTAMP
NOT NULL

Constraints:

conversion_factor > 0

from_unit_id != to_unit_id

Unique:

UNIQUE(
    product_id,
    from_unit_id,
    to_unit_id
)

Indexes:

INDEX(product_id)
INDEX(from_unit_id)
INDEX(to_unit_id)

Relationships:

Product 1:N ProductUnitConversion
Unit 1:N ProductUnitConversion

Analytics:

Packaging Conversion
Normalized Sales Quantity
Normalized Purchase Quantity
Unit Usage Analysis

---

# 6. warehouses

Purpose:
เก็บคลังสินค้า

Grain:
1 row = 1 Warehouse

Primary Key:
id

Foreign Keys:
None

Columns:

id
BIGINT
PK
NOT NULL

warehouse_code
VARCHAR(50)
UNIQUE
NOT NULL

warehouse_name
VARCHAR(255)
NOT NULL

warehouse_type
VARCHAR(50)
NULL

address
VARCHAR(500)
NULL

is_active
BOOLEAN
NOT NULL
DEFAULT TRUE

created_at
TIMESTAMP
NOT NULL

updated_at
TIMESTAMP
NOT NULL

Indexes:

UNIQUE(warehouse_code)
INDEX(warehouse_type)
INDEX(is_active)

Warehouse Types:

MAIN
FACTORY
SHOP
COLD_STORAGE
FERMENTATION
OTHER

Relationships:

Warehouse 1:N WarehouseLocation

Later:

Warehouse 1:N StockBalance
Warehouse 1:N StockTransaction
Warehouse 1:N ProductBatch

Analytics:

Stock by Warehouse
Stock Value by Warehouse
Warehouse Utilization
Transfer Analysis

---

# 7. warehouse_locations

Purpose:
เก็บ Location ย่อยภายใน Warehouse

Example:

A-01-01
A-01-02
RACK-01
COLD-01
FERMENT-01

Grain:
1 row = 1 Location ภายใน Warehouse

Primary Key:
id

Foreign Keys:

warehouse_id -> warehouses.id

Columns:

id
BIGINT
PK
NOT NULL

warehouse_id
BIGINT
FK -> warehouses.id
NOT NULL

location_code
VARCHAR(50)
NOT NULL

location_name
VARCHAR(255)
NULL

location_type
VARCHAR(50)
NULL

is_active
BOOLEAN
NOT NULL
DEFAULT TRUE

created_at
TIMESTAMP
NOT NULL

updated_at
TIMESTAMP
NOT NULL

Unique:

UNIQUE(
    warehouse_id,
    location_code
)

Indexes:

INDEX(warehouse_id)
INDEX(location_type)
INDEX(is_active)

Relationships:

Warehouse 1:N WarehouseLocation

Later:

WarehouseLocation 1:N StockBalance
WarehouseLocation 1:N StockTransaction
WarehouseLocation 1:N ProductBatch

Analytics:

Stock by Location
Warehouse Space Usage
Picking Location Analysis
Fermentation Location Analysis

## Phase 4: sales fulfillment and barcode progress

Sales orders now follow DRAFT -> CONFIRMED -> PICKING -> PACKING ->
READY_TO_SHIP -> SHIPPED -> COMPLETED. CANCELLED is terminal. Creation no longer
reserves stock. Admin confirmation reserves the entire order atomically from
MAIN/DEFAULT, preserving the existing batch expiry/creation/ID ordering. Known
expiry dates before the server's business date (`date.today()`, matching existing
report date conventions) are excluded at confirmation and rejected at shipment;
same-day dates remain usable. Configure the server date/timezone consistently.
NULL-expiry policy and advanced FEFO remain outside this phase.

The existing sales_order_batch_allocations table now also represents non-batch
reservations (batch_id NULL). Each new allocation pins stock_balance_id and stores
Numeric(18,3) picked_quantity and packed_quantity. Item totals are derived. No new
inventory/reservation table exists. Packing/picking change progress only, without
moving physical stock or consuming reservations. Cancel releases reservations
and retains progress. Shipment consumes the entire order once, writes existing
ledger records, synchronizes aggregate compatibility fields, and records a unique
SHIP-{order-id} number plus actor/time. Completion has no inventory effect.

API additions under /api/v1/sales-orders/{id}:

- POST /confirm: Admin, DRAFT -> CONFIRMED.
- POST /start-picking: Warehouse/Admin, CONFIRMED -> PICKING.
- POST /complete-picking: Warehouse/Admin, PICKING -> PACKING.
- POST /complete-packing: Warehouse/Admin, PACKING -> READY_TO_SHIP.
- POST /scan-pick and /scan-pack: Warehouse/Admin, progress within the relevant stage.
- POST /complete: Admin, SHIPPED -> COMPLETED.

Stage completion body: `{"allocations":[{"allocation_id":123,"quantity":"1.125"}]}`.
It supplies absolute, complete quantities for every allocation. Missing/foreign
allocations, duplicates, under/over quantities and invalid states are rejected.

Scan body: `{"barcode":"existing-product-barcode","quantity":"0.001","allocation_id":123}`.
Quantity defaults to 1; allocation_id is optional when exactly one allocation
matches. ProductRepository.get_active_by_barcode remains the shared product lookup
used by stock-in-related lookup and fulfillment. No barcode master is duplicated.
A product barcode does not identify a batch: multiple matching allocations always
require allocation_id, even if only one has remaining quantity. Unknown barcodes,
wrong products, invalid sources, over-scans and packing unpicked stock are rejected.
Order locks serialize increments. Scan retries are not deduplicated: if a response
is lost, retrieve order progress before retrying. This is not an idempotency-key API.

The existing POST /ship route now requires READY_TO_SHIP and returns SHIPPED.
The existing PUT /cancel and POST /return routes remain. Returns accept SHIPPED
and COMPLETED and preserve cumulative Decimal limits. Existing batch_allocations
responses remain batch-only; additive fulfillment_allocations expose pinned
sources and progress. Report totals retain their existing all-order-value meaning,
which now includes drafts; they are not revenue recognition.

Migration e41a00000001 follows e31a00000002. Deploy with application writers paused
and coordinate the new application with the schema; old creation/shipping clients
must adopt the explicit steps. Run the read-only preflight with an explicitly
provided PHASE4_PREFLIGHT_DATABASE_URL using `python -m scripts.check_phase4_preflight`.
The utility does not load application settings or environment files. Findings
contain affected identifiers; it does not repair rows or change Alembic revisions.

The migration rechecks under table locks. Only unambiguous live CONFIRMED source
metadata is backfilled, including non-batch allocation rows. It requires complete
allocation ownership/totals and matching outstanding balance reservations. It never
changes on_hand/reserved quantities or historical ledger entries. Incompatible data
fails with identifiers and transaction rollback. Existing COMPLETED/CANCELLED
fulfillment actors, timestamps and progress remain NULL (unknown). Historical
completed returns retain the former MAIN/DEFAULT path when no pinned metadata
exists; missing balances still fail without reconstruction.

Downgrade refuses intermediate states, shipment identity or recorded fulfillment
progress/history that the old schema cannot represent. For compatible records it
removes only new metadata, including non-batch allocation rows; inventory and
ledger quantities remain unchanged. Do not bypass refusal by rewriting state or
removing history. Migration requires a live PostgreSQL connection; offline SQL
cannot perform its mandatory preflight.

Phase 4 tests reuse dedicated TEST_DATABASE_URL validation and disposable schemas
created by Alembic. No production reconciliation, picking waves, partial shipment,
transfer IN_TRANSIT workflow, frontend, or Phase 5 functionality is included.

## Phase 5: purchase confirmation and receipt replay

New POs start DRAFT. Admin confirmation transitions DRAFT -> CONFIRMED without
inventory effects. Receipts accept CONFIRMED/PARTIALLY_RECEIVED and atomically
advance cumulative received quantities to PARTIALLY_RECEIVED or RECEIVED. Admin
cancellation accepts DRAFT/CONFIRMED only when every received quantity is zero.
No close-short or receipt reversal is introduced.

POST /api/v1/purchase-orders/{id}/confirm is Admin-only. Existing creation, reads,
POST /receive and POST /cancel routes remain. Warehouse retains read/receive;
it cannot create, confirm, or cancel. Clients must confirm new orders explicitly.

Every receive call requires an Idempotency-Key header (1–128 characters: letters,
digits, dot, underscore, colon, or hyphen). Retain the same key and payload for a
network retry. A fresh physical receipt requires a new key. Keys are scoped to the
PO. Same key/same canonical payload returns the original response, including the
original PO status and receipt-time stock values; changed payload returns 409.
Failed transactions leave no committed event and can be retried. Successful replay
performs no new stock, movement, transaction, or business audit writes.

Canonical fingerprints include PO, sorted products, three-place exact quantities,
verbatim lot strings, dates, and storage. Omitted/NULL warehouse and location are
represented by a stable MAIN/DEFAULT token. Explicit IDs remain explicit and are
not treated as the same request as omitted defaults. Replay is checked before
mutable product, destination, lot and terminal-state validation. Normal permission
checks still apply; the original receipt actor is retained.

PurchaseOrderReceipt stores event identity, a unique server-generated POR number,
operation key/fingerprint, timestamp/actor and a JSONB replay snapshot. The snapshot
is not inventory authority. InventoryMovement has nullable purchase_receipt_id,
purchase_order_item_id and stock_transaction_id links. Existing movement quantities
remain the physical ledger; no receipt-line ledger is duplicated. The unique
receipt/item pair preserves one receipt line per PO product. Historical links stay
NULL and historical event identities are never fabricated.

Non-batch products receive directly into batch_id=NULL balances. Lot/date metadata
is rejected. Batch products require a lot; dates are optional without expiry
tracking, with expiry > manufacturing when both are given. Expiry-tracked products
require both dates. New independent receipts into an existing same-product lot are
still rejected; other products may share its text. No case folding, lot merging or
new current-date expiry policy is introduced. A same-key replay bypasses duplicate
lot checks because it does not receive again.

Receipts preserve reservations, capture actual balance_before and balance_after,
write existing IN_PO transactions/PURCHASE_RECEIPT movements, synchronize Product
and ProductBatch aggregates and update PO items in one UnitOfWork. PO/item locks
precede canonical product/batch/balance locks. All lines roll back together.

Receipt responses preserve received_batches for batch lines and add received_items,
receipt_id and receipt_number. Non-batch responses have an empty received_batches.
Batch-list date fields permit NULL for batches without expiry tracking. Typed Decimal output remains unchanged. Warehouse/location remain request-level;
both omitted use MAIN/DEFAULT, incomplete pairs fail, and invalid explicit storage
never falls back.

Migration e51a00000001 follows e41a00000001. Pause writers and coordinate schema and
application deployment. Valid legacy PENDING maps explicitly to CONFIRMED because
those orders were already receivable. Other legacy statuses and quantities remain.
No historical confirmation actor or receipt event is created. New event sums cover
only new receipts, not the unknown historical component of received_quantity.

Read-only preflight: set an explicit PHASE5_PREFLIGHT_DATABASE_URL and run
`python -m scripts.check_phase5_preflight`. It does not load application settings
or .env files. It checks statuses, ownership, quantity bounds/precision, duplicate
products, status/received consistency, empty POs and batches on non-batch products.
Incompatible data reports identifiers and stops; resolve it explicitly outside
this migration. The migration repeats validation under locks. It never repairs
inventory, changes tracking flags, merges batches, or invents receipt history.
A live PostgreSQL connection is required; offline SQL cannot perform preflight.

Downgrade refuses recorded receipt events or unsupported lifecycle states such as
DRAFT. With no such history, CONFIRMED maps back to PENDING and only new empty schema
and nullable links are removed. Do not delete events or rewrite state to bypass
this guard. No production migration or preflight was executed during development.

Phase 5 adds no AP/accounting, close-short, transfer IN_TRANSIT, or Phase 6 work.
Tests use dedicated TEST_DATABASE_URL and disposable Alembic-built schemas.

## Phase 6: warehouse transfer lifecycle and transit storage

### Lifecycle

A warehouse transfer now moves through an explicit state machine:
DRAFT -> IN_TRANSIT -> PARTIALLY_RECEIVED -> COMPLETED. Creation is unchanged and
still produces a DRAFT with `dispatched_quantity` and `received_quantity` set to 0
on every line. `POST /api/v1/inventory-transfers/{id}/dispatch` (Warehouse or Admin)
moves DRAFT -> IN_TRANSIT: it locks the transfer row, then the canonical
product/batch/balance locks, checks that available (`on_hand - reserved`) at each
distinct source balance covers the aggregated demand, and moves every line's full
quantity out of the source and into system transit in one UnitOfWork. Dispatch is
all-or-nothing across lines; a single short line rolls the whole dispatch back and
the transfer stays DRAFT. There is no partial dispatch.

`POST /api/v1/inventory-transfers/{id}/receive` (Warehouse or Admin) accepts
IN_TRANSIT or PARTIALLY_RECEIVED and applies one receipt of one or more lines.
Each line's cumulative `received_quantity` may not exceed its `dispatched_quantity`
(`outstanding_quantity = dispatched_quantity - received_quantity`). When every line
reaches its dispatched quantity the transfer becomes COMPLETED and
`completed_at`/`completed_by_user_id` are stamped; otherwise it is
PARTIALLY_RECEIVED. Receipts are atomic across their lines: an invalid or
over-outstanding line leaves every line's goods in transit and the transfer state
unchanged. Repeated partial receipts are the supported way to close a transfer in
stages.

Cancellation stays DRAFT-only and additionally refuses if any line already carries
dispatch or receipt progress. An IN_TRANSIT or PARTIALLY_RECEIVED transfer cannot
be cancelled; its goods must be received. No reverse logistics, in-transit
shrinkage, or return-to-source path is introduced.

### Transit storage

Migration e61a00000001 seeds one system warehouse and location, both
`warehouse_code`/`location_code` `__TRANSIT__` and `warehouse_type`/`location_type`
`TRANSIT`, active. `StockBalanceRepository.get_transit_storage()` resolves exactly
that pair. Transit holds goods that have left a source but not yet reached a
destination. Dispatch writes paired `TRANSFER_OUT` (source, negative) and
`TRANSFER_TRANSIT_IN` (transit, positive) movements; each receipt writes paired
`TRANSFER_TRANSIT_OUT` (transit, negative) and `TRANSFER_IN` (destination,
positive) movements. The signed legs of any transfer item always sum to zero.
`InventoryTransferItem.source_stock_balance_id` and `transit_stock_balance_id` pin
the balances chosen at dispatch; receipt re-validates that identity and refuses if
it drifted. `dispatched_quantity IN (0, quantity)` and
`0 <= received_quantity <= dispatched_quantity <= quantity` are enforced by
`ck_transfer_item_progress`.

Transit is never operationally selectable. `require_operational_storage` rejects a
transit warehouse or location (HTTP 409) from Stock In, Stock Out (FIFO/FEFO),
Inventory Adjustment, raw StockBalance creation, purchase-order receiving, sales
allocation sourcing, and both transfer endpoints (source and destination).
`StockBalanceRepository` list and per-product queries exclude transit rows, so
normal stock views and availability never show in-transit goods. The authoritative
`Product.stock_qty` and `ProductBatch.quantity` aggregates still sum every balance
including transit, so a global reconciliation stays balanced while goods are in
flight. A transfer's own transit balance is one shared row per product/batch;
concurrent dispatches create it exactly once and one transfer never draws down
another transfer's outstanding transit quantity, because receipt is bounded by that
line's own `outstanding_quantity`, not by the shared balance's `on_hand`.

### Receipt events and Idempotency-Key

Every receive call requires an `Idempotency-Key` header (1-128 characters:
letters, digits, dot, underscore, colon, hyphen). `InventoryTransferReceipt` stores
event identity: a unique server-generated `TRR-` receipt number, the operation key,
a SHA-256 canonical request fingerprint (version tag, transfer id, and the lines
sorted by item id with three-place exact quantities), timestamp, actor, and a JSONB
response snapshot. Keys are unique per `(transfer_id, operation_key)`. Same
key/same canonical payload replays the stored snapshot and performs no new
movement, balance, aggregate, or audit write - including after the transfer has
reached COMPLETED. Same key/different payload returns 409. The replay check runs
before state and outstanding-quantity validation. Failed receipts commit no event
and can be retried. `InventoryMovement` gains nullable `transfer_item_id` and
`transfer_receipt_id` links; dispatch legs carry only `transfer_item_id`, receipt
legs carry both. No receipt-line ledger duplicates the movement rows.

Business audit rows (`AuditLog`, `table_name='inventory_transfers'`) record
CREATE_TRANSFER, DISPATCH_TRANSFER, RECEIVE_TRANSFER, and CANCEL_TRANSFER;
`sync_aggregates` continues to log any derived-total change under
DERIVE_INVENTORY_TOTAL without reconciling balances.

### Legacy /complete deprecation

`POST /api/v1/inventory-transfers/{id}/complete` (the pre-Phase-6 immediate
one-shot completion) is retired. The route stays authenticated and unchanged in
shape: an unknown transfer id still returns 404, and an existing transfer returns
409 with a message directing the caller to dispatch then receive. It never
performs a transfer and is never silently reinterpreted. Historical transfers that
were completed through the old path are marked `legacy_completed = true`, keep
NULL line progress, keep their original two-leg `TRANSFER_OUT`/`TRANSFER_IN`
movement history with NULL transfer links, and are read-only: dispatch and receive
refuse a `legacy_completed` transfer. This keeps legacy immediate-transfer history
distinguishable from lifecycle transfers in both the schema and the read-only
diagnostic.

### Diagnostic

`scripts/check_inventory_consistency.py` (read-only, explicit
`INVENTORY_DIAGNOSTIC_DATABASE_URL`, never loads settings) adds transfer checks:
`transfer_movement_pair_conservation` (an item's signed transfer legs net to
zero), `transfer_receipt_movement_totals` (`TRANSFER_IN` and `TRANSFER_TRANSIT_OUT`
totals equal recorded `received_quantity`), `transit_outstanding_reconciliation`
(each transit balance `on_hand` equals the summed `dispatched - received` of the
lines pinned to it), and `legacy_transfer_history_distinct` (legacy transfers show
no lifecycle progress or links; lifecycle transfers do). It classifies only and
reconciles nothing.

### Migration and downgrade limitations

Migration e61a00000001 follows e51a00000001. Pause writers and coordinate schema
and application deployment. It runs under `ACCESS EXCLUSIVE` locks and calls the
read-only Phase 6 preflight (`scripts.check_phase6_preflight`, also runnable as a
standalone check with an explicit `PHASE6_PREFLIGHT_DATABASE_URL`; PostgreSQL
required, offline SQL cannot perform it). The preflight refuses and stops the
migration, reporting identifiers, on: unknown transfer status, item ownership
gaps, empty transfers, same-warehouse or same-location lines, non-positive or
over-precise quantities, duplicate lines, storage/warehouse identity mismatch,
batch/tracking identity mismatch, any transfer movement history on a
non-COMPLETED transfer, a COMPLETED transfer whose movement legs do not
reconstruct exactly (including ambiguous duplicate legs), orphan transfer
movements, movement arithmetic errors, and any pre-existing `__TRANSIT__` or
`TRANSIT`-typed warehouse/location. Existing COMPLETED transfers are marked
`legacy_completed`; DRAFT/CANCELLED line progress is normalised to zero; the
ledger, products, and stock transactions are untouched.

Downgrade is intentionally narrow. It refuses once any lifecycle history exists:
a non-legacy state, a set `dispatched_at`, non-zero line progress, any
`InventoryTransferReceipt`, any transfer-linked movement, or any surviving transit
`StockBalance`. With none of that, it removes the `__TRANSIT__` warehouse/location,
the receipt table, the new columns and the check constraint, and restores the
pre-Phase-6 shape. Do not delete events or rewrite state to bypass the guard. No
production migration or preflight was executed during development.

Phase 6 adds no partial dispatch, no reverse logistics or in-transit adjustment,
no production reconciliation, and no Phase 7 work. Tests use the dedicated
TEST_DATABASE_URL, disposable Alembic-built schemas, and the isolated PostgreSQL
concurrency harness.

## Phase 7: expiry, batch eligibility and FEFO

Phase 7 gives the system one consistent definition of whether a batch is usable,
near expiry, expired, or ineligible for a specific operation. It changes no
inventory-ownership semantics and requires **no Alembic migration**: everything is
date arithmetic on the existing `product_batches.expiry_date` plus service and
repository filters. `Product.stock_qty` and `ProductBatch.quantity` remain the
total owned physical inventory, including expired and in-transit stock.

### Business date

`app/core/batch_eligibility.py` owns the single rule. `business_today()` returns
the current date in `settings.timezone` (default `Asia/Bangkok`,
environment-overridable) so expiry decisions never depend on the UTC deployment
clock. The rule, applied everywhere:

- `expiry_date < business_today()` -> expired / operationally ineligible
- `expiry_date == business_today()` -> usable (same-day)
- `expiry_date > business_today()` -> usable
- `expiry_date IS NULL` -> usable (never expires)

Pure helpers: `days_to_expiry`, `is_expired`, `is_batch_eligible`,
`is_near_expiry`. Nothing is persisted; no derived-status column exists. Every
service routes through these (directly or via `is_expired`/`is_batch_eligible`),
so a test can pin the business date by patching `business_today`.

### Near expiry

`is_near_expiry` = not expired and `days_to_expiry <= settings.near_expiry_days`
(default 90, environment-overridable). Derived only; no notification UI. The
dashboard `expiring-soon` window and the `reports/expiring` and
`dashboard/expired` date calculations now use `business_today()` and, for the
soon-window, `settings.near_expiry_days` (default preserves the previous 90).

### FEFO / FIFO stock out

FEFO (`stock/out-fefo`) selects First Expired First Out **among eligible lots
only**. Ordering is `expiry_date ASC NULLS LAST, created_at ASC, id ASC`: dated
lots first (earliest expiry), NULL-expiry lots last, deterministic ties. Expired
lots are never selected even though they would sort first. `available =
on_hand - reserved` is still enforced per lot; transit balances are still
excluded (operational location scope). The sufficiency check uses
`get_eligible_batch_stock_total`, so when only expired stock remains the call
fails with a clear `InsufficientBatchStock` (409) **before any mutation,
transaction or movement**.

FIFO (`stock/out-fifo`) must not be an expiry bypass: it applies the same
eligibility filter (`expiry_date IS NULL OR expiry_date >= business_today()`).
NULL-expiry / non-expiry-tracked lots keep their existing FIFO behavior; a dated
expired lot is skipped by both FIFO and FEFO. FIFO/FEFO is unchanged for products
with no dated lots.

### Sales

Confirmation excludes expired batches from allocation candidates (deterministic
FEFO order, NULL-expiry eligible, `expiry == business_today()` eligible). If only
expired stock exists confirmation fails 409 and the order stays DRAFT with no
reservation. Picking and Packing remain progress-only: a batch that expires
mid-fulfilment does not block them. Shipment routes through the shared
eligibility helper: an expired allocated batch fails 409 atomically -
status, reservation, on-hand, and the allocation itself are unchanged and no
other batch is silently chosen. Operational recovery: cancel the order (releases
the reservation) and recreate/reconfirm. Cancellation after expiry still releases
the reservation normally. No in-place reallocation workflow is added.

### PO receiving

Phase 5 receiving and idempotency are unchanged. Tracking contracts are
unchanged: `track_batch=False` rejects lot/date metadata; `track_batch=True,
track_expiry=False` needs a lot, dates optional; `track_batch=True,
track_expiry=True` needs lot + manufacturing + expiry. When both dates are given,
`expiry_date` must be strictly later than `mfg_date` (400, unchanged). Receiving
already-expired goods is **allowed** - the system must record physical inventory
that arrived - and same-day expiry is allowed. The resulting stock is owned
(counted in `Product.stock_qty`) but immediately operationally ineligible: no
Sales confirmation, FEFO or expiry-relevant FIFO will select it, and it is not
quarantined.

### Returns

A Sales return of an expired batch is accepted and the physical quantity is
restored to its authoritative `StockBalance` exactly as before. After restore the
batch stays owned but operationally ineligible: Sales confirmation, FEFO and
expiry-relevant FIFO exclude it. No quarantine tables or locations; visible
segregation is deferred to Phase 8+.

### Transfers

Phase 6 `source -> TRANSIT -> destination` is unchanged. At dispatch,
`_validate_transfer_item` rejects an already-expired batch with 409 ("Cannot
dispatch expired batch"), so an ordinary transfer cannot bypass expiry
protection; same-day expiry is allowed. If a batch expires **after** dispatch
while IN_TRANSIT it is never removed, reversed, or substituted: the destination
receipt still succeeds and the destination receives the exact same ProductBatch
id, lot, manufacturing metadata and expiry date. That quantity stays part of
total owned inventory and is excluded from operational eligibility. Goods are
never stranded in transit because of expiry.

### Operational availability

`StockBalanceRepository.operational_available_quantity(product_id, today)` and
`operational_available_by_product(today)` derive - never persist - the
operationally usable quantity: `SUM(on_hand - reserved)` over balances whose
warehouse is operational (not TRANSIT) and whose batch is NULL, has NULL expiry,
or has not expired. `Product.stock_qty` keeps its Phase 2 meaning (total owned,
including expired and transit).

### Diagnostics

The read-only `scripts/check_inventory_consistency.py` gains four classifying
checks (no reconciliation, no writes): `expired_owned_quantity` and
`operationally_eligible_quantity` per product, `owned_partition_reconciliation`
(owned total == in-transit + operational-expired + operational-eligible on-hand),
and `owned_aggregate_matches_balances`. The diagnostic stays configuration-free:
its business date comes from `SELECT (now() AT TIME ZONE :tz)::date` with `tz`
from `INVENTORY_DIAGNOSTIC_TIMEZONE` (default `Asia/Bangkok`), or an injected
`today` for tests.

### Not in Phase 7

No persisted expired/near-expiry status, no quarantine architecture, no reverse
logistics, no in-place Sales reallocation, no auto-reconciliation, no Phase 8
dashboard/report redesign, no schema change. Concurrency tests use the existing
isolated PostgreSQL harness with injected business dates; the system clock is
never manipulated.
