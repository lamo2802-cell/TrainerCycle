import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendPush, type VapidKeys } from "./webpush.ts";

// Session reminders. pg_cron calls this every 15 minutes (header x-cron-secret, see
// supabase/migrations/2026-10-26-session-reminders.sql). For each rider with settings key reminders on, at
// their chosen local time it sends "today's session" to every device in push_subscriptions, and in the
// evening a nudge for a session still not done. The sessions come from settings key calendar_feed, which
// the app stores (calfeed.js), so the plan logic stays in one place. settings key reminders_sent stops repeats.

const VAPID_PUBLIC = "BL5jRJt7KlEPx4aRf-ERpuymdK4temJvPmhwk0WEApyD6DU1rwNyh_DOofFXhdXKKw7RbADZtS5zf8JHyMICH40";
const WINDOW_MIN = 60; // send within an hour of the chosen time, so a late or missed cron run still counts

type Reminders = { on?: boolean; time?: string; tz?: string; missed?: boolean; missedTime?: string };
type FeedEvent = { date: string; title: string; text?: string; url?: string; sport?: string };

const toMins = (hhmm: string | undefined, dflt: number) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : dflt;
};
// Date (YYYY-MM-DD) and minutes past midnight at `when` in the rider's time zone.
function localParts(when: Date, tz: string) {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(when);
  } catch (_) { return localParts(when, "Europe/London"); }
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? "00";
  return { date: `${p("year")}-${p("month")}-${p("day")}`, mins: Number(p("hour")) * 60 + Number(p("minute")) };
}
const due = (now: number, at: number) => now >= at && now < at + WINDOW_MIN;
// Older stored sessions have no sport, so fall back to the title the feed gives them.
const sportOf = (e: FeedEvent) => e.sport ?? (/^Run:/.test(e.title) ? "run" : /^Swim:/.test(e.title) ? "swim" : /^Strength:/.test(e.title) ? "strength" : /^(Ride|Brick):/.test(e.title) ? "ride" : null);
const nameOf = (e: FeedEvent) => e.title.replace(/^(Ride|Run|Swim|Strength|Brick): /, "");

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const secret = async (name: string) => (await admin.rpc("reminder_secret", { secret_name: name })).data as string | null;
  const want = await secret("reminders_cron_secret");
  if (!want || req.headers.get("x-cron-secret") !== want) return new Response("Not found", { status: 404 });
  const jwk = await secret("vapid_private_jwk");
  if (!jwk) return new Response("Push keys missing", { status: 500 });
  const keys: VapidKeys = { publicKey: VAPID_PUBLIC, privateJwk: JSON.parse(jwk), subject: "mailto:support@trainercycle.com" };

  const { data: rows } = await admin.from("settings").select("user_id,value").eq("key", "reminders");
  const now = new Date();
  const log: Record<string, number> = { riders: 0, sent: 0, gone: 0 };
  for (const row of rows ?? []) {
    const r: Reminders = row.value?.v ?? {};
    if (!r.on) continue;
    const local = localParts(now, r.tz || "Europe/London");
    const { data: sentRow } = await admin.from("settings").select("value").eq("user_id", row.user_id).eq("key", "reminders_sent").maybeSingle();
    const sent: { daily?: string; missed?: string } = sentRow?.value?.v ?? {};
    const dailyDue = due(local.mins, toMins(r.time, 7 * 60)) && sent.daily !== local.date;
    const missedDue = r.missed !== false && due(local.mins, toMins(r.missedTime, 20 * 60)) && sent.missed !== local.date;
    if (!dailyDue && !missedDue) continue;
    log.riders++;

    const { data: feed } = await admin.from("settings").select("value").eq("user_id", row.user_id).eq("key", "calendar_feed").maybeSingle();
    const events: FeedEvent[] = (Array.isArray(feed?.value?.v) ? feed!.value.v : []).filter((e: FeedEvent) => e && e.date === local.date);
    // A session counts as done when an activity of the same sport is logged that (local) day.
    const { data: acts } = await admin.from("completed_rides").select("sport,started_at").eq("user_id", row.user_id)
      .gte("started_at", new Date(now.getTime() - 36 * 3600e3).toISOString());
    const doneSports = new Set((acts ?? []).filter((a) => localParts(new Date(a.started_at), r.tz || "Europe/London").date === local.date).map((a) => a.sport || "ride"));
    const todo = events.filter((e) => !doneSports.has(sportOf(e) ?? ""));

    const messages: unknown[] = [];
    if (dailyDue && todo.length) {
      messages.push(todo.length === 1
        ? { title: todo[0].title, body: "Today · " + (todo[0].text ?? "").replace(/\s*\.$/, ""), url: "/index.html", tag: "today-" + local.date }
        : { title: `Today: ${todo.length} sessions`, body: todo.map((e) => e.title).join(" · "), url: "/index.html", tag: "today-" + local.date });
    }
    if (missedDue && todo.length) {
      const first = nameOf(todo[0]) + (todo.length > 1 ? ` and ${todo.length - 1} more` : "");
      messages.push({ title: `Didn't get to ${first}?`, body: "Move it to tomorrow so your plan stays on track.", url: "/index.html?move=" + local.date,
        tag: "missed-" + local.date, actions: [{ action: "move", title: "Move to tomorrow" }] });
    }
    await admin.from("settings").upsert({ user_id: row.user_id, key: "reminders_sent", updated_at: now.toISOString(),
      value: { v: { daily: dailyDue ? local.date : sent.daily, missed: missedDue ? local.date : sent.missed } } }, { onConflict: "user_id,key" });
    if (!messages.length) continue;

    const { data: subs } = await admin.from("push_subscriptions").select("id,endpoint,p256dh,auth").eq("user_id", row.user_id);
    for (const s of subs ?? []) {
      for (const m of messages) {
        let status = 0;
        try { status = await sendPush(s, m, keys); } catch (_) { /* network error: try again next reminder */ }
        if (status === 404 || status === 410) { await admin.from("push_subscriptions").delete().eq("id", s.id); log.gone++; break; }
        if (status >= 200 && status < 300) log.sent++;
      }
    }
  }
  return new Response(JSON.stringify(log), { headers: { "Content-Type": "application/json" } });
});
