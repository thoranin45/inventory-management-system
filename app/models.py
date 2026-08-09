from sqlalchemy.orm import declarative_base, relationship
from sqlalchemy import (
    Column,
    Integer,
    String,
    Numeric,
    DateTime,
    Date,
    DateTime,
    Boolean,
    ForeignKey,
    SmallInteger,
    CheckConstraint,
    UniqueConstraint,
    Index,
    text,
)
from sqlalchemy.sql import func

Base = declarative_base()


class Product(Base):
    __tablename__ = "products"

    __table_args__ = (
        CheckConstraint(
            "stock_qty >= 0",
            name="ck_products_stock_qty_non_negative",
        ),

        Index(
            "ix_products_category_id",
            "category_id",
        ),
        Index(
            "ix_products_brand_id",
            "brand_id",
        ),
        Index(
            "ix_products_base_unit_id",
            "base_unit_id",
        ),
        Index(
            "ix_products_product_type",
            "product_type",
        ),
        Index(
            "ix_products_is_active",
            "is_active",
        ),
    )

    id = Column(Integer, primary_key=True)

    sku = Column(String(50), unique=True)

    barcode = Column(String(100), unique=True)

    product_name = Column(String(255))

    price = Column(Numeric(10, 2))

    stock_qty = Column(
         Numeric(18, 3),
        nullable=False,
        default=0,
    )

    image_url = Column(String(500))

    is_active = Column(Boolean, default=True)

    category_id = Column(
        Integer,
        ForeignKey("categories.id")
    )

    created_at = Column(
        DateTime,
        server_default=func.now()
    )

    product_type = Column(
        String(30),
        nullable=False,
        default="MERCHANDISE",
    )

    brand_id = Column(
        Integer,
        ForeignKey("brands.id"),
        nullable=True,
    )

    base_unit_id = Column(
        Integer,
        ForeignKey("units.id"),
        nullable=True,
    )

    standard_cost = Column(
        Numeric(18, 4),
        nullable=False,
        default=0,
    )

    minimum_stock = Column(
        Numeric(18, 3),
        nullable=False,
        default=0,
    )

    maximum_stock = Column(
        Numeric(18, 3),
        nullable=True,
    )

    safety_stock = Column(
        Numeric(18, 3),
        nullable=False,
        default=0,
    )

    shelf_life_days = Column(
        Integer,
        nullable=True,
    )

    track_batch = Column(
        Boolean,
        nullable=False,
        default=False,
    )

    track_expiry = Column(
        Boolean,
        nullable=False,
        default=False,
    )

    track_weight = Column(
        Boolean,
        nullable=False,
        default=False,
    )

    updated_at = Column(
        DateTime,
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    transactions = relationship(
        "StockTransaction",
        back_populates="product"
    )

    batches = relationship(
        "ProductBatch",
        back_populates="product"
    )

    category = relationship(
        "Category",
        back_populates="products"
    )

    brand = relationship(
        "Brand",
        back_populates="products",
    )

    base_unit = relationship(
        "Unit",
        back_populates="products",
    )

    unit_conversions = relationship(
        "ProductUnitConversion",
        back_populates="product",
    )

    

class Category(Base):
    __tablename__ = "categories"

    id = Column(Integer, primary_key=True)

    category_name = Column(
        String(255),
        unique=True
    )

    created_at = Column(
        DateTime,
        server_default=func.now()
    )

    products = relationship(
        "Product",
        back_populates="category"
    )

class Brand(Base):
    __tablename__ = "brands"

    __table_args__ = (
        Index(
            "ix_brands_is_active",
            "is_active",
        ),
    )

    id = Column(
        Integer,
        primary_key=True,
    )

    brand_code = Column(
        String(50),
        unique=True,
        nullable=True,
    )

    brand_name = Column(
        String(255),
        unique=True,
        nullable=False,
    )

    is_active = Column(
        Boolean,
        nullable=False,
        default=True,
    )

    created_at = Column(
        DateTime,
        nullable=False,
        server_default=func.now(),
    )

    updated_at = Column(
        DateTime,
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    products = relationship(
        "Product",
        back_populates="brand",
    )


class Unit(Base):
    __tablename__ = "units"

    __table_args__ = (
        Index(
            "ix_units_unit_type",
            "unit_type",
        ),
        Index(
            "ix_units_is_active",
            "is_active",
        ),
    )

    id = Column(
        Integer,
        primary_key=True,
    )

    code = Column(
        String(20),
        unique=True,
        nullable=False,
    )

    name = Column(
        String(100),
        nullable=False,
    )

    unit_type = Column(
        String(30),
        nullable=False,
    )

    decimal_places = Column(
        SmallInteger,
        nullable=False,
        default=3,
    )

    is_active = Column(
        Boolean,
        nullable=False,
        default=True,
    )

    created_at = Column(
        DateTime,
        nullable=False,
        server_default=func.now(),
    )

    updated_at = Column(
        DateTime,
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    products = relationship(
        "Product",
        back_populates="base_unit",
    )

    conversions_from = relationship(
        "ProductUnitConversion",
        foreign_keys="ProductUnitConversion.from_unit_id",
        back_populates="from_unit",
    )

    conversions_to = relationship(
        "ProductUnitConversion",
        foreign_keys="ProductUnitConversion.to_unit_id",
        back_populates="to_unit",
    )


class Warehouse(Base):
    __tablename__ = "warehouses"

    __table_args__ = (
        Index(
            "ix_warehouses_warehouse_type",
            "warehouse_type",
        ),
        Index(
            "ix_warehouses_is_active",
            "is_active",
        ),
    )

    id = Column(
        Integer,
        primary_key=True,
    )

    warehouse_code = Column(
        String(50),
        unique=True,
        nullable=False,
    )

    warehouse_name = Column(
        String(255),
        nullable=False,
    )

    warehouse_type = Column(
        String(50),
        nullable=True,
    )

    address = Column(
        String(500),
        nullable=True,
    )

    is_active = Column(
        Boolean,
        nullable=False,
        default=True,
    )

    created_at = Column(
        DateTime,
        nullable=False,
        server_default=func.now(),
    )

    updated_at = Column(
        DateTime,
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    locations = relationship(
        "WarehouseLocation",
        back_populates="warehouse",
    )


class WarehouseLocation(Base):
    __tablename__ = "warehouse_locations"

    __table_args__ = (
        UniqueConstraint(
            "warehouse_id",
            "location_code",
            name="uq_warehouse_location_code",
        ),
        Index(
            "ix_warehouse_locations_warehouse_id",
            "warehouse_id",
        ),
        Index(
            "ix_warehouse_locations_location_type",
            "location_type",
        ),
        Index(
            "ix_warehouse_locations_is_active",
            "is_active",
        ),
    )

    id = Column(
        Integer,
        primary_key=True,
    )

    warehouse_id = Column(
        Integer,
        ForeignKey("warehouses.id"),
        nullable=False,
    )

    location_code = Column(
        String(50),
        nullable=False,
    )

    location_name = Column(
        String(255),
        nullable=True,
    )

    location_type = Column(
        String(50),
        nullable=True,
    )

    is_active = Column(
        Boolean,
        nullable=False,
        default=True,
    )

    created_at = Column(
        DateTime,
        nullable=False,
        server_default=func.now(),
    )

    updated_at = Column(
        DateTime,
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    warehouse = relationship(
        "Warehouse",
        back_populates="locations",
    )

class StockTransaction(Base):
    __tablename__ = "stock_transactions"

    id = Column(Integer, primary_key=True)

    product_id = Column(
        Integer,
        ForeignKey("products.id")
    )

    transaction_type = Column(String(20))

    quantity = Column(
        Numeric(18, 3),
        nullable=False,
    )

    remark = Column(String(255))

    created_at = Column(
        DateTime,
        server_default=func.now()
    )

    product = relationship(
        "Product",
        back_populates="transactions"
    )


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)

    username = Column(String(100), unique=True)

    password_hash = Column(String(255))

    role = Column(String(50))


class ProductBatch(Base):
    __tablename__ = "product_batches"

    __table_args__ = (
        CheckConstraint(
            "quantity >= 0",
            name="ck_product_batches_quantity_non_negative",
        ),
    )

    id = Column(
        Integer,
        primary_key=True,
    )

    product_id = Column(
        Integer,
        ForeignKey("products.id"),
        nullable=False,
    )

    lot_no = Column(
        String(100),
        unique=True,
    )

    mfg_date = Column(Date)

    expiry_date = Column(Date)

    quantity = Column(
        Numeric(18, 3),
        nullable=False,
    )

    created_at = Column(
        DateTime,
        server_default=func.now(),
    )

    product = relationship(
        "Product",
        back_populates="batches",
    )


class Supplier(Base):
    __tablename__ = "suppliers"

    id = Column(Integer, primary_key=True)

    supplier_name = Column(String(255))

    contact_name = Column(String(255))

    phone = Column(String(50))

    email = Column(String(255))

    address = Column(String(500))

    created_at = Column(
        DateTime,
        server_default=func.now()
    )


class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"

    id = Column(Integer, primary_key=True)

    po_number = Column(String(100), unique=True)

    supplier_id = Column(
        Integer,
        ForeignKey("suppliers.id")
    )

    status = Column(String(50))

    created_at = Column(
        DateTime,
        server_default=func.now()
    )


class PurchaseOrderItem(Base):
    __tablename__ = "purchase_order_items"

    __table_args__ = (
        CheckConstraint(
            "quantity > 0",
            name="ck_purchase_order_items_quantity_positive",
        ),
        CheckConstraint(
            "received_quantity >= 0",
            name=(
                "ck_purchase_order_items_"
                "received_quantity_non_negative"
            ),
        ),
        CheckConstraint(
            "received_quantity <= quantity",
            name=(
                "ck_purchase_order_items_"
                "received_quantity_lte_quantity"
            ),
        ),
    )

    id = Column(
        Integer,
        primary_key=True,
    )

    po_id = Column(
        Integer,
        ForeignKey("purchase_orders.id"),
        nullable=False,
    )

    product_id = Column(
        Integer,
        ForeignKey("products.id"),
        nullable=False,
    )

    quantity = Column(
        Numeric(18, 3),
        nullable=False,
    )

    received_quantity = Column(
        Numeric(18, 3),
        nullable=False,
        server_default="0",
    )

    unit_price = Column(
        Numeric(10, 2),
        nullable=False,
    )

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True)

    username = Column(String(100))

    action = Column(String(100))

    table_name = Column(String(100))

    record_id = Column(Integer)

    description = Column(String(500))

    created_at = Column(
        DateTime,
        server_default=func.now()
    )

class Customer(Base):
    __tablename__ = "customers"

    id = Column(Integer, primary_key=True)
    customer_name = Column(String(255))
    phone = Column(String(50))
    email = Column(String(255))
    address = Column(String(500))
    created_at = Column(DateTime, server_default=func.now())

class SalesOrder(Base):
    __tablename__ = "sales_orders"

    id = Column(Integer, primary_key=True)
    so_number = Column(String(100), unique=True)

    customer_id = Column(
        Integer,
        ForeignKey("customers.id")
    )

    status = Column(String(50))
    total_amount = Column(Numeric(10, 2))
    created_at = Column(DateTime, server_default=func.now())


class SalesOrderItem(Base):
    __tablename__ = "sales_order_items"

    __table_args__ = (
        CheckConstraint(
            "quantity > 0",
            name="ck_sales_order_items_quantity_positive",
        ),
    )

    id = Column(Integer, primary_key=True)

    sales_order_id = Column(
        Integer,
        ForeignKey("sales_orders.id")
    )

    product_id = Column(
        Integer,
        ForeignKey("products.id")
    )

    quantity = Column(
    Numeric(18, 3),
    nullable=False,
    )
    unit_price = Column(Numeric(10, 2))
    total_price = Column(Numeric(10, 2))

class SalesOrderBatchAllocation(Base):
    __tablename__ = "sales_order_batch_allocations"

    __table_args__ = (
        CheckConstraint(
            "quantity > 0",
            name=(
                "ck_sales_order_batch_allocations_"
                "quantity_positive"
            ),
        ),
    )

    id = Column(Integer, primary_key=True)

    sales_order_id = Column(
        Integer,
        ForeignKey("sales_orders.id")
    )

    sales_order_item_id = Column(
        Integer,
        ForeignKey("sales_order_items.id")
    )

    product_id = Column(
        Integer,
        ForeignKey("products.id")
    )

    batch_id = Column(
        Integer,
        ForeignKey("product_batches.id")
    )

    quantity = Column(
    Numeric(18, 3),
    nullable=False,
    )

    created_at = Column(
        DateTime,
        server_default=func.now()
    )

class ProductUnitConversion(Base):
    __tablename__ = "product_unit_conversions"

    __table_args__ = (
        UniqueConstraint(
            "product_id",
            "from_unit_id",
            "to_unit_id",
            name="uq_product_unit_conversion",
        ),
        CheckConstraint(
            "conversion_factor > 0",
            name="ck_conversion_factor_positive",
        ),
        CheckConstraint(
            "from_unit_id <> to_unit_id",
            name="ck_conversion_units_different",
        ),
        Index(
            "ix_product_unit_conversions_product_id",
            "product_id",
        ),
        Index(
            "ix_product_unit_conversions_from_unit_id",
            "from_unit_id",
        ),
        Index(
            "ix_product_unit_conversions_to_unit_id",
            "to_unit_id",
        ),
    )

    id = Column(
        Integer,
        primary_key=True,
    )

    product_id = Column(
        Integer,
        ForeignKey("products.id"),
        nullable=False,
    )

    from_unit_id = Column(
        Integer,
        ForeignKey("units.id"),
        nullable=False,
    )

    to_unit_id = Column(
        Integer,
        ForeignKey("units.id"),
        nullable=False,
    )

    conversion_factor = Column(
        Numeric(18, 6),
        nullable=False,
    )

    is_active = Column(
        Boolean,
        nullable=False,
        default=True,
    )

    created_at = Column(
        DateTime,
        nullable=False,
        server_default=func.now(),
    )

    updated_at = Column(
        DateTime,
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    product = relationship(
        "Product",
        back_populates="unit_conversions",
    )

    from_unit = relationship(
        "Unit",
        foreign_keys=[from_unit_id],
        back_populates="conversions_from",
    )

    to_unit = relationship(
        "Unit",
        foreign_keys=[to_unit_id],
        back_populates="conversions_to",
    )

class StockBalance(Base):
    __tablename__ = "stock_balances"

    id = Column(
        Integer,
        primary_key=True,
    )

    product_id = Column(
        Integer,
        ForeignKey(
            "products.id",
            name="fk_stock_balances_product_id",
        ),
        nullable=False,
    )

    warehouse_id = Column(
        Integer,
        ForeignKey(
            "warehouses.id",
            name="fk_stock_balances_warehouse_id",
        ),
        nullable=False,
    )

    location_id = Column(
        Integer,
        ForeignKey(
            "warehouse_locations.id",
            name="fk_stock_balances_location_id",
        ),
        nullable=False,
    )  

    batch_id = Column(
        Integer,
        ForeignKey(
            "product_batches.id",
            name="fk_stock_balances_batch_id",
        ),
        nullable=True,
    )

    on_hand_qty = Column(
        Numeric(18, 3),
        nullable=False,
        default=0,
        server_default="0",
    )

    reserved_qty = Column(
        Numeric(18, 3),
        nullable=False,
        default=0,
        server_default="0",
    )

    created_at = Column(
        DateTime,
        nullable=False,
        server_default=func.now(),
    )

    updated_at = Column(
        DateTime,
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    product = relationship(
        "Product",
    )

    warehouse = relationship(
        "Warehouse",
    )

    location = relationship(
        "WarehouseLocation",
    )

    batch = relationship(
        "ProductBatch",
    )

    __table_args__ = (
        CheckConstraint(
            "on_hand_qty >= 0",
            name="ck_stock_balances_on_hand_non_negative",
        ),
        CheckConstraint(
            "reserved_qty >= 0",
            name="ck_stock_balances_reserved_non_negative",
        ),
        CheckConstraint(
            "reserved_qty <= on_hand_qty",
            name="ck_stock_balances_reserved_lte_on_hand",
        ),

        # สินค้าที่ไม่ได้ track batch:
        # 1 Product + Warehouse + Location
        # มี balance ได้เพียง record เดียว
        Index(
            "uq_stock_balances_no_batch",
            "product_id",
            "warehouse_id",
            "location_id",
            unique=True,
            postgresql_where=text(
                "batch_id IS NULL"
            ),
        ),

        # สินค้าที่ track batch:
        # แยก balance ต่อ Lot/Batch
        Index(
            "uq_stock_balances_with_batch",
            "product_id",
            "warehouse_id",
            "location_id",
            "batch_id",
            unique=True,
            postgresql_where=text(
                "batch_id IS NOT NULL"
            ),
        ),

        Index(
            "ix_stock_balances_product_id",
            "product_id",
        ),
        Index(
            "ix_stock_balances_warehouse_id",
            "warehouse_id",
        ),
        Index(
            "ix_stock_balances_location_id",
            "location_id",
        ),
        Index(
            "ix_stock_balances_batch_id",
            "batch_id",
        ),
    )

    @property
    def available_qty(self):
        return (
            self.on_hand_qty
            - self.reserved_qty
        )

class InventoryTransfer(Base):
    __tablename__ = "inventory_transfers"

    id = Column(
        Integer,
        primary_key=True,
    )

    transfer_number = Column(
        String(50),
        nullable=False,
        unique=True,
    )

    status = Column(
        String(30),
        nullable=False,
        default="DRAFT",
        server_default="DRAFT",
    )

    source_warehouse_id = Column(
        Integer,
        ForeignKey("warehouses.id"),
        nullable=False,
    )

    destination_warehouse_id = Column(
        Integer,
        ForeignKey("warehouses.id"),
        nullable=False,
    )

    requested_by_user_id = Column(
        Integer,
        ForeignKey("users.id"),
        nullable=True,
    )

    completed_by_user_id = Column(
        Integer,
        ForeignKey("users.id"),
        nullable=True,
    )

    remark = Column(
        String(500),
        nullable=True,
    )

    created_at = Column(
        DateTime,
        nullable=False,
        server_default=func.now(),
    )

    completed_at = Column(
        DateTime,
        nullable=True,
    )

    updated_at = Column(
        DateTime,
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    items = relationship(
        "InventoryTransferItem",
        back_populates="transfer",
        cascade="all, delete-orphan",
    )

    source_warehouse = relationship(
        "Warehouse",
        foreign_keys=[source_warehouse_id],
    )

    destination_warehouse = relationship(
        "Warehouse",
        foreign_keys=[destination_warehouse_id],
    )

    requested_by = relationship(
        "User",
        foreign_keys=[requested_by_user_id],
    )

    completed_by = relationship(
        "User",
        foreign_keys=[completed_by_user_id],
    )

    __table_args__ = (
        CheckConstraint(
            "source_warehouse_id <> destination_warehouse_id",
            name=(
                "ck_inventory_transfers_"
                "different_warehouses"
            ),
        ),
        Index(
            "ix_inventory_transfers_status",
            "status",
        ),
        Index(
            "ix_inventory_transfers_source_warehouse",
            "source_warehouse_id",
        ),
        Index(
            "ix_inventory_transfers_destination_warehouse",
            "destination_warehouse_id",
        ),
        Index(
            "ix_inventory_transfers_created_at",
            "created_at",
        ),
    )


class InventoryTransferItem(Base):
    __tablename__ = "inventory_transfer_items"

    id = Column(
        Integer,
        primary_key=True,
    )

    transfer_id = Column(
        Integer,
        ForeignKey("inventory_transfers.id"),
        nullable=False,
    )

    product_id = Column(
        Integer,
        ForeignKey("products.id"),
        nullable=False,
    )

    batch_id = Column(
        Integer,
        ForeignKey("product_batches.id"),
        nullable=True,
    )

    from_location_id = Column(
        Integer,
        ForeignKey("warehouse_locations.id"),
        nullable=False,
    )

    to_location_id = Column(
        Integer,
        ForeignKey("warehouse_locations.id"),
        nullable=False,
    )

    quantity = Column(
        Numeric(18, 3),
        nullable=False,
    )

    created_at = Column(
        DateTime,
        nullable=False,
        server_default=func.now(),
    )

    transfer = relationship(
        "InventoryTransfer",
        back_populates="items",
    )

    product = relationship(
        "Product",
    )

    batch = relationship(
        "ProductBatch",
    )

    from_location = relationship(
        "WarehouseLocation",
        foreign_keys=[from_location_id],
    )

    to_location = relationship(
        "WarehouseLocation",
        foreign_keys=[to_location_id],
    )

    __table_args__ = (
        CheckConstraint(
            "quantity > 0",
            name=(
                "ck_inventory_transfer_items_"
                "quantity_positive"
            ),
        ),
        Index(
            "uq_inventory_transfer_items_no_batch",
            "transfer_id",
            "product_id",
            "from_location_id",
            "to_location_id",
            unique=True,
            postgresql_where=text(
                "batch_id IS NULL"
            ),
        ),
        Index(
            "uq_inventory_transfer_items_with_batch",
            "transfer_id",
            "product_id",
            "batch_id",
            "from_location_id",
            "to_location_id",
            unique=True,
            postgresql_where=text(
                "batch_id IS NOT NULL"
            ),
        ),
        Index(
            "ix_inventory_transfer_items_transfer_id",
            "transfer_id",
        ),
        Index(
            "ix_inventory_transfer_items_product_id",
            "product_id",
        ),
        Index(
            "ix_inventory_transfer_items_batch_id",
            "batch_id",
        ),
    )

class InventoryMovement(Base):
    __tablename__ = "inventory_movements"

    id = Column(
        Integer,
        primary_key=True,
    )

    product_id = Column(
        Integer,
        ForeignKey("products.id"),
        nullable=False,
    )

    batch_id = Column(
        Integer,
        ForeignKey("product_batches.id"),
        nullable=True,
    )

    warehouse_id = Column(
        Integer,
        ForeignKey("warehouses.id"),
        nullable=False,
    )

    location_id = Column(
        Integer,
        ForeignKey("warehouse_locations.id"),
        nullable=False,
    )

    movement_type = Column(
        String(50),
        nullable=False,
    )

    quantity = Column(
        Numeric(18, 3),
        nullable=False,
    )

    balance_before = Column(
        Numeric(18, 3),
        nullable=False,
    )

    balance_after = Column(
        Numeric(18, 3),
        nullable=False,
    )

    reference_type = Column(
        String(50),
        nullable=True,
    )

    reference_id = Column(
        Integer,
        nullable=True,
    )

    reference_number = Column(
        String(100),
        nullable=True,
    )

    remark = Column(
        String(500),
        nullable=True,
    )

    created_by_user_id = Column(
        Integer,
        ForeignKey("users.id"),
        nullable=True,
    )

    created_at = Column(
        DateTime,
        nullable=False,
        server_default=func.now(),
    )

    product = relationship(
        "Product",
    )

    batch = relationship(
        "ProductBatch",
    )

    warehouse = relationship(
        "Warehouse",
    )

    location = relationship(
        "WarehouseLocation",
    )

    created_by = relationship(
        "User",
    )

    __table_args__ = (
        CheckConstraint(
            "quantity <> 0",
            name=(
                "ck_inventory_movements_"
                "quantity_non_zero"
            ),
        ),

        CheckConstraint(
            "balance_before >= 0",
            name=(
                "ck_inventory_movements_"
                "balance_before_non_negative"
            ),
        ),

        CheckConstraint(
            "balance_after >= 0",
            name=(
                "ck_inventory_movements_"
                "balance_after_non_negative"
            ),
        ),

        Index(
            "ix_inventory_movements_product_id",
            "product_id",
        ),

        Index(
            "ix_inventory_movements_batch_id",
            "batch_id",
        ),

        Index(
            "ix_inventory_movements_warehouse_id",
            "warehouse_id",
        ),

        Index(
            "ix_inventory_movements_location_id",
            "location_id",
        ),

        Index(
            "ix_inventory_movements_movement_type",
            "movement_type",
        ),

        Index(
            "ix_inventory_movements_reference",
            "reference_type",
            "reference_id",
        ),

        Index(
            "ix_inventory_movements_created_at",
            "created_at",
        ),
    )