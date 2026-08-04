from sqlalchemy.orm import Session

from app.models import Customer


class CustomerRepository:
    def __init__(
        self,
        db: Session,
    ):
        self.db = db

    def create(
        self,
        customer: Customer,
    ) -> Customer:
        self.db.add(customer)
        return customer

    def get_all(
        self,
    ) -> list[Customer]:
        return (
            self.db.query(Customer)
            .order_by(Customer.id.asc())
            .all()
        )

    def get_by_id(
        self,
        customer_id: int,
    ) -> Customer | None:
        return (
            self.db.query(Customer)
            .filter(
                Customer.id == customer_id
            )
            .first()
        )

    def get_by_name(
        self,
        customer_name: str,
    ) -> Customer | None:
        return (
            self.db.query(Customer)
            .filter(
                Customer.customer_name == customer_name
            )
            .first()
        )

    def update(
        self,
        customer: Customer,
    ) -> Customer:
        self.db.add(customer)
        return customer

    def delete(
        self,
        customer: Customer,
    ) -> None:
        self.db.delete(customer)