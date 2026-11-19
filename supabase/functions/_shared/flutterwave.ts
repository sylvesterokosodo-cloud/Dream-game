import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { requireEnv } from "./http.ts";

const FLW = "https://api.flutterwave.com/v3";

export type VerifyResult =
  | { ok: true; status: "credited" | "already_credited"; coins: number }
  | { ok: false; status: "pending" | "failed" | "rejected" | "unknown"; reason: string };

/**
 * NEVER trusts the browser or the webhook body. Asks Flutterwave (with the
 * secret key) for the transaction, checks tx_ref / status / currency / amount,
 * and only then calls the service-role-only SQL function that credits coins.
 */
export async function verifyAndCredit(
  service: SupabaseClient,
  transactionId: string,
  txRef: string,
  expectedUserId?: string
): Promise<VerifyResult> {
  if (!/^\d{1,20}$/.test(transactionId) || !/^DG-[a-f0-9]{32}$/.test(txRef)) {
    return { ok: false, status: "unknown", reason: "bad_reference" };
  }

  const { data: payment } = await service
    .from("dg_payments")
    .select("id,user_id,status,amount_ngn")
    .eq("tx_ref", txRef)
    .maybeSingle();
  if (!payment) return { ok: false, status: "unknown", reason: "unknown_tx_ref" };
  if (expectedUserId && payment.user_id !== expectedUserId) {
    return { ok: false, status: "unknown", reason: "not_your_payment" };
  }
  if (payment.status === "successful") {
    const { data } = await service.rpc("dg_credit_purchase", {
      p_tx_ref: txRef, p_flw_id: transactionId, p_amount: payment.amount_ngn, p_currency: "NGN",
    });
    return { ok: true, status: "already_credited", coins: Number(data?.coins ?? payment.amount_ngn) };
  }

  const res = await fetch(`${FLW}/transactions/${transactionId}/verify`, {
    headers: { Authorization: `Bearer ${requireEnv("FLW_SECRET_KEY")}` },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.status !== "success" || !body?.data) {
    return { ok: false, status: "pending", reason: "flutterwave_lookup_failed" };
  }
  const d = body.data;
  if (d.tx_ref !== txRef) return { ok: false, status: "rejected", reason: "tx_ref_mismatch" };
  if (d.status === "failed" || d.status === "cancelled") {
    await service.from("dg_payments").update({ status: "failed", verified_at: new Date().toISOString() })
      .eq("id", payment.id).eq("status", "pending");
    return { ok: false, status: "failed", reason: String(d.status) };
  }
  if (d.status !== "successful") return { ok: false, status: "pending", reason: String(d.status) };

  const { data, error } = await service.rpc("dg_credit_purchase", {
    p_tx_ref: txRef,
    p_flw_id: String(d.id),
    p_amount: Number(d.amount),
    p_currency: String(d.currency),
  });
  if (error) return { ok: false, status: "failed", reason: error.message };
  if (data?.status === "rejected") return { ok: false, status: "rejected", reason: String(data.reason) };
  return { ok: true, status: data.status, coins: Number(data.coins) };
}
