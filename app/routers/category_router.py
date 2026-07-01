from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.database import get_db
from app.models import Category, Product
from app.schemas.category_schema import CategoryCreate, CategoryUpdate
from app.core.dependencies import require_admin

router = APIRouter(prefix="/categories", tags=["Categories"])


@router.post("/")
def create_category(
    data: CategoryCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin)
):
    category = Category(
        category_name=data.category_name
    )

    try:
        db.add(category)
        db.commit()
        db.refresh(category)

    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail="Category already exists"
        )

    return {
        "message": "Category Created",
        "id": category.id,
        "category_name": category.category_name
    }


@router.get("/")
def get_categories(db: Session = Depends(get_db)):
    return db.query(Category).all()


@router.get("/{category_id}")
def get_category(
    category_id: int,
    db: Session = Depends(get_db)
):
    category = db.query(Category).filter(
        Category.id == category_id
    ).first()

    if category is None:
        raise HTTPException(
            status_code=404,
            detail="Category not found"
        )

    return category


@router.put("/{category_id}")
def update_category(
    category_id: int,
    data: CategoryUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin)
):
    category = db.query(Category).filter(
        Category.id == category_id
    ).first()

    if category is None:
        raise HTTPException(
            status_code=404,
            detail="Category not found"
        )

    category.category_name = data.category_name

    try:
        db.commit()
        db.refresh(category)

    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail="Category already exists"
        )

    return {
        "message": "Category Updated",
        "id": category.id,
        "category_name": category.category_name
    }


@router.delete("/{category_id}")
def delete_category(
    category_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin)
):
    category = db.query(Category).filter(
        Category.id == category_id
    ).first()

    if category is None:
        raise HTTPException(
            status_code=404,
            detail="Category not found"
        )

    product_using_category = db.query(Product).filter(
        Product.category_id == category.id,
        Product.is_active == True
    ).first()

    if product_using_category:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete category with active products"
        )

    db.delete(category)
    db.commit()

    return {
        "message": "Category Deleted"
    }