from sqlalchemy.orm import declarative_base, relationship
from sqlalchemy import (
    Column,
    Integer,
    String,
    Numeric,
    DateTime,
    Date,
    Boolean,
    ForeignKey,
    SmallInteger,
    CheckConstraint,
    UniqueConstraint,
    Index,
)
from sqlalchemy.sql import func

Base = declarative_base()


class Product(Base):
    __tablename__ = "products"

    __table_args__ = (
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

    id = Column(Integer, primary_key=True)

    product_id = Column(
        Integer,
        ForeignKey("products.id")
    )

    lot_no = Column(String(100), unique=True)

    mfg_date = Column(Date)

    expiry_date = Column(Date)

    quantity = Column(
    Numeric(18, 3),
    nullable=False,
    )

    created_at = Column(
        DateTime,
        server_default=func.now()
    )

    product = relationship(
        "Product",
        back_populates="batches"
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

    id = Column(Integer, primary_key=True)

    po_id = Column(
        Integer,
        ForeignKey("purchase_orders.id")
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