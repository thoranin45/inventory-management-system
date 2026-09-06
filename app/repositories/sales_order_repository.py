from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import (
    Customer,
    Product,
    ProductBatch,
    SalesOrder,
    SalesOrderBatchAllocation,
    SalesOrderItem,
    StockTransaction,
)


class SalesOrderRepository:
    def __init__(
        self,
        db: Session,
    ):
        self.db = db

    # =========================================================
    # Customer
    # =========================================================

    def get_customer_by_id(
        self,
        customer_id: int,
    ) -> Customer | None:
        return (
            self.db.query(Customer)
            .filter(
                Customer.id == customer_id
            )
            .first()
        )

    # =========================================================
    # Product
    # =========================================================

    def get_active_product_by_id(
        self,
        product_id: int,
    ) -> Product | None:
        return (
            self.db.query(Product)
            .filter(
                Product.id == product_id,
                Product.is_active.is_(True),
            )
            .first()
        )

    def get_product_by_id(
        self,
        product_id: int,
    ) -> Product | None:
        return (
            self.db.query(Product)
            .filter(
                Product.id == product_id
            )
            .first()
        )

    def get_product_by_id_for_update(
        self,
        product_id: int,
    ) -> Product | None:
        return (
            self.db.query(Product)
            .filter(
                Product.id == product_id
            )
            .with_for_update()
            .first()
        )
    # =========================================================
    # Sales Order
    # =========================================================

    def create_sales_order(
        self,
        sales_order: SalesOrder,
    ) -> SalesOrder:
        self.db.add(sales_order)
        self.db.flush()

        return sales_order

    def update_sales_order(
        self,
        sales_order: SalesOrder,
    ) -> SalesOrder:
        self.db.add(sales_order)

        return sales_order

    def get_sales_order_by_id(
        self,
        sales_order_id: int,
    ) -> SalesOrder | None:
        return (
            self.db.query(SalesOrder)
            .filter(
                SalesOrder.id == sales_order_id
            )
            .first()
        )

    def get_sales_order_by_id_for_update(
        self,
        sales_order_id: int,
    ) -> SalesOrder | None:
        return (
            self.db.query(SalesOrder)
            .filter(
                SalesOrder.id == sales_order_id
            )
            .with_for_update()
            .first()
        )
    
    def get_all_sales_orders(
        self,
    ) -> list[SalesOrder]:
        return (
            self.db.query(SalesOrder)
            .order_by(
                SalesOrder.created_at.desc(),
                SalesOrder.id.desc(),
            )
            .all()
        )

    # =========================================================
    # Sales Order Item
    # =========================================================

    def create_sales_order_item(
        self,
        sales_order_item: SalesOrderItem,
    ) -> SalesOrderItem:
        self.db.add(sales_order_item)
        self.db.flush()

        return sales_order_item

    def get_order_items(
        self,
        sales_order_id: int,
    ) -> list[SalesOrderItem]:
        return (
            self.db.query(SalesOrderItem)
            .filter(
                SalesOrderItem.sales_order_id
                == sales_order_id
            )
            .order_by(
                SalesOrderItem.id.asc()
            )
            .all()
        )

    def get_order_item_by_product(
        self,
        sales_order_id: int,
        product_id: int,
    ) -> SalesOrderItem | None:
        return (
            self.db.query(SalesOrderItem)
            .filter(
                SalesOrderItem.sales_order_id
                == sales_order_id,
                SalesOrderItem.product_id
                == product_id,
            )
            .first()
        )

    # =========================================================
    # Batch
    # =========================================================

    def get_available_batches_fefo(
        self,
        product_id: int,
    ) -> list[ProductBatch]:
        return (
            self.db.query(ProductBatch)
            .filter(
                ProductBatch.product_id
                == product_id,
            )
            .order_by(
                ProductBatch.expiry_date.asc(),
                ProductBatch.created_at.asc(),
                ProductBatch.id.asc(),
            )
            .all()
        )

    def get_batch_by_id(
        self,
        batch_id: int,
    ) -> ProductBatch | None:
        return (
            self.db.query(ProductBatch)
            .filter(
                ProductBatch.id == batch_id
            )
            .first()
        )

    def get_batch_by_id_for_update(
        self,
        batch_id: int,
    ) -> ProductBatch | None:
        return (
            self.db.query(ProductBatch)
            .filter(
                ProductBatch.id == batch_id
            )
            .with_for_update()
            .first()
        )
    
    # =========================================================
    # Batch Allocation
    # =========================================================

    def create_batch_allocation(
        self,
        allocation: SalesOrderBatchAllocation,
    ) -> SalesOrderBatchAllocation:
        self.db.add(allocation)

        return allocation

    def get_item_allocations(
        self,
        sales_order_id: int,
        sales_order_item_id: int,
    ) -> list[SalesOrderBatchAllocation]:
        return (
            self.db.query(
                SalesOrderBatchAllocation
            )
            .filter(
                SalesOrderBatchAllocation.sales_order_id
                == sales_order_id,
                SalesOrderBatchAllocation.sales_order_item_id
                == sales_order_item_id,
            )
            .order_by(
                SalesOrderBatchAllocation.id.asc()
            )
            .all()
        )

    # =========================================================
    # Stock Transaction
    # =========================================================

    def create_stock_transaction(
        self,
        transaction: StockTransaction,
    ) -> StockTransaction:
        self.db.add(transaction)

        return transaction

    def get_returned_quantity(
        self,
        so_number: str,
        product_id: int,
    ) -> int:
        returned_quantity = (
            self.db.query(
                func.coalesce(
                    func.sum(
                        StockTransaction.quantity
                    ),
                    0,
                )
            )
            .filter(
                StockTransaction.product_id
                == product_id,
                StockTransaction.transaction_type
                == "SALE_RETURN",
                StockTransaction.remark.startswith(
                    f"Return from {so_number}."
                ),
            )
            .scalar()
        )

        return int(
            returned_quantity or 0
        )

    def has_return_transaction(
        self,
        so_number: str,
    ) -> bool:
        transaction = (
            self.db.query(StockTransaction)
            .filter(
                StockTransaction.transaction_type
                == "SALE_RETURN",
                StockTransaction.remark.startswith(
                    f"Return from {so_number}."
                ),
            )
            .first()
        )

        return transaction is not None