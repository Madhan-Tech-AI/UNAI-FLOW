import pytest
import asyncio
from app.core.encryption import encryption_service
from app.core.security import generate_api_key, hash_api_key, verify_api_key_hash, sign_webhook_payload, verify_webhook_signature
from app.core.rate_limiter import RateLimiter
from app.core.exceptions import RateLimitedException, InsufficientScopeException
from app.providers.whatsapp.fake_provider import FakeWhatsAppProvider

def test_encryption_roundtrip():
    """Verify AES-256-GCM encryption and decryption roundtrip."""
    test_session = {
        "session_id": "sess_1234567890",
        "phone_number": "+1234567890",
        "creds": {"token": "secret_abc_xyz", "client_id": 999}
    }
    encrypted_b64 = encryption_service.encrypt(test_session)
    assert isinstance(encrypted_b64, str)
    assert encrypted_b64 != ""
    
    decrypted = encryption_service.decrypt(encrypted_b64)
    assert decrypted["session_id"] == test_session["session_id"]
    assert decrypted["phone_number"] == test_session["phone_number"]
    assert decrypted["creds"]["token"] == "secret_abc_xyz"

def test_api_key_generation_and_hashing():
    """Verify API key structure, prefixes, and constant-time hash comparison."""
    raw_key, prefix, key_hash = generate_api_key("live")
    assert raw_key.startswith("wa_live_")
    assert prefix == raw_key[:12]
    assert verify_api_key_hash(raw_key, key_hash) is True
    assert verify_api_key_hash("wa_live_wrongkey", key_hash) is False

def test_webhook_signing_and_verification():
    """Verify HMAC-SHA256 signature generation and validation."""
    payload = '{"id":"evt_123","type":"message.sent"}'
    secret = "whsec_test_secret_key"
    sig = sign_webhook_payload(payload, secret)
    assert verify_webhook_signature(payload, sig, secret) is True
    assert verify_webhook_signature(payload, "invalid_sig", secret) is False

def test_rate_limiter_sliding_window():
    """Verify rate limiter throws RateLimitedException when exceeding limits."""
    limiter = RateLimiter()
    limiter._redis = None  # Test in-memory engine
    
    # 5 requests allowed
    for _ in range(5):
        limiter.check_rate_limit("test_client", limit=5, window_seconds=10)
        
    # 6th request should fail
    with pytest.raises(RateLimitedException):
        limiter.check_rate_limit("test_client", limit=5, window_seconds=10)

def test_fake_whatsapp_provider_lifecycle():
    """Verify simulated provider QR generation, authentication, and channel discovery."""
    async def _run():
        provider = FakeWhatsAppProvider()
        inst_id = "test_inst_001"
        
        # 1. Create instance
        await provider.create_instance(inst_id)
        
        # 2. Connect and get QR
        status = await provider.connect(inst_id)
        assert status.status == "WAITING_FOR_QR"
        
        qr = await provider.get_qr(inst_id)
        assert qr is not None
        assert qr.qr_data.startswith("data:image/png;base64,")
        
        # 3. Simulate QR scan
        await provider.simulate_scan(inst_id, "+1 (555) 019-2834")
        health = await provider.get_connection_status(inst_id)
        assert health.status == "AUTHENTICATED"
        assert health.is_ready is True
        assert health.phone_number == "+1 (555) 019-2834"
        
        # 4. Discover channels
        channels = await provider.list_channels(inst_id)
        assert len(channels) >= 2
        assert channels[0].newsletter_jid.endswith("@newsletter")
        
        # 5. Publish text post
        result = await provider.send_text(inst_id, channels[0].newsletter_jid, "Hello Subscribers!")
        assert result.success is True
        assert result.message_id.startswith("fake_msg_")

    asyncio.run(_run())
