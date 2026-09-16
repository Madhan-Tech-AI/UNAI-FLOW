import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
from main import app
import uuid

client = TestClient(app)

VERCEL_ORIGIN = "https://unai-flow-rc39.vercel.app"


# ------------------------------------------------------------------------------
# 1. CORS Preflight & Error Response Tests
# ------------------------------------------------------------------------------

def test_cors_options_preflight():
    """Verify that OPTIONS preflight request to /v1/applications returns proper CORS headers."""
    response = client.options(
        "/v1/applications",
        headers={
            "Origin": VERCEL_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type,idempotency-key,x-request-id",
        }
    )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == VERCEL_ORIGIN
    assert "POST" in response.headers.get("access-control-allow-methods", "")
    assert response.headers.get("access-control-allow-credentials") == "true"


def test_cors_on_401_unauthorized():
    """Verify that 401 Unauthorized returns structured JSON AND CORS headers for Vercel."""
    response = client.post(
        "/v1/applications",
        json={"name": "Test Application"},
        headers={"Origin": VERCEL_ORIGIN}
    )
    assert response.status_code == 401
    assert response.headers.get("access-control-allow-origin") == VERCEL_ORIGIN
    assert response.headers.get("access-control-allow-credentials") == "true"
    data = response.json()
    assert "error" in data
    assert data["error"]["code"] == "UNAUTHORIZED"
    assert "request_id" in data["error"]


def test_cors_on_422_validation_error():
    """Verify that 422 Validation Error returns structured error AND CORS headers."""
    # Test with invalid environment and invalid scopes
    fake_token = "fake.jwt.token"
    with patch("app.api.dependencies.verify_jwt", return_value={"user_id": str(uuid.uuid4())}):
        response = client.post(
            "/v1/applications",
            json={
                "name": "",  # Empty name violates min_length=1
                "environment": "invalid_env",
                "scopes": ["invalid:scope_xyz"]
            },
            headers={
                "Origin": VERCEL_ORIGIN,
                "Authorization": f"Bearer {fake_token}"
            }
        )
        assert response.status_code == 422
        assert response.headers.get("access-control-allow-origin") == VERCEL_ORIGIN
        data = response.json()
        assert "error" in data
        assert data["error"]["code"] == "VALIDATION_ERROR"
        assert "request_id" in data["error"]


def test_cors_on_500_internal_server_error():
    """Verify that unexpected 500 errors still receive CORS headers and X-Request-ID."""
    fake_token = "fake.jwt.token"
    test_org_id = str(uuid.uuid4())

    with patch("app.api.dependencies.verify_jwt", return_value={"user_id": test_org_id}):
        with patch("app.services.application_service.application_service.create_application", side_effect=RuntimeError("Simulated database crash")):
            response = client.post(
                "/v1/applications",
                json={"name": "Crash Test App"},
                headers={
                    "Origin": VERCEL_ORIGIN,
                    "Authorization": f"Bearer {fake_token}"
                }
            )
            assert response.status_code == 500
            assert response.headers.get("access-control-allow-origin") == VERCEL_ORIGIN
            assert response.headers.get("access-control-allow-credentials") == "true"
            data = response.json()
            assert "error" in data
            assert data["error"]["code"] == "INTERNAL_SERVER_ERROR"
            assert data["error"]["request_id"] != ""
            # Verify no internal traceback leaked in JSON
            assert "Simulated database crash" not in data["error"]["message"]


# ------------------------------------------------------------------------------
# 2. Application Creation & Credential Security Tests
# ------------------------------------------------------------------------------

def test_create_application_success():
    """Verify successful application creation returns one-time raw API key, client_id, and prefix."""
    fake_token = "fake.jwt.token"
    test_org_id = str(uuid.uuid4())
    mock_app = {
        "id": str(uuid.uuid4()),
        "organization_id": test_org_id,
        "client_id": "unai_client_test1234567890abcdef",
        "name": "Production HubSpot Sync",
        "description": "Syncs contacts and messages",
        "environment": "live",
        "status": "active",
        "default_instance_id": None,
        "scopes": ["messages:send", "campaigns:read"],
        "_api_key_prefix": "wa_live_abcd",
        "_api_key_count": 1,
        "_webhook_count": 0,
        "webhook_secret": "whsec_0123456789abcdef",
        "created_at": "2026-09-16T12:00:00Z",
        "updated_at": "2026-09-16T12:00:00Z",
    }
    raw_key = "wa_live_abcd123456789012345678901234"

    with patch("app.api.dependencies.verify_jwt", return_value={"user_id": test_org_id}):
        with patch("app.services.application_service.application_service.create_application", return_value=(mock_app, raw_key)):
            response = client.post(
                "/v1/applications",
                json={
                    "name": "Production HubSpot Sync",
                    "description": "Syncs contacts and messages",
                    "environment": "live",
                    "scopes": ["messages:send", "campaigns:read"]
                },
                headers={
                    "Origin": VERCEL_ORIGIN,
                    "Authorization": f"Bearer {fake_token}",
                    "Idempotency-Key": "idemp_test_001"
                }
            )
            assert response.status_code == 200
            assert response.headers.get("access-control-allow-origin") == VERCEL_ORIGIN
            data = response.json()
            assert data["name"] == "Production HubSpot Sync"
            assert data["client_id"] == "unai_client_test1234567890abcdef"
            assert data["raw_api_key"] == raw_key
            assert data["api_key_prefix"] == "wa_live_abcd"
            assert data["webhook_secret"] == "whsec_0123456789abcdef"


