import { normalizeError } from '@/lib/errors';
import { requireSupabaseClient } from '@/lib/supabase';

export type BusinessSettings = {
  cafeName: string;
  businessHours: string;
  contactNumber: string;
  businessEmail: string;
  cafeAddress: string;
  facebookHandle: string;
  instagramHandle: string;
  logoUrl: string;
  updatedAt: string;
};

type BusinessSettingsInput = Omit<BusinessSettings, 'updatedAt'>;

const DEFAULT_BUSINESS_SETTINGS: BusinessSettings = {
  cafeName: 'Happy Tails Pet Cafe',
  businessHours: 'Monday - Friday: 8:00 AM - 7:30 PM\nSaturday - Sunday: 8:00 AM - 8:00 PM',
  contactNumber: '0917 520 9713',
  businessEmail: 'happytailspetcafe@gmail.com',
  cafeAddress: 'AMCJ Commercial Building, Bonifacio Drive, Pleasantville\nSubdivision, Phase 1, Ilayang Iyam, Lucena, Philippines, 4301',
  facebookHandle: 'Happy Tails Pet Cafe - Lucena',
  instagramHandle: '@happytailspetcafelc',
  logoUrl: '',
  updatedAt: '',
};

const asText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

const mapBusinessSettingsRow = (row: unknown): BusinessSettings => {
  const record = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
  return {
    cafeName: asText(record.cafe_name) || DEFAULT_BUSINESS_SETTINGS.cafeName,
    businessHours: asText(record.business_hours) || DEFAULT_BUSINESS_SETTINGS.businessHours,
    contactNumber: asText(record.contact_number) || DEFAULT_BUSINESS_SETTINGS.contactNumber,
    businessEmail: asText(record.business_email) || DEFAULT_BUSINESS_SETTINGS.businessEmail,
    cafeAddress: asText(record.cafe_address) || DEFAULT_BUSINESS_SETTINGS.cafeAddress,
    facebookHandle: asText(record.facebook_handle) || DEFAULT_BUSINESS_SETTINGS.facebookHandle,
    instagramHandle: asText(record.instagram_handle) || DEFAULT_BUSINESS_SETTINGS.instagramHandle,
    logoUrl: asText(record.logo_url),
    updatedAt: asText(record.updated_at),
  };
};

export const businessSettingsService = {
  async getBusinessSettings(): Promise<BusinessSettings> {
    const supabase = requireSupabaseClient();
    const { data, error } = await supabase.from('business_settings').select('*').eq('id', 1).maybeSingle();
    if (error) throw normalizeError(error, { fallbackMessage: 'Unable to load business settings.' });
    if (!data) return { ...DEFAULT_BUSINESS_SETTINGS };
    return mapBusinessSettingsRow(data);
  },

  async saveBusinessSettings(settings: BusinessSettingsInput): Promise<BusinessSettings> {
    const supabase = requireSupabaseClient();
    const { data: authData } = await supabase.auth.getUser();

    const payload = {
      id: 1,
      cafe_name: asText(settings.cafeName) || DEFAULT_BUSINESS_SETTINGS.cafeName,
      business_hours: asText(settings.businessHours) || DEFAULT_BUSINESS_SETTINGS.businessHours,
      contact_number: asText(settings.contactNumber) || DEFAULT_BUSINESS_SETTINGS.contactNumber,
      business_email: asText(settings.businessEmail) || DEFAULT_BUSINESS_SETTINGS.businessEmail,
      cafe_address: asText(settings.cafeAddress) || DEFAULT_BUSINESS_SETTINGS.cafeAddress,
      facebook_handle: asText(settings.facebookHandle) || DEFAULT_BUSINESS_SETTINGS.facebookHandle,
      instagram_handle: asText(settings.instagramHandle) || DEFAULT_BUSINESS_SETTINGS.instagramHandle,
      logo_url: asText(settings.logoUrl) || null,
      updated_by: authData?.user?.id || null,
    };

    const { data, error } = await supabase.from('business_settings').upsert(payload, { onConflict: 'id' }).select('*').single();
    if (error) throw normalizeError(error, { fallbackMessage: 'Unable to save business settings.' });
    return mapBusinessSettingsRow(data);
  },
};

