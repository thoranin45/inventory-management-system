from fastapi import status


class AppException(Exception):
    def __init__(
        self,
        message: str,
        status_code: int = status.HTTP_400_BAD_REQUEST,
    ):
        super().__init__(message)

        self.message = message
        self.status_code = status_code


class ProductNotFoundException(AppException):
    def __init__(self):
        super().__init__(
            message="Product not found",
            status_code=status.HTTP_404_NOT_FOUND,
        )

class StockBalanceNotFoundException(AppException):
    def __init__(self):
        super().__init__(
            status_code=404,
            message="Stock balance not found",
        )


class StockBalanceAlreadyExistsException(
    AppException
):
    def __init__(self):
        super().__init__(
            status_code=409,
            message="Stock balance already exists",
        )


class InvalidStockReservationException(
    AppException
):
    def __init__(self):
        super().__init__(
            status_code=409,
            message=(
                "Reserved quantity cannot "
                "exceed on-hand quantity"
            ),
        )

class DuplicateSKUException(AppException):
    def __init__(self):
        super().__init__(
            message="SKU already exists",
            status_code=status.HTTP_409_CONFLICT,
        )


class DuplicateBarcodeException(AppException):
    def __init__(self):
        super().__init__(
            message="Barcode already exists",
            status_code=status.HTTP_409_CONFLICT,
        )


class CategoryNotFoundException(AppException):
    def __init__(self):
        super().__init__(
            message="Category not found",
            status_code=status.HTTP_404_NOT_FOUND,
        )


class InactiveProductNotFoundException(AppException):
    def __init__(self):
        super().__init__(
            message="Inactive product not found",
            status_code=status.HTTP_404_NOT_FOUND,
        )


class CategoryAlreadyExistsException(AppException):
    def __init__(self):
        super().__init__(
            message="Category already exists",
            status_code=status.HTTP_409_CONFLICT,
        )


class CategoryInUseException(AppException):
    def __init__(self):
        super().__init__(
            message="Cannot delete category with active products",
            status_code=status.HTTP_409_CONFLICT,
        )


class SupplierNotFoundException(AppException):
    def __init__(self):
        super().__init__(
            message="Supplier not found",
            status_code=status.HTTP_404_NOT_FOUND,
        )


class SupplierAlreadyExistsException(AppException):
    def __init__(self):
        super().__init__(
            message="Supplier already exists",
            status_code=status.HTTP_409_CONFLICT,
        )

class CustomerNotFoundException(AppException):
    def __init__(self):
        super().__init__(
            message="Customer not found",
            status_code=404,
        )


class CustomerAlreadyExistsException(AppException):
    def __init__(self):
        super().__init__(
            message="Customer already exists",
            status_code=409,
        )  


class InsufficientStockException(AppException):
    def __init__(self):
        super().__init__(
            message="Not enough stock",
            status_code=status.HTTP_409_CONFLICT,
        )


class InsufficientBatchStockException(AppException):
    def __init__(self):
        super().__init__(
            message="Not enough batch stock",
            status_code=status.HTTP_409_CONFLICT,
        )


class InvalidBatchDateException(AppException):
    def __init__(self):
        super().__init__(
            message=(
                "Expiry date must be after "
                "manufacturing date"
            ),
            status_code=status.HTTP_400_BAD_REQUEST,
        )


class DuplicateLotNumberException(AppException):
    def __init__(self):
        super().__init__(
            message="Lot number already exists",
            status_code=status.HTTP_409_CONFLICT,
        )


class BatchStockAdjustmentException(AppException):
    def __init__(self):
        super().__init__(
            message=(
                "Cannot directly adjust a product "
                "that has active batch stock"
            ),
            status_code=status.HTTP_409_CONFLICT,
        )