def test_list_applications_does_not_expose_raw_keys():
    """Verify that listing applications never returns raw secrets or hashes."""
    fake_token = "fake.jwt.token"
    test_org_id = str(uuid.uuid4())
    mock_apps = [
        {
            "id": str(uuid.uuid4()),
            "organization_id": test_org_id,
            "client_id": "unai_client_111",
            "name": "App One",
            "environment": "live",
            "status": "active",
            "scopes": ["messages:send"],
            "api_key_count": 1,
            "webhook_count": 0,
            "created_at": "2026-09-16T12:00:00Z"
        }
    ]

    with patch("app.api.dependencies.verify_jwt", return_value={"user_id": test_org_id}):
        with patch("app.services.application_service.application_service.list_applications", return_value=mock_apps):
            response = client.get(
                "/v1/applications",
                headers={
                    "Origin": VERCEL_ORIGIN,
                    "Authorization": f"Bearer {fake_token}"
                }
            )
            assert response.status_code == 200
            data = response.json()
            assert len(data) == 1
            # Check security: raw_api_key or key_hash must never be in list response
            assert "raw_api_key" not in data[0]
            assert "key_hash" not in data[0]


def test_credentials_endpoint_security():
    """Verify that the credentials display endpoint only returns prefix and non-secrets."""
    fake_token = "fake.jwt.token"
    test_org_id = str(uuid.uuid4())
    app_id = str(uuid.uuid4())
    mock_creds = {
        "client_id": "unai_client_safe",
        "api_key_prefix": "wa_live_safe",
        "webhook_secret": "whsec_test_secret",
        "environment": "live",
    }

    with patch("app.api.dependencies.verify_jwt", return_value={"user_id": test_org_id}):
        with patch("app.services.application_service.application_service.get_credentials", return_value=mock_creds):
            response = client.get(
                f"/v1/applications/{app_id}/credentials",
                headers={
                    "Origin": VERCEL_ORIGIN,
                    "Authorization": f"Bearer {fake_token}"
                }
            )
            assert response.status_code == 200
            data = response.json()
            assert data["client_id"] == "unai_client_safe"
            assert data["api_key_prefix"] == "wa_live_safe"
            assert "raw_api_key" not in data
            assert "key_hash" not in data


def test_get_applications_empty_list():
    """Verify that an organization with 0 applications returns 200 and empty list with CORS."""
    fake_token = "fake.jwt.token"
    test_org_id = str(uuid.uuid4())

    with patch("app.api.dependencies.verify_jwt", return_value={"user_id": test_org_id}):
        with patch("app.services.application_service.application_service.list_applications", return_value=[]):
            response = client.get(
                "/v1/applications",
                headers={
                    "Origin": VERCEL_ORIGIN,
                    "Authorization": f"Bearer {fake_token}"
                }
            )
            assert response.status_code == 200
            assert response.headers.get("access-control-allow-origin") == VERCEL_ORIGIN
            assert response.json() == []


def test_get_applications_503_structured_response():
    """Verify that unexpected database failure in list_applications returns 503 with CORS and Request ID."""
    fake_token = "fake.jwt.token"
    test_org_id = str(uuid.uuid4())

    with patch("app.api.dependencies.verify_jwt", return_value={"user_id": test_org_id}):
        with patch("app.services.application_service.application_service.list_applications", side_effect=Exception("Database connection timeout")):
            response = client.get(
                "/v1/applications",
                headers={
                    "Origin": VERCEL_ORIGIN,
                    "Authorization": f"Bearer {fake_token}"
                }
            )
            assert response.status_code == 503
            assert response.headers.get("access-control-allow-origin") == VERCEL_ORIGIN
            data = response.json()
            assert "error" in data
            assert data["error"]["code"] == "SERVICE_UNAVAILABLE"
            assert "request_id" in data["error"]


def test_post_application_then_immediate_get():
    """Verify end-to-end contract: create application followed immediately by list_applications."""
    fake_token = "fake.jwt.token"
    test_org_id = str(uuid.uuid4())
    app_id = str(uuid.uuid4())
    mock_app = {
        "id": app_id,
        "organization_id": test_org_id,
        "client_id": "unai_client_immediate_001",
        "name": "Immediate Integration",
        "description": "Created and listed immediately",
        "environment": "live",
        "status": "active",
        "default_instance_id": None,
        "scopes": ["messages:send"],
        "_api_key_prefix": "wa_live_imm",
        "_api_key_count": 1,
        "_webhook_count": 0,
        "webhook_secret": "whsec_imm_secret",
        "created_at": "2026-09-16T12:00:00Z",
        "updated_at": "2026-09-16T12:00:00Z",
    }
    raw_key = "wa_live_imm_secret_token_12345"

    with patch("app.api.dependencies.verify_jwt", return_value={"user_id": test_org_id}):
        with patch("app.services.application_service.application_service.create_application", return_value=(mock_app, raw_key)):
            post_res = client.post(
                "/v1/applications",
                json={"name": "Immediate Integration"},
                headers={
                    "Origin": VERCEL_ORIGIN,
                    "Authorization": f"Bearer {fake_token}"
                }
            )
            assert post_res.status_code == 200
            assert post_res.json()["client_id"] == "unai_client_immediate_001"

        with patch("app.services.application_service.application_service.list_applications", return_value=[mock_app]):
            get_res = client.get(
                "/v1/applications",
                headers={
                    "Origin": VERCEL_ORIGIN,
                    "Authorization": f"Bearer {fake_token}"
                }
            )
            assert get_res.status_code == 200
            assert len(get_res.json()) == 1
            assert get_res.json()[0]["client_id"] == "unai_client_immediate_001"
            assert get_res.headers.get("access-control-allow-origin") == VERCEL_ORIGIN

