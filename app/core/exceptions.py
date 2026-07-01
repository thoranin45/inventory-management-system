class AppException(Exception):
    def __init__(
        self,
        message: str,
        status_code: int = 400
    ):
        self.message = message
        self.status_code = status_code


class ProductNotFoundException(AppException):
    def __init__(self):
        super().__init__(
            message="Product not found",
            status_code=404
        )


class DuplicateSKUException(AppException):
    def __init__(self):
        super().__init__(
            message="SKU already exists",
            status_code=400
        )


class DuplicateBarcodeException(AppException):
    def __init__(self):
        super().__init__(
            message="Barcode already exists",
            status_code=400
        )


class CategoryNotFoundException(AppException):
    def __init__(self):
        super().__init__(
            message="Category not found",
            status_code=404
        )

class InactiveProductNotFoundException(AppException):
    def __init__(self):
        super().__init__(
            message="Inactive product not found",
            status_code=404
        )