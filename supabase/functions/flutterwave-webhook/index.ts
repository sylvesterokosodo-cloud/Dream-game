// Flutterwave -> us. Deployed with verify_jwt = false (see supabase/config.toml);
// authenticity is proven by the secret hash header AND by re-verifying with the API.
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireEnv, safeEqual } from "../_shared/http.ts";
import { verifyAndCredit } from "../_shared/flutterwave.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  try {
    const sent = req.headers.get("verif-hash") ?? "";
    if (!safeEqual(sent, requireEnv("FLW_WEBHOOK_SECRET_HASH"))) {
      return new Response("Unauthorized", { status: 401 });
    }
    const event = await req.json().catch(() => null);
    if (event?.event === "charge.completed" && event?.data?.id && event?.data?.tx_ref) {
      const service = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"));
      const r = await verifyAndCredit(service, String(event.data.id), String(event.data.tx_ref));
      console.log("webhook", event.data.tx_ref, r.ok ? r.status : `${r.status}:${r.reason}`);
      // Non-2xx makes Flutterwave retry; only ask for a retry when still pending.
      if (!r.ok && r.status === "pending") return new Response("retry", { status: 503 });
    }
    return new Response("ok", { status: 200 });
  } catch (e) {
    console.error("flutterwave-webhook", e);
    return new Response("error", { status: 500 });
  }
});
