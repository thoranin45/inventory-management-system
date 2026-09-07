import math
import os
import shutil
from typing import Any

from fastapi import HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.core.exceptions import (
    CategoryNotFoundException,
    DuplicateBarcodeException,
    DuplicateSKUException,
    InactiveProductNotFoundException,
    ProductNotFoundException,
)
from app.core.unit_of_work import UnitOfWork
from app.models import AuditLog, Product
from app.repositories.category_repository import CategoryRepository
from app.repositories.product_repository import ProductRepository
from app.schemas.product_schema import (
    ProductCreate,
    ProductResponse,
    ProductUpdate,
)
from app.schemas.response import (
    PaginatedData,
    PaginationMeta,
)


def create_product_service(
    db: Session,
    product_repo: ProductRepository,
    category_repo: CategoryRepository,
    data: ProductCreate,
    current_user: Any,
) -> Product:
    """
    Create a new product.
    """

    existing_sku = product_repo.get_by_sku(data.sku)

    if existing_sku is not None:
        raise DuplicateSKUException()

    if data.barcode is not None:
        existing_barcode = product_repo.get_by_barcode(
            data.barcode
        )

        if existing_barcode is not None:
            raise DuplicateBarcodeException()

    if data.category_id is not None:
        category = category_repo.get_by_id(
            data.category_id
        )

        if category is None:
            raise CategoryNotFoundException()

    new_product = Product(
        sku=data.sku,
        barcode=data.barcode,
        product_name=data.product_name,
        price=data.price,
        stock_qty=data.stock_qty,
        category_id=data.category_id,
        track_batch=data.track_batch,
        track_expiry=data.track_expiry,
        is_active=True,
    )

    with UnitOfWork(db) as uow:
        product_repo.create(new_product)

        audit = AuditLog(
            username=current_user.username,
            action="CREATE_PRODUCT",
            table_name="products",
            record_id=new_product.id,
            description=(
                f"Create Product: "
                f"{new_product.sku} - "
                f"{new_product.product_name}"
            ),
        )

        db.add(audit)

    uow.refresh(new_product)

    return new_product


def get_product_service(
    product_repo: ProductRepository,
    product_id: int,
) -> Product:
    """
    Get one active product by ID.
    """

    product = product_repo.get_by_id(product_id)

    if product is None:
        raise ProductNotFoundException()

    return product


_PRODUCT_SORTS = {
    "id": Product.id,
    "product_name": Product.product_name,
    "sku": Product.sku,
    "stock_qty": Product.stock_qty,
    "created_at": Product.created_at,
}


def enrich_products(balance_repo, products, today, near_expiry_days: int) -> list[dict]:
    """Phase 8: product rows + Phase 7 derived inventory categories. One grouped query.

    Product.stock_qty keeps its Phase 2 meaning (total owned) and is echoed as
    owned_quantity; the other quantities are derived operational views.
    """
    from decimal import Decimal

    categories = balance_repo.inventory_categories_by_product(
        today, near_expiry_days, [p.id for p in products]
    )
    rows = []
    for p in products:
        cat = categories.get(p.id, {})
        rows.append({
            "id": p.id,
            "sku": p.sku,
            "barcode": p.barcode,
            "product_name": p.product_name,
            "price": p.price,
            "stock_qty": p.stock_qty,
            "owned_quantity": p.stock_qty,
            "operational_available_quantity": cat.get("operational_available_quantity", Decimal("0")),
            "reserved_quantity": cat.get("reserved_quantity", Decimal("0")),
            "expired_quantity": cat.get("expired_quantity", Decimal("0")),
            "near_expiry_quantity": cat.get("near_expiry_quantity", Decimal("0")),
            "transit_quantity": cat.get("transit_quantity", Decimal("0")),
            "minimum_stock": p.minimum_stock,
            "safety_stock": p.safety_stock,
            "maximum_stock": p.maximum_stock,
            "category_id": p.category_id,
            "image_url": p.image_url,
            "is_active": p.is_active,
            "created_at": p.created_at,
            "track_batch": p.track_batch,
            "track_expiry": p.track_expiry,
            "as_of_date": today,
        })
    return rows


def get_products_service(
    product_repo: ProductRepository,
    balance_repo,
    params,
) -> dict:
    from app.core.batch_eligibility import business_today
    from app.core.config import settings
    from app.core.pagination import paginate, paginated_body, resolve_ordering

    ordering = resolve_ordering(params, _PRODUCT_SORTS, "id", Product.id)
    items, total = paginate(
        product_repo.list_query(search=params.search, status=params.status),
        params,
        ordering,
    )
    rows = enrich_products(
        balance_repo, items, business_today(), settings.near_expiry_days
    )
    return paginated_body(rows, total, params, "Products retrieved successfully")

