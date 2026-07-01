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
)
from sqlalchemy.sql import func

Base = declarative_base()


class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True)

    sku = Column(String(50), unique=True)

    barcode = Column(String(100), unique=True)

    product_name = Column(String(255))

    price = Column(Numeric(10, 2))

    stock_qty = Column(Integer)

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


class StockTransaction(Base):
    __tablename__ = "stock_transactions"

    id = Column(Integer, primary_key=True)

    product_id = Column(
        Integer,
        ForeignKey("products.id")
    )

    transaction_type = Column(String(20))

    quantity = Column(Integer)

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

    quantity = Column(Integer)

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

    quantity = Column(Integer)

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

    quantity = Column(Integer)
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

    quantity = Column(Integer)

    created_at = Column(
        DateTime,
        server_default=func.now()
    )