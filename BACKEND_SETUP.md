# Wager Backend Setup

This app can still run as a local prototype without Supabase env vars. To make it live:

1. Create a Supabase project.
2. Open the Supabase SQL editor and run `supabase/schema.sql`.
3. Copy `.env.example` to `.env.local`.
4. Fill in:

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-or-anon-key
```

5. Restart Vite with `npm run dev`.

## Friend-Only Feed Model

The live feed is not global. It is scoped by `circles`:

- `circles`: private friend rooms.
- `circle_members`: who can see a room.
- `feed_posts`: every feed bet belongs to one circle.
- `feed_wagers`: bets on feed posts.

Row-level security only allows members of a circle to see its posts and wagers.

## Current Backend Scope

Implemented now:

- Supabase client setup.
- Email/password auth UI with access-code onboarding.
- Lightweight profiles with display name, generated avatar color, balance, and streak.
- Feed posts saved to Supabase by circle.
- Feed wagers saved to Supabase by circle.
- Invite-code joining for private friend circles.
- Realtime refresh for feed posts and wagers.

Next backend hardening:

- Move wallet balance changes into a server-side transaction.
- Persist private one-on-one bets in Supabase.
- Add deployment env vars on Vercel.

For the smooth private-beta signup flow, turn off required email confirmation in Supabase Auth settings. If it stays on, the app will ask the user to confirm email first and then join the saved friend code after login.
