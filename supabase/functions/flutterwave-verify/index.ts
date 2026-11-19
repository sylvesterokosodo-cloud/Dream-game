// POST { transaction_id, tx_ref } (JWT required). Called when the player returns
// from Flutterwave so coins appear immediately; the webhook is the backstop.
import { createClient } from "npm:@supabase/supabase-js@2";
import { json, preflight, requireEnv } from "../_shared/http.ts";
import { verifyAndCredit } from "../_shared/flutterwave.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
    const userClient = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json(req, { error: "Please sign in" }, 401);

    const { transaction_id, tx_ref } = await req.json().catch(() => ({}));
    const service = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const result = await verifyAndCredit(service, String(transaction_id ?? ""), String(tx_ref ?? ""), user.id);
    return json(req, result, result.ok ? 200 : 202);
  } catch (e) {
    console.error("flutterwave-verify", e);
    return json(req, { error: "Unexpected error" }, 500);
  }
});