class BatchTrackedAdjustmentException(AppException):
    """Direct /stock/adjust on a batch-tracked product, regardless of its
    current batch stock total.

    A batch-tracked product with zero batch stock would otherwise pass the
    ``batch_stock_total > 0`` check and let a positive adjustment land
    straight on the unbatched (batch_id=None) balance — stock with no lot or
    expiry, for a product whose tracking mode says every unit must have both.
    Unlike /stock/in and /batches, there is no working endpoint to adjust a
    specific batch's balance directly (``PATCH /stock-balances/{id}`` is
    intentionally disabled — it unconditionally returns 409), so the message
    points to the batch-aware workflows that exist instead: receive more via
    POST /batches, issue via /stock/out-fefo or /stock/out-fifo.
    """

    def __init__(self):
        super().__init__(
            message=(
                "Batch-tracked products cannot be adjusted directly — "
                "receive via POST /batches or issue via /stock/out-fefo "
                "/ /stock/out-fifo instead"
            ),
            status_code=status.HTTP_409_CONFLICT,
        )


class BatchTrackedStockInException(AppException):
    """Direct /stock/in on a batch-tracked product — the caller must receive it
    with a lot number via /batches instead."""

    def __init__(self):
        super().__init__(
            message=(
                "Batch-tracked products must be received with a lot "
                "number via POST /batches, not direct stock in"
            ),
            status_code=status.HTTP_409_CONFLICT,
        )


class NonBatchProductBatchException(AppException):
    """A batch was requested for a product that is not batch-tracked."""

    def __init__(self):
        super().__init__(
            message=(
                "This product is not batch-tracked — add stock directly via "
                "POST /stock/in, not as a batch"
            ),
            status_code=status.HTTP_409_CONFLICT,
        )


class MissingBatchDatesException(AppException):
    """Expiry-tracked product received without both manufacturing and expiry
    dates."""

    def __init__(self):
        super().__init__(
            message=(
                "Expiry-tracked product requires manufacturing and expiry "
                "dates"
            ),
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        )


class PartialBatchDatesException(AppException):
    """Only one of manufacturing / expiry date supplied for a batch."""

    def __init__(self):
        super().__init__(
            message=(
                "Supply both manufacturing and expiry dates, or neither"
            ),
            status_code=status.HTTP_400_BAD_REQUEST,
        )


class IdempotencyKeyConflictException(AppException):
    """An ``Idempotency-Key`` was reused for a request that isn't a byte-identical
    replay of the one it was first used for.

    Raised two ways, both meaning the same thing to the client:
      1. Synchronously, when the stored receipt's fingerprint doesn't match
         the current request (same key, different body).
      2. From a lost race: ``stock_operation_receipts.operation_key`` is
         globally unique with no parent row to lock, so two concurrent
         requests reusing the same key for *different* products aren't
         serialised by the per-product inventory lock and can both pass the
         synchronous check. The loser's INSERT hits the unique constraint;
         the repository converts that into this same exception instead of a
         generic integrity error, and the caller's transaction rolls back
         whole (no partial stock apply either way).
    """

    def __init__(self):
        super().__init__(
            message="Idempotency-Key already used with a different payload",
            status_code=status.HTTP_409_CONFLICT,
        )


class PurchaseOrderNotFoundException(AppException):
    def __init__(self):
        super().__init__(
            message="Purchase order not found",
            status_code=status.HTTP_404_NOT_FOUND,
        )


class PurchaseOrderAlreadyReceivedException(AppException):
    def __init__(self):
        super().__init__(
            message="Purchase order already received",
            status_code=status.HTTP_409_CONFLICT,
        )


class PurchaseOrderCancelledException(AppException):
    def __init__(self):
        super().__init__(
            message="Purchase order is cancelled",
            status_code=status.HTTP_409_CONFLICT,
        )


class InvalidPurchaseOrderStatusException(AppException):
    def __init__(self):
        super().__init__(
            message="Invalid purchase order status",
            status_code=status.HTTP_409_CONFLICT,
        )