def update_product_service(
    db: Session,
    product_repo: ProductRepository,
    category_repo: CategoryRepository,
    product_id: int,
    data: ProductUpdate,
    current_user: Any,
) -> Product:
    """
    Update an existing product.
    """

    product = product_repo.get_by_id_for_update(product_id)

    if product is None:
        raise ProductNotFoundException()

    if data.sku is not None:
        existing_sku = product_repo.get_by_sku(
            data.sku
        )

        if (
            existing_sku is not None
            and existing_sku.id != product.id
        ):
            raise DuplicateSKUException()

    if data.barcode is not None:
        existing_barcode = product_repo.get_by_barcode(
            data.barcode
        )

        if (
            existing_barcode is not None
            and existing_barcode.id != product.id
        ):
            raise DuplicateBarcodeException()

    if "category_id" in data.model_fields_set:
        if data.category_id is not None:
            category = category_repo.get_by_id(
                data.category_id
            )

            if category is None:
                raise CategoryNotFoundException()

    old_description = (
        f"Old Data: "
        f"sku={product.sku}, "
        f"barcode={product.barcode}, "
        f"name={product.product_name}, "
        f"price={product.price}, "
        f"stock={product.stock_qty}, "
        f"category_id={product.category_id}"
    )

    new_track_batch = (
        data.track_batch
        if data.track_batch is not None
        else product.track_batch
    )

    new_track_expiry = (
        data.track_expiry
        if data.track_expiry is not None
        else product.track_expiry
    )

    if new_track_expiry and not new_track_batch:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "track_expiry requires "
                "track_batch=True"
            ),
        )

    if new_track_batch != product.track_batch and (product.stock_qty or product_repo.has_inventory_evidence(product.id)):
        raise HTTPException(409, "Tracking mode cannot change after inventory or allocation history exists")
    
    update_data = data.model_dump(
        exclude_unset=True
    )

    for field_name, field_value in update_data.items():
        setattr(
            product,
            field_name,
            field_value,
        )

    with UnitOfWork(db) as uow:
        product_repo.update(product)

        audit = AuditLog(
            username=current_user.username,
            action="UPDATE_PRODUCT",
            table_name="products",
            record_id=product.id,
            description=(
                f"Update Product: "
                f"{product.sku} - "
                f"{product.product_name}. "
                f"{old_description}"
            ),
        )

        db.add(audit)

    uow.refresh(product)

    return product


def delete_product_service(
    db: Session,
    product_repo: ProductRepository,
    product_id: int,
    current_user: Any,
) -> Product:
    """
    Soft-delete a product.
    """

    product = product_repo.get_by_id(product_id)

    if product is None:
        raise ProductNotFoundException()

    with UnitOfWork(db) as uow:
        product_repo.soft_delete(product)

        audit = AuditLog(
            username=current_user.username,
            action="SOFT_DELETE_PRODUCT",
            table_name="products",
            record_id=product.id,
            description=(
                f"Soft Delete Product: "
                f"{product.sku} - "
                f"{product.product_name}"
            ),
        )

        db.add(audit)

    uow.refresh(product)

    return product


def restore_product_service(
    db: Session,
    product_repo: ProductRepository,
    product_id: int,
    current_user: Any,
) -> Product:
    """
    Restore an inactive product.
    """

    product = product_repo.get_inactive_by_id(
        product_id
    )

    if product is None:
        raise InactiveProductNotFoundException()

    with UnitOfWork(db) as uow:
        product_repo.restore(product)

        audit = AuditLog(
            username=current_user.username,
            action="RESTORE_PRODUCT",
            table_name="products",
            record_id=product.id,
            description=(
                f"Restore Product: "
                f"{product.sku} - "
                f"{product.product_name}"
            ),
        )

        db.add(audit)

    uow.refresh(product)

    return product


def search_products_service(
    product_repo: ProductRepository,
    keyword: str,
) -> list[Product]:
    """
    Search active products.
    """

    return product_repo.search_active(keyword)


def get_product_by_barcode_service(
    product_repo: ProductRepository,
    barcode: str,
) -> Product:
    """
    Get one active product by barcode.
    """

    product = product_repo.get_active_by_barcode(
        barcode
    )

    if product is None:
        raise ProductNotFoundException()

    return product


def get_inactive_products_service(
    product_repo: ProductRepository,
) -> list[Product]:
    """
    Get all inactive products.
    """

    return product_repo.get_inactive_all()


def upload_product_image_service(
    db: Session,
    product_repo: ProductRepository,
    product_id: int,
    file: UploadFile,
    current_user: Any,
) -> Product:
    """
    Upload or replace a product image.
    """

    product = product_repo.get_by_id(product_id)

    if product is None:
        raise ProductNotFoundException()

    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Filename is required",
        )

    allowed_extensions = {
        "jpg",
        "jpeg",
        "png",
        "webp",
    }

    allowed_content_types = {
        "image/jpeg",
        "image/png",
        "image/webp",
    }

    if "." not in file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File extension is required",
        )

    extension = (
        file.filename
        .rsplit(".", 1)[-1]
        .lower()
    )

    if extension not in allowed_extensions:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Only jpg, jpeg, png, "
                "and webp files are allowed"
            ),
        )

    if (
        file.content_type is not None
        and file.content_type not in allowed_content_types
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid image content type",
        )

    upload_directory = os.path.join(
        "uploads",
        "products",
    )

    os.makedirs(
        upload_directory,
        exist_ok=True,
    )

    filename = (
        f"product_{product_id}.{extension}"
    )

    file_path = os.path.join(
        upload_directory,
        filename,
    )

    previous_image_url = product.image_url

    try:
        with open(
            file_path,
            "wb",
        ) as buffer:
            shutil.copyfileobj(
                file.file,
                buffer,
            )

        product.image_url = (
            f"/uploads/products/{filename}"
        )

        with UnitOfWork(db) as uow:
            product_repo.update(product)

            audit = AuditLog(
                username=current_user.username,
                action="UPLOAD_PRODUCT_IMAGE",
                table_name="products",
                record_id=product.id,
                description=(
                    f"Upload image for "
                    f"{product.sku} - "
                    f"{product.product_name}"
                ),
            )

            db.add(audit)

        uow.refresh(product)

        return product

    except HTTPException:
        raise

    except Exception as exc:
        product.image_url = previous_image_url

        if os.path.exists(file_path):
            os.remove(file_path)

        raise HTTPException(
            status_code=(
                status.HTTP_500_INTERNAL_SERVER_ERROR
            ),
            detail="Failed to upload product image",
        ) from exc

    finally:
        file.file.close()
