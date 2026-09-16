import pytest
import base64
from fastapi.testclient import TestClient
from main import app
from app.api.dependencies import get_auth_context, AuthContext
from app.services.application_service import application_service


@pytest.fixture
def test_client():
    return TestClient(app)


@pytest.fixture
def mock_jwt_auth():
    test_ctx = AuthContext(
        auth_type="jwt",
        organization_id="d01132c0-0330-4f33-a1cf-7ed7a25cf22f",
        user_id="d01132c0-0330-4f33-a1cf-7ed7a25cf22f",
        scopes=["*"],
        environment="live",
        whatsapp_number="+919876543210"
    )
    app.dependency_overrides[get_auth_context] = lambda: test_ctx
    yield test_ctx
    app.dependency_overrides.pop(get_auth_context, None)


def test_create_application_with_whatsapp_and_credentials(test_client, mock_jwt_auth):
    """Verifies that application creation produces Client ID, Client Secret, API Key, and links WhatsApp number."""
    payload = {
        "name": "CRM Production Gateway App",
        "description": "Integration for CRM bulk messaging",
        "environment": "live",
        "whatsapp_number": "+919876543210",
        "scopes": ["messages:send", "campaigns:write", "campaigns:read", "instances:read", "usage:read"]
    }
    res = test_client.post("/v1/applications", json=payload)
    assert res.status_code == 200, res.text
    data = res.json()

    # Verify all credentials generated
    assert data["client_id"].startswith("unai_client_")
    assert data["raw_api_key"].startswith("wa_live_")
    assert data["client_secret"].startswith("unai_sec_")
    assert data["webhook_secret"].startswith("whsec_")
    assert data["oauth_client_id"].startswith("unai_oauth_")
    assert data["oauth_client_secret"].startswith("oauth_sec_")
    assert data["whatsapp_number"] == "+919876543210"

    app_id = data["id"]

    # Verify credentials masking in GET list
    list_res = test_client.get("/v1/applications")
    assert list_res.status_code == 200
    listed_apps = list_res.json()
    match = next((a for a in listed_apps if a["id"] == app_id), None)
    assert match is not None
    assert "raw_api_key" not in match
    assert "client_secret" not in match
    assert match["client_secret_preview"].startswith("unai_sec_••••")
    assert match["whatsapp_number"] == "+919876543210"


def test_client_credentials_authentication_headers(test_client):
    """Verifies authentication via X-Client-ID and X-Client-Secret headers."""
    app.dependency_overrides.pop(get_auth_context, None)

    app_record, raw_key, raw_sec, raw_oauth = application_service.create_application(
        organization_id="d01132c0-0330-4f33-a1cf-7ed7a25cf22f",
        name="Header Auth Test App",
        whatsapp_number="+919876543210"
    )
    client_id = app_record["client_id"]

    headers = {
        "X-Client-ID": client_id,
        "X-Client-Secret": raw_sec
    }
    res = test_client.get("/v1/auth/verify", headers=headers)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["valid"] is True
    assert data["auth_type"] == "client_credentials"
    assert data["application_id"] == app_record["id"]
    assert data["application"]["client_id"] == client_id


def test_client_credentials_basic_auth(test_client):
    """Verifies authentication via HTTP Basic Auth (base64(client_id:client_secret))."""
    app.dependency_overrides.pop(get_auth_context, None)

    app_record, raw_key, raw_sec, raw_oauth = application_service.create_application(
        organization_id="d01132c0-0330-4f33-a1cf-7ed7a25cf22f",
        name="Basic Auth Test App",
        whatsapp_number="+919876543210"
    )
    client_id = app_record["client_id"]

    creds = f"{client_id}:{raw_sec}"
    b64_creds = base64.b64encode(creds.encode()).decode()

    headers = {
        "Authorization": f"Basic {b64_creds}"
    }
    res = test_client.get("/v1/auth/verify", headers=headers)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["valid"] is True
    assert data["auth_type"] == "client_credentials"


def test_invalid_client_secret(test_client):
    """Verifies that incorrect client credentials return 401 Unauthorized."""
    app.dependency_overrides.pop(get_auth_context, None)

    headers = {
        "X-Client-ID": "unai_client_invalid123",
        "X-Client-Secret": "unai_sec_wrong_secret"
    }
    res = test_client.get("/v1/auth/verify", headers=headers)
    assert res.status_code == 401


def test_whatsapp_status_endpoint_security(test_client, mock_jwt_auth):
    """Verifies that /v1/whatsapp/status never exposes internal Baileys/Playwright session tokens."""
    res = test_client.get("/v1/whatsapp/status")
    assert res.status_code == 200, res.text
    data = res.json()
    assert "status" in data
    assert "is_ready" in data
    assert "qr_code" not in data
    assert "encrypted_credentials" not in data
    assert "encrypted_session_data" not in data


def test_application_test_connection_diagnostics(test_client, mock_jwt_auth):
    """Verifies the live diagnostics endpoint used by the 'Test API Connection' button in the Developer Console."""
    app_record, raw_key, raw_sec, raw_oauth = application_service.create_application(
        organization_id="d01132c0-0330-4f33-a1cf-7ed7a25cf22f",
        name="Diagnostics Check App",
        whatsapp_number="+919876543210"
    )

    res = test_client.post(f"/v1/applications/{app_record['id']}/test-connection")
    assert res.status_code == 200, res.text
    data = res.json()
    assert "success" in data
    assert data["application_id"] == app_record["id"]
    assert len(data["checks"]) == 4

    check_names = [c["name"] for c in data["checks"]]
    assert "Application Status" in check_names
    assert "API Key Configured" in check_names
    assert "WhatsApp Device Connection" in check_names
    assert "API Gateway Route" in check_names


def test_regenerate_client_secret(test_client, mock_jwt_auth):
    """Verifies rotating client secret invalidates old secret and enables new secret."""
    app_record, raw_key, old_sec, raw_oauth = application_service.create_application(
        organization_id="d01132c0-0330-4f33-a1cf-7ed7a25cf22f",
        name="Rotation Check App"
    )
    client_id = app_record["client_id"]

    # Rotate secret (using mock auth)
    rotate_res = test_client.post(f"/v1/applications/{app_record['id']}/regenerate-secret")
    assert rotate_res.status_code == 200
    new_sec = rotate_res.json()["client_secret"]
    assert new_sec != old_sec
    assert new_sec.startswith("unai_sec_")

    # Clear auth override so we test real credential authentication
    app.dependency_overrides.pop(get_auth_context, None)

    # Old secret must fail (401)
    res_old = test_client.get("/v1/auth/verify", headers={"X-Client-ID": client_id, "X-Client-Secret": old_sec})
    assert res_old.status_code == 401

    # New secret must succeed (200)
    res_new = test_client.get("/v1/auth/verify", headers={"X-Client-ID": client_id, "X-Client-Secret": new_sec})
    assert res_new.status_code == 200


def test_unified_send_message_validation(test_client, mock_jwt_auth):
    """Verifies validation on POST /v1/messages/send."""
    # Blank message text
    res = test_client.post("/v1/messages/send", json={"to": "+919876543210", "message": ""})
    assert res.status_code == 422

    # Empty recipients
    res2 = test_client.post("/v1/messages/send", json={"to": [], "message": "Test"})
    assert res2.status_code == 422
