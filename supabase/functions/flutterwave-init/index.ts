// POST { amount }  (JWT required)  ->  { link, tx_ref }
import { createClient } from "npm:@supabase/supabase-js@2";
import { json, preflight, requireEnv } from "../_shared/http.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
    const auth = req.headers.get("Authorization") ?? "";
    const userClient = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: auth } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user?.email) return json(req, { error: "Please sign in" }, 401);

    const { amount } = await req.json().catch(() => ({}));
    if (!Number.isSafeInteger(amount)) return json(req, { error: "Amount must be a whole number of naira" }, 400);

    // Creates the pending payment row (validates 100..500,000 and rate-limits) as THIS user.
    const { data: init, error } = await userClient.rpc("dg_init_payment", { p_amount: amount });
    if (error) return json(req, { error: error.message }, 400);

    const appUrl = requireEnv("APP_URL");
    const res = await fetch("https://api.flutterwave.com/v3/payments", {
      method: "POST",
      headers: { Authorization: `Bearer ${requireEnv("FLW_SECRET_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        tx_ref: init.tx_ref,
        amount: init.amount,
        currency: "NGN",
        redirect_url: appUrl,
        customer: { email: user.email },
        customizations: { title: "Dream Game coins", description: `${init.amount} coins (1 coin = ₦1)` },
        meta: { user_id: user.id },
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.status !== "success" || !body?.data?.link) {
      return json(req, { error: "Payment provider is unavailable. Please try again." }, 502);
    }
    return json(req, { link: body.data.link, tx_ref: init.tx_ref });
  } catch (e) {
    console.error("flutterwave-init", e);
    return json(req, { error: "Unexpected error" }, 500);
  }
});
