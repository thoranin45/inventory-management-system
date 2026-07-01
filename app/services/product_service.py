import os
import shutil

from fastapi import HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.models import Product, AuditLog, Category
from app.schemas.product_schema import ProductCreate, ProductUpdate
from app.repositories.product_repository import ProductRepository
from app.core.unit_of_work import UnitOfWork

from app.core.exceptions import (
    ProductNotFoundException,
    DuplicateSKUException,
    DuplicateBarcodeException,
    CategoryNotFoundException,
    InactiveProductNotFoundException
)


def create_product_service(
    db: Session,
    data: ProductCreate,
    current_user
):
    product_repo = ProductRepository(db)

    existing_sku = product_repo.get_by_sku(data.sku)

    if existing_sku:
        raise DuplicateSKUException()

    existing_barcode = product_repo.get_by_barcode(data.barcode)

    if existing_barcode:
        raise DuplicateBarcodeException()

    if data.category_id is not None:
        category = db.query(Category).filter(
            Category.id == data.category_id
        ).first()

        if category is None:
            raise CategoryNotFoundException()

    new_product = Product(
        sku=data.sku,
        barcode=data.barcode,
        product_name=data.product_name,
        price=data.price,
        stock_qty=data.stock_qty,
        category_id=data.category_id,
        is_active=True
    )

    product_repo.create(new_product)

    audit = AuditLog(
        username=current_user.username,
        action="CREATE_PRODUCT",
        table_name="products",
        record_id=new_product.id,
        description=f"Create Product: {new_product.sku} - {new_product.product_name}"
    )

    db.add(audit)

    uow = UnitOfWork(db)
    uow.commit()
    uow.refresh(new_product)

    return new_product


def get_product_service(
    db: Session,
    product_id: int
):
    product_repo = ProductRepository(db)

    product = product_repo.get_by_id(product_id)

    if product is None:
        raise ProductNotFoundException()

    return product


def get_products_service(
    db: Session,
    page: int,
    size: int
):
    product_repo = ProductRepository(db)

    total, products = product_repo.get_active_paginated(
        page,
        size
    )

    return {
        "page": page,
        "size": size,
        "total": total,
        "items": products
    }


def update_product_service(
    db: Session,
    product_id: int,
    data: ProductUpdate,
    current_user
):
    product_repo = ProductRepository(db)

    product = product_repo.get_by_id(product_id)

    if product is None:
        raise ProductNotFoundException()

    old_description = (
        f"Old Data: sku={product.sku}, "
        f"barcode={product.barcode}, "
        f"name={product.product_name}, "
        f"price={product.price}, "
        f"stock={product.stock_qty}, "
        f"category_id={product.category_id}"
    )

    product.sku = data.sku
    product.barcode = data.barcode
    product.product_name = data.product_name
    product.price = data.price
    product.stock_qty = data.stock_qty
    product.category_id = data.category_id

    product_repo.update(product)

    audit = AuditLog(
        username=current_user.username,
        action="UPDATE_PRODUCT",
        table_name="products",
        record_id=product.id,
        description=(
            f"Update Product: {product.sku} - {product.product_name}. "
            f"{old_description}"
        )
    )

    db.add(audit)

    uow = UnitOfWork(db)
    uow.commit()
    uow.refresh(product)

    return product


def delete_product_service(
    db: Session,
    product_id: int,
    current_user
):
    product_repo = ProductRepository(db)

    product = product_repo.get_by_id(product_id)

    if product is None:
        raise ProductNotFoundException()

    product_repo.soft_delete(product)

    audit = AuditLog(
        username=current_user.username,
        action="SOFT_DELETE_PRODUCT",
        table_name="products",
        record_id=product.id,
        description=f"Soft Delete Product: {product.sku} - {product.product_name}"
    )

    db.add(audit)

    uow = UnitOfWork(db)
    uow.commit()
    uow.refresh(product)

    return product


def upload_product_image_service(
    db: Session,
    product_id: int,
    file: UploadFile,
    current_user
):
    product_repo = ProductRepository(db)

    product = product_repo.get_by_id(product_id)

    if product is None:
        raise ProductNotFoundException()

    allowed_extensions = ["jpg", "jpeg", "png", "webp"]

    extension = file.filename.split(".")[-1].lower()

    if extension not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail="Only jpg, jpeg, png, webp files are allowed"
        )

    os.makedirs(
        "uploads/products",
        exist_ok=True
    )

    filename = f"product_{product_id}.{extension}"

    file_path = os.path.join(
        "uploads/products",
        filename
    )

    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(
                file.file,
                buffer
            )

        product.image_url = f"/uploads/products/{filename}"

        audit = AuditLog(
            username=current_user.username,
            action="UPLOAD_PRODUCT_IMAGE",
            table_name="products",
            record_id=product.id,
            description=f"Upload image for {product.sku} - {product.product_name}"
        )

        db.add(audit)

        uow = UnitOfWork(db)
        uow.commit()
        uow.refresh(product)

        return product

    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Failed to upload product image"
        )


def search_products_service(
    db: Session,
    keyword: str
):
    product_repo = ProductRepository(db)

    return product_repo.search_active(keyword)


def get_product_by_barcode_service(
    db: Session,
    barcode: str
):
    product_repo = ProductRepository(db)

    product = product_repo.get_active_by_barcode(barcode)

    if product is None:
        raise ProductNotFoundException()

    return product


def get_inactive_products_service(
    db: Session
):
    product_repo = ProductRepository(db)

    return product_repo.get_inactive_all()


def restore_product_service(
    db: Session,
    product_id: int,
    current_user
):
    product_repo = ProductRepository(db)

    product = product_repo.get_inactive_by_id(product_id)

    if product is None:
        raise InactiveProductNotFoundException()

    product_repo.restore(product)

    audit = AuditLog(
        username=current_user.username,
        action="RESTORE_PRODUCT",
        table_name="products",
        record_id=product.id,
        description=f"Restore Product: {product.sku} - {product.product_name}"
    )

    db.add(audit)

    uow = UnitOfWork(db)
    uow.commit()
    uow.refresh(product)

    return product