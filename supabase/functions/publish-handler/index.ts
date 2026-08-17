// @ts-ignore Deno import
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const payload = await req.json()
    const { automation_id, event, results } = payload

    console.log(`[Publish Handler Log] Received event: ${event} for automation: ${automation_id}`);
    
    if (results && Array.isArray(results)) {
      results.forEach((r: any) => {
        if (r.status === 'failed') {
          console.error(`❌ Platform [${r.platform}] failed to publish: ${r.error}`);
        } else if (r.demo_mode) {
          console.warn(`⚠️ Platform [${r.platform}] simulated in Demo Mode. Post ID: ${r.post_id}`);
        } else {
          console.log(`** Platform [${r.platform}] published LIVE! Post ID: ${r.post_id}, URL: ${r.post_url}`);
        }
      });
    }
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Edge function logged publish event for automation: ${automation_id} successfully.`,
        data: { automation_id, event }
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )
  } catch (error) {
    const err = error as Error;
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400 
      }
    )
  }
})
