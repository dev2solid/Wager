import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

type WebhookPayload = {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  schema: string;
  record?: NotificationEvent | null;
  old_record?: NotificationEvent | null;
};

type NotificationEvent = {
  id: string;
  circle_id: string | null;
  actor_id: string | null;
  event_type: string;
  title: string;
  body: string;
  url: string;
  metadata: Record<string, unknown>;
};

type PushSubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:hello@wager.local";
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY") || "";
const webhookSecret = Deno.env.get("NOTIFICATION_WEBHOOK_SECRET") || "";

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

function isAuthorized(request: Request) {
  if (!webhookSecret) return false;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const custom = request.headers.get("x-wager-webhook-secret");
  return bearer === webhookSecret || custom === webhookSecret;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!isAuthorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey) {
    return Response.json({ error: "Notification function secrets are not configured." }, { status: 500 });
  }

  const payload = await request.json().catch(() => null) as WebhookPayload | null;
  const event = payload?.record;

  if (!event || payload?.type !== "INSERT" || payload.table !== "notification_events" || !event.circle_id) {
    return Response.json({ ok: true, skipped: true });
  }

  const { data: members, error: membersError } = await supabase
    .from("circle_members")
    .select("user_id")
    .eq("circle_id", event.circle_id)
    .neq("user_id", event.actor_id || "00000000-0000-0000-0000-000000000000");

  if (membersError) {
    return Response.json({ error: membersError.message }, { status: 500 });
  }

  const recipientIds = [...new Set((members || []).map((member) => member.user_id).filter(Boolean))];
  if (recipientIds.length === 0) {
    return Response.json({ ok: true, sent: 0 });
  }

  const { data: subscriptions, error: subscriptionError } = await supabase
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .in("user_id", recipientIds);

  if (subscriptionError) {
    return Response.json({ error: subscriptionError.message }, { status: 500 });
  }

  const message = JSON.stringify({
    title: event.title,
    body: event.body,
    url: event.url || "/",
    eventId: event.id,
    tag: `${event.event_type}-${event.id}`,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
  });

  const expiredIds: string[] = [];
  const results = await Promise.allSettled((subscriptions || []).map(async (row: PushSubscriptionRow) => {
    try {
      await webpush.sendNotification({
        endpoint: row.endpoint,
        keys: {
          p256dh: row.p256dh,
          auth: row.auth,
        },
      }, message);
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) expiredIds.push(row.id);
      throw error;
    }
  }));

  if (expiredIds.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", expiredIds);
  }

  return Response.json({
    ok: true,
    sent: results.filter((result) => result.status === "fulfilled").length,
    failed: results.filter((result) => result.status === "rejected").length,
    removed: expiredIds.length,
  });
});
