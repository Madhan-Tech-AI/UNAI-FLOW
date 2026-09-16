from typing import Dict, Any, List, Optional
from datetime import datetime, timezone, timedelta
from app.database.supabase import get_supabase_client
from app.core.logging import logger
from collections import defaultdict


class UsageService:
    def __init__(self):
        self.sb = get_supabase_client()

    def log_request(
        self,
        organization_id: Optional[str],
        api_key_id: Optional[str],
        method: str,
        path: str,
        status_code: int,
        latency_ms: int,
        request_size_bytes: Optional[int] = None,
        response_size_bytes: Optional[int] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        idempotency_key: Optional[str] = None,
        request_id: Optional[str] = None,
        application_id: Optional[str] = None,
    ):
        """Asynchronously or synchronously records an incoming API request."""
        try:
            record = {
                "organization_id": organization_id,
                "api_key_id": api_key_id,
                "application_id": application_id,
                "method": method.upper(),
                "path": path,
                "status_code": status_code,
                "latency_ms": latency_ms,
                "request_size_bytes": request_size_bytes,
                "response_size_bytes": response_size_bytes,
                "ip_address": ip_address,
                "user_agent": user_agent,
                "idempotency_key": idempotency_key,
                "request_id": request_id,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            self.sb.table("api_request_log").insert(record).execute()
        except Exception as e:
            # Never let logging failure break user requests
            logger.warning(f"[USAGE] Failed to log API request: {e}")

    def get_usage_summary(self, organization_id: str, period_type: str = "day", application_id: Optional[str] = None) -> Dict[str, Any]:
        """Calculates API usage aggregate summary and bucketed periods."""
        # Query request logs for past 30 days
        thirty_days_ago = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        try:
            query = (
                self.sb.table("api_request_log")
                .select("status_code, latency_ms, created_at")
                .eq("organization_id", organization_id)
                .gte("created_at", thirty_days_ago)
            )
            if application_id:
                query = query.eq("application_id", application_id)
            res = query.order("created_at", desc=False).execute()
            logs = res.data or []
        except Exception as e:
            logger.warning(f"[USAGE] Failed to fetch request logs: {e}")
            logs = []

        total_requests = len(logs)
        buckets = defaultdict(lambda: {"total": 0, "success": 0, "failed": 0, "latency_sum": 0, "latency_count": 0})

        for row in logs:
            dt_str = row.get("created_at", "")
            code = row.get("status_code", 200)
            latency = row.get("latency_ms") or 0

            # Period grouping
            if period_type == "month":
                bucket_key = dt_str[:7]  # YYYY-MM
            elif period_type == "week":
                try:
                    dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
                    bucket_key = f"{dt.year}-W{dt.isocalendar()[1]:02d}"
                except Exception:
                    bucket_key = dt_str[:10]
            else:
                bucket_key = dt_str[:10]  # YYYY-MM-DD

            b = buckets[bucket_key]
            b["total"] += 1
            if 200 <= code < 400:
                b["success"] += 1
            else:
                b["failed"] += 1
            b["latency_sum"] += latency
            b["latency_count"] += 1

        period_stats = []
        for period, stats in sorted(buckets.items()):
            avg_lat = round(stats["latency_sum"] / stats["latency_count"], 1) if stats["latency_count"] > 0 else None
            period_stats.append({
                "period": period,
                "total_requests": stats["total"],
                "successful_requests": stats["success"],
                "failed_requests": stats["failed"],
                "avg_latency_ms": avg_lat
            })

        # Count active API keys
        try:
            keys_res = (
                self.sb.table("api_keys")
                .select("id", count="exact")
                .eq("organization_id", organization_id)
                .is_("revoked_at", "null")
                .execute()
            )
            active_keys = keys_res.count or 0
        except Exception:
            active_keys = 0

        # Count active webhooks
        try:
            wh_res = (
                self.sb.table("webhooks")
                .select("id", count="exact")
                .eq("organization_id", organization_id)
                .eq("enabled", True)
                .execute()
            )
            active_webhooks = wh_res.count or 0
        except Exception:
            active_webhooks = 0

        # Count campaigns
        try:
            camp_res = (
                self.sb.table("api_campaigns")
                .select("sent_count, failed_count", count="exact")
                .eq("organization_id", organization_id)
                .execute()
            )
            total_campaigns = camp_res.count or 0
            total_sent = sum(c.get("sent_count", 0) for c in (camp_res.data or []))
            total_failed = sum(c.get("failed_count", 0) for c in (camp_res.data or []))
        except Exception:
            total_campaigns = 0
            total_sent = 0
            total_failed = 0

        return {
            "organization_id": organization_id,
            "period_type": period_type,
            "total_requests": total_requests,
            "total_messages_sent": total_sent,
            "total_messages_failed": total_failed,
            "total_campaigns": total_campaigns,
            "active_api_keys": active_keys,
            "active_webhooks": active_webhooks,
            "periods": period_stats
        }

    def get_message_stats(self, organization_id: str, application_id: Optional[str] = None) -> Dict[str, Any]:
        """Delivery statistics breakdown for campaigns and single messages."""
        try:
            query = (
                self.sb.table("api_campaigns")
                .select("message_type, status, total_recipients, sent_count, delivered_count, failed_count")
                .eq("organization_id", organization_id)
            )
            if application_id:
                query = query.eq("application_id", application_id)
            camp_res = query.execute()
            campaigns = camp_res.data or []
        except Exception as e:
            logger.warning(f"[USAGE] Failed to fetch campaign message stats: {e}")
            campaigns = []

        total_sent = 0
        total_delivered = 0
        total_failed = 0
        by_type = defaultdict(int)
        by_status = defaultdict(int)

        for c in campaigns:
            sent = c.get("sent_count", 0)
            deliv = c.get("delivered_count", 0)
            fail = c.get("failed_count", 0)
            mtype = c.get("message_type", "text")
            st = c.get("status", "draft")

            total_sent += sent
            total_delivered += deliv
            total_failed += fail
            by_type[mtype] += sent + deliv + fail
            by_status[st] += 1

        total_attempted = total_sent + total_delivered + total_failed
        delivery_rate = round((total_delivered or total_sent) / total_attempted * 100, 2) if total_attempted > 0 else 0.0

        return {
            "organization_id": organization_id,
            "total_sent": total_sent,
            "total_delivered": total_delivered,
            "total_failed": total_failed,
            "delivery_rate": delivery_rate,
            "by_type": dict(by_type),
            "by_status": dict(by_status)
        }

    def get_usage_by_endpoint(self, organization_id: str, application_id: Optional[str] = None) -> Dict[str, Any]:
        """Calculates breakdown grouped by endpoint and method."""
        try:
            query = (
                self.sb.table("api_request_log")
                .select("path, method, status_code, latency_ms")
                .eq("organization_id", organization_id)
            )
            if application_id:
                query = query.eq("application_id", application_id)
            res = query.limit(2000).execute()
            logs = res.data or []
        except Exception as e:
            logger.warning(f"[USAGE] Failed to fetch endpoint logs: {e}")
            logs = []

        endpoint_map = defaultdict(lambda: {"total": 0, "errors": 0, "latency_sum": 0, "latency_count": 0})
        for r in logs:
            key = (r.get("path", "/"), r.get("method", "GET"))
            st = r.get("status_code", 200)
            lat = r.get("latency_ms") or 0

            endpoint_map[key]["total"] += 1
            if st >= 400:
                endpoint_map[key]["errors"] += 1
            endpoint_map[key]["latency_sum"] += lat
            endpoint_map[key]["latency_count"] += 1

        endpoints = []
        for (path, method), data in sorted(endpoint_map.items(), key=lambda x: x[1]["total"], reverse=True):
            avg_lat = round(data["latency_sum"] / data["latency_count"], 1) if data["latency_count"] > 0 else None
            err_rate = round((data["errors"] / data["total"]) * 100, 2) if data["total"] > 0 else 0.0
            endpoints.append({
                "path": path,
                "method": method,
                "total_requests": data["total"],
                "avg_latency_ms": avg_lat,
                "error_rate": err_rate
            })

        return {
            "organization_id": organization_id,
            "endpoints": endpoints
        }


usage_service = UsageService()
