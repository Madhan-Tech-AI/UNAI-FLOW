import time
from typing import Optional, Dict
from app.core.config import settings
from app.core.exceptions import RateLimitedException

class RateLimiter:
    """
    Sliding window rate limiter with Redis backend support and in-memory fallback.
    """
    def __init__(self):
        self._memory_cache: Dict[str, list] = {}
        self._redis = None
        self._init_redis()

    def _init_redis(self):
        try:
            import redis
            if settings.redis_url:
                self._redis = redis.from_url(settings.redis_url, decode_responses=True)
        except Exception:
            self._redis = None

    def check_rate_limit(self, identifier: str, limit: Optional[int] = None, window_seconds: int = 60):
        max_requests = limit or settings.rate_limit_per_minute
        now = time.time()
        
        # Redis rate limiter
        if self._redis:
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
            except Exception:
                pass # Fallback to in-memory

        # In-memory sliding window fallback
        timestamps = self._memory_cache.get(identifier, [])
        cutoff = now - window_seconds
        timestamps = [ts for ts in timestamps if ts > cutoff]
        
        if len(timestamps) >= max_requests:
            self._memory_cache[identifier] = timestamps
            raise RateLimitedException(retry_after=window_seconds)
            
        timestamps.append(now)
        self._memory_cache[identifier] = timestamps

rate_limiter = RateLimiter()
