from fastapi.testclient import TestClient


def test_root_endpoint(
    client: TestClient,
) -> None:
    response = client.get("/")

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True
    assert body["message"] == (
        "Inventory Management API is running"
    )
    assert body["data"]["docs"] == "/docs"
    assert body["data"]["redoc"] == "/redoc"
    assert body["data"]["health"] == "/api/v1/health/"


def test_basic_health_endpoint(
    client: TestClient,
) -> None:
    response = client.get("/health")

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True
    assert body["message"] == "Application is healthy"
    assert body["data"]["status"] == "ok"
    assert "service" in body["data"]
    assert "version" in body["data"]


def test_api_v1_health_endpoint(
    client: TestClient,
) -> None:
    response = client.get("/api/v1/health/")

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True
    assert body["data"] is not None


def test_unknown_endpoint(
    client: TestClient,
) -> None:
    response = client.get(
        "/api/v1/not-existing"
    )

    assert response.status_code == 404

    body = response.json()

    assert body["success"] is False
    assert body["message"] == "Not Found"