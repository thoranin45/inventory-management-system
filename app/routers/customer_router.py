from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Customer
from app.schemas.customer_schema import CustomerCreate, CustomerUpdate
from app.core.dependencies import require_admin

router = APIRouter(prefix="/customers", tags=["Customers"])


@router.post("/")
def create_customer(
    data: CustomerCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin)
):
    customer = Customer(
        customer_name=data.customer_name,
        phone=data.phone,
        email=data.email,
        address=data.address
    )

    db.add(customer)
    db.commit()
    db.refresh(customer)

    return {
        "message": "Customer Created",
        "id": customer.id,
        "customer_name": customer.customer_name
    }


@router.get("/")
def get_customers(db: Session = Depends(get_db)):
    return db.query(Customer).all()


@router.get("/{customer_id}")
def get_customer(customer_id: int, db: Session = Depends(get_db)):
    customer = db.query(Customer).filter(
        Customer.id == customer_id
    ).first()

    if customer is None:
        raise HTTPException(status_code=404, detail="Customer not found")

    return customer


@router.put("/{customer_id}")
def update_customer(
    customer_id: int,
    data: CustomerUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin)
):
    customer = db.query(Customer).filter(
        Customer.id == customer_id
    ).first()

    if customer is None:
        raise HTTPException(status_code=404, detail="Customer not found")

    customer.customer_name = data.customer_name
    customer.phone = data.phone
    customer.email = data.email
    customer.address = data.address

    db.commit()
    db.refresh(customer)

    return {
        "message": "Customer Updated",
        "id": customer.id
    }


@router.delete("/{customer_id}")
def delete_customer(
    customer_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin)
):
    customer = db.query(Customer).filter(
        Customer.id == customer_id
    ).first()

    if customer is None:
        raise HTTPException(status_code=404, detail="Customer not found")

    db.delete(customer)
    db.commit()

    return {"message": "Customer Deleted"}