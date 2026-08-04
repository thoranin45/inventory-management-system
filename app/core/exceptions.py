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