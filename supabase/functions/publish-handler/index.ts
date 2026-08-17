import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const payload = await req.json()
    const { platform, post_id, post_url, content } = payload

    console.log(`[Publish Event] Platform: ${platform}, ID: ${post_id}`);
    
    // Custom logic here (e.g. trigger Slack/Discord webhook, send email alert, etc.)
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Edge function processed publish event for ${platform} successfully.`,
        data: { platform, post_id, post_url }
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400 
      }
    )
  }
})
