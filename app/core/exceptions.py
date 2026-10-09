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


class StockAdjustRetiredException(AppException):
    """Phase 14B: direct /stock/adjust is retired in favour of the Stock
    Adjustment Request & Approval workflow -- never mutates, for any role.

    Mirrors how InventoryTransfer's /complete route was retired: the route
    stays, stays authenticated, and unconditionally 409s pointing callers
    at the replacement flow, rather than being deleted outright.
    """

    def __init__(self):
        super().__init__(
            message=(
                "Direct stock adjustment is retired; submit a stock "
                "adjustment request instead (POST /stock-adjustment-requests)"
            ),
            status_code=status.HTTP_409_CONFLICT,
        )


class AdjustmentRequestNotFoundException(AppException):
    def __init__(self):
        super().__init__(
            message="Stock adjustment request not found",
            status_code=status.HTTP_404_NOT_FOUND,
        )


class AdjustmentRequestForbiddenException(AppException):
    """Non-owner, non-admin access to another user's request."""

    def __init__(self):
        super().__init__(
            message="You do not have access to this stock adjustment request",
            status_code=status.HTTP_403_FORBIDDEN,
        )


class AdjustmentRequestNotPendingException(AppException):
    """Approve/reject/cancel attempted on a request that already left
    PENDING -- whether decided by someone else or by a different,
    unrelated retry key. Names the actual current status so the caller
    never has to guess."""

    def __init__(self, current_status: str):
        super().__init__(
            message=f"This request was already decided: {current_status}.",
            status_code=status.HTTP_409_CONFLICT,
        )


class SelfApprovalNotAllowedException(AppException):
    def __init__(self):
        super().__init__(
            message="You cannot approve a request you submitted yourself",
            status_code=status.HTTP_403_FORBIDDEN,
        )


class StaleQuantityConflictException(AppException):
    """The live balance no longer matches what the requester observed --
    someone else changed it after the request was created. Names the
    actual current value so the admin can decide with fresh information,
    never a silent rebase of the original request."""

    def __init__(self, actual_quantity):
        super().__init__(
            message=(
                f"Someone already changed this balance to {actual_quantity}. "
                "Review and retry."
            ),
            status_code=status.HTTP_409_CONFLICT,
        )


class AdjustmentRequestBatchNotSupportedException(AppException):
    """Phase 14B is product-level only -- batch_id must be null. Phase 14D
    adds batch-level requests; this guard is not a backend limitation to
    "fix" here, it's the deliberate phase boundary."""

    def __init__(self):
        super().__init__(
            message=(
                "Batch-level adjustment requests are not supported in this "
                "phase (Phase 14D)"
            ),
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        )