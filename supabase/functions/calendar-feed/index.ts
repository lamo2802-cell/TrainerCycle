import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Serves a rider's planned sessions as an iCalendar feed, for Google, Apple or Outlook Calendar to
// subscribe to. GET ?token=<settings.calendar_feed_token>. The sessions are stored by the app
// (settings key calendar_feed, see calfeed.js), so this only formats them. No login: the token is
// the secret, and turning the feed off in Settings deletes it.

const esc = (s: string) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
// Lines over 75 octets are folded (RFC 5545 3.1).
const fold = (line: string) => {
  const out: string[] = [];
  let rest = line;
  while (new TextEncoder().encode(rest).length > 75) {
    let n = 74;
    while (new TextEncoder().encode(rest.slice(0, n)).length > 74) n--;
    out.push(rest.slice(0, n));
    rest = " " + rest.slice(n);
  }
  out.push(rest);
  return out.join("\r\n");
};
const ymd = (iso: string) => iso.replace(/-/g, "");
const nextDay = (iso: string) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!/^[A-Za-z0-9-]{20,64}$/.test(token)) return new Response("Not found", { status: 404 });
  const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const { data: tok } = await admin.from("settings").select("user_id").eq("key", "calendar_feed_token").eq("value->>v", token).maybeSingle();
  if (!tok) return new Response("Not found", { status: 404 });
  const { data: feed } = await admin.from("settings").select("value,updated_at").eq("user_id", tok.user_id).eq("key", "calendar_feed").maybeSingle();
  const events: { date: string; title: string; text?: string; url?: string }[] = Array.isArray(feed?.value?.v) ? feed!.value.v : [];
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//TrainerCycle//Training plan//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:TrainerCycle training", "X-PUBLISHED-TTL:PT6H", "REFRESH-INTERVAL;VALUE=DURATION:PT6H"];
  const perDay: Record<string, number> = {};
  events.filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date)).forEach((e) => {
    const n = perDay[e.date] = (perDay[e.date] ?? 0) + 1; // stable per day, so calendars update events in place
    lines.push("BEGIN:VEVENT", `UID:${tok.user_id}-${e.date}-${n}@trainercycle.com`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ymd(e.date)}`, `DTEND;VALUE=DATE:${ymd(nextDay(e.date))}`, "TRANSP:TRANSPARENT",
      `SUMMARY:${esc(e.title)}`, `DESCRIPTION:${esc((e.text ?? "") + (e.url ? "\n" + e.url : ""))}`);
    if (e.url) lines.push(`URL:${esc(e.url)}`);
    lines.push("END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  return new Response(lines.map(fold).join("\r\n") + "\r\n", {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "public, max-age=900", "Content-Disposition": "inline; filename=trainercycle.ics" },
  });
});
