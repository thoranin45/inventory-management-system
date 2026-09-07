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
