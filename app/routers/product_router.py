from fastapi import (
    APIRouter,
    Depends,
    UploadFile,
    File,
    Query
)

from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.product_schema import (
    ProductCreate,
    ProductUpdate,
    ProductResponse
)
from app.core.dependencies import require_admin
from app.core.response import success_response
from app.services.product_service import (
    create_product_service,
    get_product_service,
    get_products_service,
    update_product_service,
    delete_product_service,
    upload_product_image_service,
    search_products_service,
    get_product_by_barcode_service,
    get_inactive_products_service,
    restore_product_service
)

router = APIRouter()


@router.post("/products")
def create_product(
    product: ProductCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin)
):
    new_product = create_product_service(
        db,
        product,
        current_user
    )

    return success_response(
        "Product Created",
        {
            "id": new_product.id
        }
    )


@router.get("/products")
def get_products(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db)
):
    products_data = get_products_service(
        db,
        page,
        size
    )

    return success_response(
        "Products Retrieved",
        products_data
    )


@router.get("/products/search")
def search_products(
    keyword: str,
    db: Session = Depends(get_db)
):
    products = search_products_service(
        db,
        keyword
    )

    return success_response(
        "Products Search Result",
        {
            "items": products
        }
    )


@router.get("/products/inactive")
def get_inactive_products(
    db: Session = Depends(get_db),
    current_user=Depends(require_admin)
):
    products = get_inactive_products_service(
        db
    )

    return success_response(
        "Inactive Products Retrieved",
        {
            "items": products
        }
    )


@router.get("/products/barcode/{barcode}")
def get_product_by_barcode(
    barcode: str,
    db: Session = Depends(get_db)
):
    product = get_product_by_barcode_service(
        db,
        barcode
    )

    return success_response(
        "Product Found",
        {
            "id": product.id,
            "sku": product.sku,
            "barcode": product.barcode,
            "product_name": product.product_name,
            "price": float(product.price),
            "stock_qty": product.stock_qty,
            "category_id": product.category_id,
            "is_active": product.is_active,
            "image_url": product.image_url,
        }
    )


@router.get("/products/{product_id}", response_model=ProductResponse)
def get_product(
    product_id: int,
    db: Session = Depends(get_db)
):
    return get_product_service(
        db,
        product_id
    )


@router.put("/products/{product_id}")
def update_product(
    product_id: int,
    product_update: ProductUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin)
):
    product = update_product_service(
        db,
        product_id,
        product_update,
        current_user
    )

    return success_response(
        "Product Updated",
        {
            "id": product.id,
            "sku": product.sku,
            "barcode": product.barcode,
            "product_name": product.product_name,
            "price": float(product.price),
            "stock_qty": product.stock_qty,
            "category_id": product.category_id,
            "is_active": product.is_active,
            "image_url": product.image_url
        }
    )


@router.delete("/products/{product_id}")
def delete_product(
    product_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin)
):
    delete_product_service(
        db,
        product_id,
        current_user
    )

    return success_response(
        "Product Soft Deleted"
    )


@router.put("/products/{product_id}/restore")
def restore_product(
    product_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin)
):
    product = restore_product_service(
        db,
        product_id,
        current_user
    )

    return success_response(
        "Product Restored",
        {
            "id": product.id
        }
    )


@router.post("/products/{product_id}/upload-image")
def upload_product_image(
    product_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user=Depends(require_admin)
):
    product = upload_product_image_service(
        db,
        product_id,
        file,
        current_user
    )

    return success_response(
        "Image uploaded",
        {
            "image_url": product.image_url
        }
    )