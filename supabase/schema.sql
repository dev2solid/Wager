-- Wager backend schema for Supabase.
-- Run this in the Supabase SQL editor for your project.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null default 'You',
  avatar_color text not null default '#19D12E',
  balance integer not null default 1000 check (balance >= 0),
  win_streak integer not null default 0 check (win_streak >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
add column if not exists avatar_color text not null default '#19D12E';

create table if not exists public.circles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique default upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8)),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.circle_members (
  circle_id uuid not null references public.circles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (circle_id, user_id)
);

create table if not exists public.feed_posts (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles(id) on delete cascade,
  creator_id uuid not null references auth.users(id) on delete cascade,
  prompt text not null,
  category text not null default 'Community Bet',
  option_a text not null default 'Option A',
  option_b text not null default 'Option B',
  ends_at timestamptz,
  status text not null default 'open' check (status in ('open', 'settled')),
  winning_choice text check (winning_choice in ('A', 'B')),
  created_at timestamptz not null default now()
);

create table if not exists public.feed_wagers (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.feed_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  choice text not null check (choice in ('A', 'B')),
  amount integer not null check (amount > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.private_bets (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles(id) on delete cascade,
  creator_id uuid not null references auth.users(id) on delete cascade,
  opponent_id uuid references auth.users(id) on delete set null,
  what text not null,
  wager text not null,
  amount integer,
  status text not null default 'open' check (status in ('open', 'locked', 'p1_won', 'p2_won', 'disputed')),
  p1_confirmed boolean not null default false,
  p2_confirmed boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.join_circle_by_code(invite_code_input text)
returns table (
  id uuid,
  name text,
  invite_code text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_circle public.circles%rowtype;
  normalized_code text;
begin
  normalized_code := upper(trim(invite_code_input));

  select *
  into target_circle
  from public.circles c
  where c.invite_code = normalized_code;

  if target_circle.id is null then
    raise exception 'Friend circle not found';
  end if;

  insert into public.circle_members (circle_id, user_id, role)
  values (target_circle.id, auth.uid(), 'member')
  on conflict (circle_id, user_id) do nothing;

  return query
  select c.id, c.name, c.invite_code, c.created_at
  from public.circles c
  where c.id = target_circle.id;
end;
$$;

create index if not exists circle_members_user_id_idx on public.circle_members(user_id);
create index if not exists feed_posts_circle_created_idx on public.feed_posts(circle_id, created_at desc);
create index if not exists feed_wagers_post_id_idx on public.feed_wagers(post_id);
create index if not exists private_bets_circle_created_idx on public.private_bets(circle_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.circles enable row level security;
alter table public.circle_members enable row level security;
alter table public.feed_posts enable row level security;
alter table public.feed_wagers enable row level security;
alter table public.private_bets enable row level security;

drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
on public.profiles for select
to authenticated
using (true);

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self"
on public.profiles for insert
to authenticated
with check ((select auth.uid()) = id);

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self"
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "circles_select_member_or_invite" on public.circles;
create policy "circles_select_member_or_invite"
on public.circles for select
to authenticated
using (
  created_by = (select auth.uid())
  or
  exists (
    select 1
    from public.circle_members cm
    where cm.circle_id = id
      and cm.user_id = (select auth.uid())
  )
);

drop policy if exists "circles_insert_creator" on public.circles;
create policy "circles_insert_creator"
on public.circles for insert
to authenticated
with check ((select auth.uid()) = created_by);

drop policy if exists "circle_members_select_same_circle" on public.circle_members;
create policy "circle_members_select_same_circle"
on public.circle_members for select
to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1
    from public.circle_members mine
    where mine.circle_id = circle_members.circle_id
      and mine.user_id = (select auth.uid())
  )
);

drop policy if exists "circle_members_insert_self" on public.circle_members;
create policy "circle_members_insert_self"
on public.circle_members for insert
to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "feed_posts_select_circle_member" on public.feed_posts;
create policy "feed_posts_select_circle_member"
on public.feed_posts for select
to authenticated
using (
  exists (
    select 1
    from public.circle_members cm
    where cm.circle_id = feed_posts.circle_id
      and cm.user_id = (select auth.uid())
  )
);

drop policy if exists "feed_posts_insert_circle_member" on public.feed_posts;
create policy "feed_posts_insert_circle_member"
on public.feed_posts for insert
to authenticated
with check (
  creator_id = (select auth.uid())
  and exists (
    select 1
    from public.circle_members cm
    where cm.circle_id = feed_posts.circle_id
      and cm.user_id = (select auth.uid())
  )
);

drop policy if exists "feed_posts_update_creator" on public.feed_posts;
create policy "feed_posts_update_creator"
on public.feed_posts for update
to authenticated
using (creator_id = (select auth.uid()))
with check (creator_id = (select auth.uid()));

drop policy if exists "feed_wagers_select_circle_member" on public.feed_wagers;
create policy "feed_wagers_select_circle_member"
on public.feed_wagers for select
to authenticated
using (
  exists (
    select 1
    from public.feed_posts fp
    join public.circle_members cm on cm.circle_id = fp.circle_id
    where fp.id = feed_wagers.post_id
      and cm.user_id = (select auth.uid())
  )
);

drop policy if exists "feed_wagers_insert_circle_member_self" on public.feed_wagers;
create policy "feed_wagers_insert_circle_member_self"
on public.feed_wagers for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.feed_posts fp
    join public.circle_members cm on cm.circle_id = fp.circle_id
    where fp.id = feed_wagers.post_id
      and fp.status = 'open'
      and cm.user_id = (select auth.uid())
  )
);

drop policy if exists "private_bets_select_circle_member" on public.private_bets;
create policy "private_bets_select_circle_member"
on public.private_bets for select
to authenticated
using (
  exists (
    select 1
    from public.circle_members cm
    where cm.circle_id = private_bets.circle_id
      and cm.user_id = (select auth.uid())
  )
);

drop policy if exists "private_bets_insert_circle_member" on public.private_bets;
create policy "private_bets_insert_circle_member"
on public.private_bets for insert
to authenticated
with check (
  creator_id = (select auth.uid())
  and exists (
    select 1
    from public.circle_members cm
    where cm.circle_id = private_bets.circle_id
      and cm.user_id = (select auth.uid())
  )
);

drop policy if exists "private_bets_update_participant" on public.private_bets;
create policy "private_bets_update_participant"
on public.private_bets for update
to authenticated
using (
  creator_id = (select auth.uid())
  or opponent_id = (select auth.uid())
)
with check (
  creator_id = (select auth.uid())
  or opponent_id = (select auth.uid())
);

grant select, insert, update on public.profiles to authenticated;
grant select, insert on public.circles to authenticated;
grant select, insert on public.circle_members to authenticated;
grant select, insert, update on public.feed_posts to authenticated;
grant select, insert on public.feed_wagers to authenticated;
grant select, insert, update on public.private_bets to authenticated;
grant execute on function public.join_circle_by_code(text) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'feed_posts'
    ) then
      alter publication supabase_realtime add table public.feed_posts;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'feed_wagers'
    ) then
      alter publication supabase_realtime add table public.feed_wagers;
    end if;
  end if;
end $$;
