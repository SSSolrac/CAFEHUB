import { requireSupabaseClient } from "../lib/supabase";
import { asSupabaseError } from "../lib/supabaseErrors";

export const DEFAULT_PUBLIC_BUSINESS_SETTINGS = {
  cafeName: "Happy Tails Pet Cafe",
  businessHours: "Monday - Friday: 8:00 AM - 7:30 PM\nSaturday - Sunday: 8:00 AM - 8:00 PM",
  contactNumber: "0917 520 9713",
  businessEmail: "happytailspetcafe@gmail.com",
  cafeAddress:
    "AMCJ Commercial Building, Bonifacio Drive, Pleasantville\nSubdivision, Phase 1, Ilayang Iyam, Lucena, Philippines, 4301",
  facebookHandle: "Happy Tails Pet Cafe - Lucena",
  instagramHandle: "@happytailspetcafelc",
  logoUrl: "",
};

function asDbError(error, fallback, options) {
  return asSupabaseError(error, {
    fallbackMessage: fallback || "Database request failed.",
    ...options,
  });
}

function asText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function mapBusinessSettingsRow(row) {
  const safe = row && typeof row === "object" ? row : {};
  return {
    cafeName: asText(safe.cafe_name) || DEFAULT_PUBLIC_BUSINESS_SETTINGS.cafeName,
    businessHours: asText(safe.business_hours) || DEFAULT_PUBLIC_BUSINESS_SETTINGS.businessHours,
    contactNumber: asText(safe.contact_number) || DEFAULT_PUBLIC_BUSINESS_SETTINGS.contactNumber,
    businessEmail: asText(safe.business_email) || DEFAULT_PUBLIC_BUSINESS_SETTINGS.businessEmail,
    cafeAddress: asText(safe.cafe_address) || DEFAULT_PUBLIC_BUSINESS_SETTINGS.cafeAddress,
    facebookHandle: asText(safe.facebook_handle) || DEFAULT_PUBLIC_BUSINESS_SETTINGS.facebookHandle,
    instagramHandle: asText(safe.instagram_handle) || DEFAULT_PUBLIC_BUSINESS_SETTINGS.instagramHandle,
    logoUrl: asText(safe.logo_url),
  };
}

export async function getPublicBusinessSettings() {
  const supabase = requireSupabaseClient();
  const { data, error } = await supabase.from("business_settings").select("*").eq("id", 1).maybeSingle();

  if (error) {
    throw asDbError(error, "Unable to load cafe business settings.", { table: "business_settings", operation: "select" });
  }

  if (!data) return { ...DEFAULT_PUBLIC_BUSINESS_SETTINGS };
  return mapBusinessSettingsRow(data);
}

