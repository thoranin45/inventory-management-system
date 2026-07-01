from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.exceptions import RequestValidationError
from app.core.exceptions import AppException

from app.routers.product_router import router as product_router
from app.routers.stock_router import router as stock_router
from app.routers.dashboard_router import router as dashboard_router
from app.routers.auth_router import router as auth_router
from app.routers.batch_router import router as batch_router
from app.routers.supplier_router import router as supplier_router
from app.routers.purchase_order_router import router as po_router
from app.routers.code_router import router as code_router
from app.routers.label_router import router as label_router
from app.routers.category_router import router as category_router
from app.routers.customer_router import router as customer_router
from app.routers.sales_order_router import router as sales_order_router
from app.routers.audit_router import router as audit_router
from app.routers.report_router import router as report_router

from app.core.logger import logger
from app.core.exception_handler import (
    http_exception_handler,
    validation_exception_handler,
    app_exception_handler
)

app = FastAPI()

logger.info("Application Started")

app.add_exception_handler(
    AppException,
    app_exception_handler
)

app.add_exception_handler(
    HTTPException,
    http_exception_handler
)

app.add_exception_handler(
    RequestValidationError,
    validation_exception_handler
)

app.mount(
    "/uploads",
    StaticFiles(directory="uploads"),
    name="uploads"
)


@app.get("/")
def root():
    logger.info("Root endpoint called")
    return {"message": "Inventory System Running"}


app.include_router(product_router)
app.include_router(stock_router)
app.include_router(dashboard_router)
app.include_router(auth_router)
app.include_router(batch_router)
app.include_router(supplier_router)
app.include_router(po_router)
app.include_router(code_router)
app.include_router(label_router)
app.include_router(category_router)
app.include_router(customer_router)
app.include_router(sales_order_router)
app.include_router(audit_router)
app.include_router(report_router)