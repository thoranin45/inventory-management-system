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