from pydantic import BaseModel, ConfigDict


class WarehouseLocationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    location_code: str
    location_name: str
    location_type: str | None
    is_active: bool


class WarehouseResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    warehouse_code: str
    warehouse_name: str
    warehouse_type: str | None
    is_active: bool
    locations: list[WarehouseLocationResponse] = []
