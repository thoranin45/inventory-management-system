from sqlalchemy.orm import Session

from app.core.exceptions import (
    CategoryAlreadyExistsException,
    CategoryInUseException,
    CategoryNotFoundException,
)
from app.core.pagination import ListParams, paginate, paginated_body, resolve_ordering
from app.core.unit_of_work import UnitOfWork
from app.models import Category, Product
from app.repositories.category_repository import CategoryRepository
from app.schemas.category_schema import (
    CategoryCreate,
    CategoryResponse,
    CategoryUpdate,
)

_CATEGORY_SORTS = {"id": Category.id, "category_name": Category.category_name}


def create_category_service(
    db: Session,
    category_repo: CategoryRepository,
    data: CategoryCreate,
) -> Category:
    existing_category = category_repo.get_by_name(
        data.category_name
    )

    if existing_category is not None:
        raise CategoryAlreadyExistsException()

    category = Category(
        category_name=data.category_name
    )

    with UnitOfWork(db) as uow:
        category_repo.create(category)

    uow.refresh(category)

    return category


def get_categories_service(
    category_repo: CategoryRepository,
    params: ListParams,
) -> dict:
    ordering = resolve_ordering(params, _CATEGORY_SORTS, "id", Category.id)
    items, total = paginate(
        category_repo.list_query(search=params.search), params, ordering
    )
    return paginated_body(
        [CategoryResponse.model_validate(row) for row in items],
        total,
        params,
        "Categories retrieved successfully",
    )


def get_category_service(
    category_repo: CategoryRepository,
    category_id: int,
) -> Category:
    category = category_repo.get_by_id(
        category_id
    )

    if category is None:
        raise CategoryNotFoundException()

    return category


def update_category_service(
    db: Session,
    category_repo: CategoryRepository,
    category_id: int,
    data: CategoryUpdate,
) -> Category:
    category = category_repo.get_by_id(
        category_id
    )

    if category is None:
        raise CategoryNotFoundException()

    existing_category = category_repo.get_by_name(
        data.category_name
    )

    if (
        existing_category is not None
        and existing_category.id != category.id
    ):
        raise CategoryAlreadyExistsException()

    category.category_name = data.category_name

    with UnitOfWork(db) as uow:
        category_repo.update(category)

    uow.refresh(category)

    return category


def delete_category_service(
    db: Session,
    category_repo: CategoryRepository,
    category_id: int,
) -> Category:
    category = category_repo.get_by_id(
        category_id
    )

    if category is None:
        raise CategoryNotFoundException()

    active_product = (
        db.query(Product)
        .filter(
            Product.category_id == category.id,
            Product.is_active.is_(True),
        )
        .first()
    )

    if active_product is not None:
        raise CategoryInUseException()

    with UnitOfWork(db):
        category_repo.delete(category)

    return category