class MissingPurchaseOrderReceiveItemException(AppException):
    def __init__(
        self,
        product_id: int,
    ):
        super().__init__(
            message=(
                "Missing receive information for "
                f"product_id {product_id}"
            ),
            status_code=status.HTTP_400_BAD_REQUEST,
        )


class UnexpectedPurchaseOrderReceiveItemException(AppException):
    def __init__(
        self,
        product_id: int,
    ):
        super().__init__(
            message=(
                "Product is not included in purchase order: "
                f"{product_id}"
            ),
            status_code=status.HTTP_400_BAD_REQUEST,
        )   

class WarehouseNotFoundException(AppException):
    def __init__(self):
        super().__init__(
            message="Warehouse not found",
            status_code=status.HTTP_404_NOT_FOUND,
        )


class WarehouseLocationNotFoundException(AppException):
    def __init__(self):
        super().__init__(
            message="Warehouse location not found",
            status_code=status.HTTP_404_NOT_FOUND,
        )


class BatchNotFoundException(AppException):
    def __init__(self):
        super().__init__(
            message="Batch not found",
            status_code=status.HTTP_404_NOT_FOUND,
        )


class BatchRequiredException(AppException):
    def __init__(self):
        super().__init__(
            message="Batch is required for this product",
            status_code=status.HTTP_400_BAD_REQUEST,
        )


class BatchNotAllowedException(AppException):
    def __init__(self):
        super().__init__(
            message="Batch is not allowed for this product",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

class DefaultStorageNotConfiguredException(
    AppException
):
    def __init__(self):
        super().__init__(
            message=(
                "Default warehouse or location "
                "is not configured"
            ),
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

class InventoryTransferNotFoundException(
    AppException
):
    def __init__(self):
        super().__init__(
            message="Inventory transfer not found",
            status_code=status.HTTP_404_NOT_FOUND,
        )


class InvalidTransferLocationException(
    AppException
):
    def __init__(self):
        super().__init__(
            message=(
                "Transfer location does not belong "
                "to the specified warehouse"
            ),
            status_code=status.HTTP_400_BAD_REQUEST,
        )


class SameTransferLocationException(
    AppException
):
    def __init__(self):
        super().__init__(
            message=(
                "Source and destination locations "
                "must be different"
            ),
            status_code=status.HTTP_400_BAD_REQUEST,
        )


class DuplicateTransferItemException(
    AppException
):
    def __init__(self):
        super().__init__(
            message="Duplicate transfer item",
            status_code=status.HTTP_409_CONFLICT,
        )

class InventoryTransferAlreadyCompletedException(
    AppException
):
    def __init__(self):
        super().__init__(
            message="Inventory transfer already completed",
            status_code=status.HTTP_409_CONFLICT,
        )


class InventoryTransferCancelledException(
    AppException
):
    def __init__(self):
        super().__init__(
            message="Inventory transfer is cancelled",
            status_code=status.HTTP_409_CONFLICT,
        )

class InventoryTransferCannotCancelException(
    AppException
):
    def __init__(self):
        super().__init__(
            message=(
                "Only draft inventory transfer "
                "can be cancelled"
            ),
            status_code=status.HTTP_409_CONFLICT,
        )

class PurchaseOrderOverReceiveException(
    AppException
):
    def __init__(
        self,
        product_id: int,
    ):
        super().__init__(
            message=(
                "Received quantity exceeds "
                "remaining purchase order quantity "
                f"for product_id {product_id}"
            ),
            status_code=status.HTTP_409_CONFLICT,
        )

class InsufficientAvailableStockException(
    AppException
):
    def __init__(self):
        super().__init__(
            message="Insufficient available stock",
            status_code=status.HTTP_409_CONFLICT,
        )


class SalesOrderAlreadyCompletedException(
    AppException
):
    def __init__(self):
        super().__init__(
            message="Sales order already completed",
            status_code=status.HTTP_409_CONFLICT,
        )