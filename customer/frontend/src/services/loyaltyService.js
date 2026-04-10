import { requireSupabaseClient } from "../lib/supabase";
import { asSupabaseError } from "../lib/supabaseErrors";
import { getSession } from "./authService";

function asDbError(error, fallback, options) {
  return asSupabaseError(error, {
    fallbackMessage: fallback || "Database request failed.",
    ...options,
  });
}

function normalizeReward(reward) {
  return {
    id: String(reward?.id || ""),
    label: String(reward?.label || ""),
    requiredStamps: Number(reward?.required_stamps ?? 0),
  };
}

async function getUserOrNull() {
  const session = await getSession();
  return session?.user || null;
}

export async function getCustomerLoyaltyData() {
  const supabase = requireSupabaseClient();
  const user = await getUserOrNull();
  if (!user) return null;

  const { data: account, error: accountError } = await supabase
    .from("loyalty_accounts")
    .select("*")
    .eq("customer_id", user.id)
    .maybeSingle();

  if (accountError) throw asDbError(accountError, "Unable to load loyalty account.", { table: "loyalty_accounts", operation: "select" });

  const stampCount = Number(account?.stamp_count ?? 0);

  const { data: rewards, error: rewardsError } = await supabase
    .from("loyalty_rewards")
    .select("*")
    .eq("is_active", true)
    .order("required_stamps", { ascending: true });

  if (rewardsError) throw asDbError(rewardsError, "Unable to load loyalty rewards.", { table: "loyalty_rewards", operation: "select" });

  const allRewards = (Array.isArray(rewards) ? rewards : []).map(normalizeReward);
  const availableRewards = allRewards.filter((reward) => reward.requiredStamps <= stampCount);

  const { data: redemptions, error: redemptionsError } = await supabase
    .from("loyalty_redemptions")
    .select("*")
    .eq("customer_id", user.id)
    .order("redeemed_at", { ascending: false });

  if (redemptionsError) throw asDbError(redemptionsError, "Unable to load loyalty redemptions.", { table: "loyalty_redemptions", operation: "select" });

  const redeemedRewardIds = new Set(
    (Array.isArray(redemptions) ? redemptions : [])
      .map((row) => row.reward_id || row.rewardId)
      .filter(Boolean)
      .map(String)
  );

  const redeemedRewards = allRewards.filter((reward) => redeemedRewardIds.has(String(reward.id)));

  return {
    customerId: user.id,
    stampCount,
    availableRewards,
    redeemedRewards,
    updatedAt: String(account?.updated_at || ""),
  };
}
