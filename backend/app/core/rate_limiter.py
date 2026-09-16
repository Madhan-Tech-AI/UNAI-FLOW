import time
import logging
from typing import Optional, Dict
from app.core.config import settings
from app.core.exceptions import RateLimitedException

logger = logging.getLogger("unai_whatsapp_gateway")


class RateLimiter:
    """
    Sliding window rate limiter with Redis backend support and in-memory fallback.
    Guarantees non-blocking execution with sub-millisecond fallback when Redis
    is unavailable or not explicitly provisioned.
    """

    def __init__(self):
        self._memory_cache: Dict[str, list] = {}
        self._redis = None
        self._redis_available = False
        self._init_redis()

    def _init_redis(self):
        try:
            # Only connect to Redis if an external/cloud redis_url is provided
            # and not a default localhost placeholder
            redis_url = getattr(settings, "redis_url", "")
            if redis_url and not ("localhost" in redis_url or "127.0.0.1" in redis_url):
                
                # pyrefly: ignore [missing-import]
                import redis
                client = redis.from_url(
                    redis_url,
                    decode_responses=True,
                    socket_connect_timeout=0.2,
                    socket_timeout=0.2,
                )
                client.ping()
                self._redis = client
                self._redis_available = True
                logger.info("[RATE_LIMITER] Connected to Redis backend.")
            else:
                self._redis = None
                self._redis_available = False
        except Exception as e:
            logger.info(f"[RATE_LIMITER] External Redis unavailable ({e}), using in-memory engine.")
            self._redis = None
            self._redis_available = False

    def check_rate_limit(self, identifier: str, limit: Optional[int] = None, window_seconds: int = 60):
        max_requests = limit or getattr(settings, "rate_limit_per_minute", 100)
        now = time.time()

        # 1. Fast Redis rate limiter (only if verified available)
        if self._redis_available and self._redis:
            try:
                key = f"ratelimit:{identifier}"
                pipeline = self._redis.pipeline()
                pipeline.zremrangebyscore(key, 0, now - window_seconds)
                pipeline.zadd(key, {str(now): now})
                pipeline.zcard(key)
                pipeline.expire(key, window_seconds)
                _, _, count, _ = pipeline.execute()

                if count > max_requests:
                    raise RateLimitedException(retry_after=window_seconds)
                return
            except RateLimitedException:
                raise
            except Exception as e:
                # Disable Redis on unexpected network error to protect the event loop from latency spikes
                logger.warning(f"[RATE_LIMITER] Redis command failed ({e}), falling back to in-memory.")
                self._redis_available = False

        # 2. In-memory sliding window fallback (runs in microseconds)
        timestamps = self._memory_cache.get(identifier, [])
        cutoff = now - window_seconds
        timestamps = [ts for ts in timestamps if ts > cutoff]

        if len(timestamps) >= max_requests:
            self._memory_cache[identifier] = timestamps
            raise RateLimitedException(retry_after=window_seconds)

        timestamps.append(now)
        self._memory_cache[identifier] = timestamps


rate_limiter = RateLimiter()
