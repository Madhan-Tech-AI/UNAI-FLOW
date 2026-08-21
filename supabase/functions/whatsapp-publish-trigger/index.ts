// @ts-nocheck
declare const Deno: any;

// @ts-ignore Deno import
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore ESM import
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const WCA_API_URL = Deno.env.get("WCA_API_URL") || "https://unai-whatsapp-channelapi.onrender.com";
const WCA_API_KEY = Deno.env.get("WCA_API_KEY") || "105eadef-beae-4e08-bcc0-85a06ff80727";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    console.log("[WhatsApp Publish Trigger] Received event payload:", JSON.stringify(body).slice(0, 300));

    // Support both Supabase Database Webhook payload ({ record, type, table }) and direct invocation
    const record = body.record || body;
    const jobId = record.id || record.job_id;
    const connectionId = record.connection_id || record.connectionId || "default_primary_session";
    const channelId = record.channel_id || record.channelId;
    const content = record.content || record.caption || record.text || "";
    const mediaUrl = record.media_url || record.mediaUrl || null;
    const automationId = record.automation_id || record.automationId || null;

    if (!channelId && !record.channel_name) {
      return new Response(
        JSON.stringify({ success: false, error: "channel_id is required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // 1. If this is a queued job, mark as processing
    if (jobId) {
      await supabase
        .from("whatsapp_publish_jobs")
        .update({ status: "processing", updated_at: new Date().toISOString() })
        .eq("id", jobId);
    }

    // 2. Format payload for UNAI WhatsApp Gateway
    const publishPayload = {
      channelId: channelId,
      text: content,
      caption: content,
      mediaUrl: mediaUrl,
      type: mediaUrl ? (mediaUrl.includes(".mp4") ? "video" : "image") : "text",
    };

    console.log(`[WhatsApp Publish Trigger] Dispatching to Gateway: ${WCA_API_URL} for channel ${channelId}`);

    // Try V1 route first, fallback to legacy
    let gatewayResp = await fetch(
      `${WCA_API_URL}/v1/whatsapp/connections/${connectionId}/channels/${channelId}/publish`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": WCA_API_KEY,
        },
        body: JSON.stringify(publishPayload),
      }
    );

    if (gatewayResp.status === 404) {
      // Fallback to /api/channel/publish
      gatewayResp = await fetch(`${WCA_API_URL}/api/channel/publish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": WCA_API_KEY,
        },
        body: JSON.stringify(publishPayload),
      });
    }

    const gatewayData = await gatewayResp.json().catch(() => ({}));
    console.log("[WhatsApp Publish Trigger] Gateway Response:", JSON.stringify(gatewayData));

    if (gatewayResp.ok && (gatewayData.success || gatewayData.messageId || gatewayData.postId)) {
      const postId = gatewayData.postId || gatewayData.messageId || `wa_${Date.now()}`;
      const publishedAt = gatewayData.publishedAt || gatewayData.timestamp || new Date().toISOString();

      // 3. Mark success in DB
      if (jobId) {
        await supabase
          .from("whatsapp_publish_jobs")
          .update({
            status: "success",
            platform_post_id: postId,
            published_at: publishedAt,
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId);
      }

      // Also record in published_posts if automation_id exists
      if (automationId) {
        try {
          await supabase.from("published_posts").insert({
            automation_id: automationId,
            platform: "whatsapp",
            post_id: postId,
            post_url: `https://whatsapp.com/channel/${String(channelId).split("@")[0]}`,
            content: content,
          });
        } catch (e) {
          console.warn("published_posts log note:", e);
        }
      }

      // 4. Send Realtime broadcast event
      try {
        const channel = supabase.channel("whatsapp_realtime_events");
        await channel.send({
          type: "broadcast",
          event: "post_published",
          payload: {
            jobId,
            postId,
            channelId,
            status: "success",
            publishedAt,
          },
        });
      } catch (rtErr) {
        console.warn("Realtime broadcast note:", rtErr);
      }

      return new Response(
        JSON.stringify({
          success: true,
          status: "success",
          postId,
          publishedAt,
          channelId,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    } else {
      const errorMsg = gatewayData.detail || gatewayData.error || gatewayData.message || "Failed to publish via WhatsApp Gateway";
      
      if (jobId) {
        await supabase
          .from("whatsapp_publish_jobs")
          .update({
            status: "failed",
            last_error: String(errorMsg),
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId);
      }

      return new Response(
        JSON.stringify({ success: false, error: errorMsg }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }
  } catch (err: any) {
    console.error("[WhatsApp Publish Trigger Error]:", err);
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
