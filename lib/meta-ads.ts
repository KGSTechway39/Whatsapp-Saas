// Meta Marketing API helpers for Click-to-WhatsApp Ads (CTWA) integration.
// Uses Graph API v22.0. Provide a long-lived user access token with
// scopes: ads_read, ads_management, business_management.

const GRAPH = "https://graph.facebook.com/v22.0";

export interface FBAdAccount {
  id: string;             // act_<numeric>
  account_id: string;     // numeric only
  name: string;
  currency: string;
  business?: { id: string; name: string };
  account_status: number;
}

export interface FBCampaign {
  id: string;
  name: string;
  objective: string;
  status: string;
  start_time?: string;
  stop_time?: string;
}

export interface FBInsight {
  campaign_id: string;
  spend: string;
  impressions: string;
  clicks: string;
  ctr: string;
  cpm: string;
  date_start: string;
  date_stop: string;
}

export class MetaAdsError extends Error {
  status: number;
  fbCode?: number;
  constructor(message: string, status = 500, fbCode?: number) {
    super(message);
    this.status = status;
    this.fbCode = fbCode;
  }
}

async function fbFetch<T>(path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${GRAPH}${path}`);
  url.searchParams.set("access_token", token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = (data as { error?: { message?: string; code?: number } }).error;
    throw new MetaAdsError(err?.message || `Graph API error (${res.status})`, res.status, err?.code);
  }
  return data as T;
}

/** Exchange short-lived token for a long-lived (~60-day) one. */
export async function exchangeForLongLivedToken(shortToken: string): Promise<{ access_token: string; expires_in: number }> {
  const url = new URL(`${GRAPH}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", process.env.NEXT_PUBLIC_META_APP_ID || "");
  url.searchParams.set("client_secret", process.env.META_APP_SECRET || "");
  url.searchParams.set("fb_exchange_token", shortToken);

  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (data as { error?: { message?: string } }).error;
    throw new MetaAdsError(err?.message || "Token exchange failed", res.status);
  }
  return data as { access_token: string; expires_in: number };
}

/** List ad accounts the user has access to. */
export async function listAdAccounts(token: string): Promise<FBAdAccount[]> {
  const data = await fbFetch<{ data: FBAdAccount[] }>("/me/adaccounts", token, {
    fields: "id,account_id,name,currency,business{id,name},account_status",
    limit: "50",
  });
  return data.data;
}

/** List campaigns inside one ad account. */
export async function listCampaigns(adAccountId: string, token: string): Promise<FBCampaign[]> {
  const data = await fbFetch<{ data: FBCampaign[] }>(`/${adAccountId}/campaigns`, token, {
    fields: "id,name,objective,status,start_time,stop_time",
    limit: "100",
  });
  return data.data;
}

/** Pull campaign-level insights (spend, impressions, clicks, ctr, cpm) for given range. */
export async function getCampaignInsights(
  adAccountId: string,
  token: string,
  range: { since: string; until: string },
): Promise<FBInsight[]> {
  const data = await fbFetch<{ data: FBInsight[] }>(`/${adAccountId}/insights`, token, {
    level: "campaign",
    fields: "campaign_id,spend,impressions,clicks,ctr,cpm",
    time_range: JSON.stringify(range),
    limit: "200",
  });
  return data.data;
}

/** Build a Facebook OAuth login URL for Marketing API access. */
export function buildOAuthUrl(redirectUri: string, state: string): string {
  const url = new URL("https://www.facebook.com/v22.0/dialog/oauth");
  url.searchParams.set("client_id", process.env.NEXT_PUBLIC_META_APP_ID || "");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", "ads_read,ads_management,business_management");
  url.searchParams.set("response_type", "code");
  return url.toString();
}

/** Exchange OAuth code for an access token. */
export async function exchangeCodeForToken(code: string, redirectUri: string): Promise<{ access_token: string; expires_in: number }> {
  const url = new URL(`${GRAPH}/oauth/access_token`);
  url.searchParams.set("client_id", process.env.NEXT_PUBLIC_META_APP_ID || "");
  url.searchParams.set("client_secret", process.env.META_APP_SECRET || "");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code", code);

  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (data as { error?: { message?: string } }).error;
    throw new MetaAdsError(err?.message || "Code exchange failed", res.status);
  }
  return data as { access_token: string; expires_in: number };
}
