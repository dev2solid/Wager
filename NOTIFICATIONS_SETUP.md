# Wager PWA Notifications Setup

This feature has two layers:

- In-app alerts: work while Wager is open after you run the updated `supabase/schema.sql`.
- Real push notifications: also need VAPID keys, the Supabase Edge Function, and a Database Webhook.

## 1. Run SQL

Run the latest `supabase/schema.sql` in your Supabase SQL editor.

This adds:

- `push_subscriptions`
- `notification_events`
- notification triggers for feed posts, wagers, settlements, and circle joins
- RLS and Realtime publication for in-app alerts

## 2. Generate VAPID keys

Run:

```bash
npx web-push generate-vapid-keys
```

Put the public key in:

- local `.env.local`: `VITE_VAPID_PUBLIC_KEY=...`
- Vercel Production env var: `VITE_VAPID_PUBLIC_KEY`

Put the private key only in Supabase Edge Function secrets.

## 3. Set Supabase Edge Function secrets

In Supabase Dashboard, go to Edge Functions secrets and add:

```bash
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:your-email@example.com
NOTIFICATION_WEBHOOK_SECRET=make-a-long-random-string
SUPABASE_SERVICE_ROLE_KEY=...
```

Do not put the service role key in Vercel or browser env vars.

## 4. Deploy the Edge Function

```bash
supabase functions deploy send-notifications --project-ref haarxazlbiftznqeqpig
```

## 5. Create the Database Webhook

In Supabase Dashboard:

- Database > Webhooks > Create webhook
- Table: `notification_events`
- Event: `Insert`
- Method: `POST`
- URL: `https://haarxazlbiftznqeqpig.supabase.co/functions/v1/send-notifications`
- Header: `x-wager-webhook-secret: <your NOTIFICATION_WEBHOOK_SECRET>`

After that, users can open the profile menu and tap `Enable Notifications`.
