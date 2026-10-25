import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Handles Strava's OAuth redirect: exchanges the authorization code for tokens
// and stores them against the user, identified via the `state` param (their Supabase user id).
// No Supabase JWT is present on this request (it's an external browser redirect from Strava),
// so this function must NOT require JWT verification.

const CLIENT_ID = Deno.env.get("STRAVA_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("STRAVA_CLIENT_SECRET") ?? "";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

function redirect(url: string) {
  return new Response(null, { status: 302, headers: { Location: url } });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state"); // Supabase user id
  const error = url.searchParams.get("error");
  const grantedScope = url.searchParams.get("scope"); // e.g. "read,activity:write,activity:read_all"
  const returnBase = url.searchParams.get("return") || "https://trainercycle.com/rides.html";

  if (error) {
    return redirect(`${returnBase}?strava=denied`);
  }
  if (!code || !state) {
    return redirect(`${returnBase}?strava=error`);
  }
  // Strava lets people untick "upload activities" on the consent screen. Without activity:write
  // every upload fails with 403, so don't store a connection that can't work.
  if (grantedScope !== null && !grantedScope.split(",").includes("activity:write")) {
    console.error("strava-oauth-callback: activity:write not granted, scope =", grantedScope);
    return redirect(`${returnBase}?strava=noscope`);
  }

  try {
    const tokenResp = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenResp.ok) {
      console.error("Strava token exchange failed:", await tokenResp.text());
      return redirect(`${returnBase}?strava=error`);
    }
    const tokenData = await tokenResp.json();

    await supabaseAdmin.from("strava_connections").upsert({
      user_id: state,
      strava_athlete_id: tokenData.athlete?.id ?? null,
      athlete_firstname: tokenData.athlete?.firstname ?? null,
      athlete_lastname: tokenData.athlete?.lastname ?? null,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: tokenData.expires_at,
      // What the rider allowed: activity:read_all is needed to import runs (strava-import).
      scope: grantedScope,
      connected_at: new Date().toISOString(),
    });

    return redirect(`${returnBase}?strava=connected`);
  } catch (err) {
    console.error("strava-oauth-callback error:", err);
    return redirect(`${returnBase}?strava=error`);
  }
});
