-- Wager backend schema for Supabase.
-- Run this in the Supabase SQL editor for your project.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null default 'You',
  avatar_color text not null default '#19D12E',
  avatar_url text,
  balance integer not null default 1000 check (balance >= 0),
  win_streak integer not null default 0 check (win_streak >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
add column if not exists avatar_color text not null default '#19D12E';

alter table public.profiles
add column if not exists avatar_url text;

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
  image_url text,
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

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid references public.circles(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in ('feed_post_created', 'feed_wager_created', 'feed_post_settled', 'circle_member_joined')),
  title text not null,
  body text not null,
  url text not null default '/',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.feed_posts
add column if not exists image_url text;

insert into storage.buckets (id, name, public)
values ('wager-images', 'wager-images', true)
on conflict (id) do update set public = true;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'feed_posts_creator_profile_fkey'
  ) then
    alter table public.feed_posts
    add constraint feed_posts_creator_profile_fkey
    foreign key (creator_id) references public.profiles(id) on delete cascade
    not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'feed_wagers_user_profile_fkey'
  ) then
    alter table public.feed_wagers
    add constraint feed_wagers_user_profile_fkey
    foreign key (user_id) references public.profiles(id) on delete cascade
    not valid;
  end if;
end $$;

drop function if exists public.ensure_profile(text, text);

create or replace function public.ensure_profile(username_input text default null, avatar_color_input text default null, avatar_url_input text default null)
returns table (
  id uuid,
  username text,
  avatar_color text,
  avatar_url text,
  balance integer,
  win_streak integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_row public.profiles%rowtype;
  display_name text;
  safe_avatar_color text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  display_name := coalesce(nullif(trim(username_input), ''), split_part(auth.jwt() ->> 'email', '@', 1), 'You');
  safe_avatar_color := coalesce(nullif(trim(avatar_color_input), ''), '#19D12E');

  insert into public.profiles (id, username, avatar_color, avatar_url)
  values (auth.uid(), display_name, safe_avatar_color, nullif(trim(avatar_url_input), ''))
  on conflict on constraint profiles_pkey do update
  set
    username = excluded.username,
    avatar_color = excluded.avatar_color,
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
    updated_at = now()
  returning * into profile_row;

  return query
  select
    profile_row.id,
    profile_row.username,
    profile_row.avatar_color,
    profile_row.avatar_url,
    profile_row.balance,
    profile_row.win_streak,
    profile_row.created_at,
    profile_row.updated_at;
end;
$$;

create or replace function public.is_circle_member(circle_id_input uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.circle_members cm
    where cm.circle_id = circle_id_input
      and cm.user_id = auth.uid()
  );
$$;

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
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  normalized_code := upper(regexp_replace(trim(invite_code_input), '[^A-Za-z0-9]', '', 'g'));

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

create or replace function public.create_circle(circle_name_input text, invite_code_input text default null)
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
  circle_name text;
  normalized_code text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  circle_name := coalesce(nullif(trim(circle_name_input), ''), 'Friends Feed');
  normalized_code := nullif(upper(regexp_replace(coalesce(invite_code_input, ''), '[^A-Za-z0-9]', '', 'g')), '');

  if normalized_code is null then
    insert into public.circles (name, created_by)
    values (circle_name, auth.uid())
    returning * into target_circle;
  else
    insert into public.circles (name, invite_code, created_by)
    values (circle_name, normalized_code, auth.uid())
    returning * into target_circle;
  end if;

  insert into public.circle_members (circle_id, user_id, role)
  values (target_circle.id, auth.uid(), 'owner')
  on conflict (circle_id, user_id) do update set role = 'owner';

  return query
  select c.id, c.name, c.invite_code, c.created_at
  from public.circles c
  where c.id = target_circle.id;
end;
$$;

create or replace function public.place_feed_wager(post_id_input uuid, choice_input text, amount_input integer)
returns table (
  id uuid,
  post_id uuid,
  user_id uuid,
  choice text,
  amount integer,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_post public.feed_posts%rowtype;
  created_wager public.feed_wagers%rowtype;
  wallet_balance integer;
  reserved_balance integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if choice_input not in ('A', 'B') then
    raise exception 'Choose A or B';
  end if;

  if amount_input is null or amount_input <= 0 then
    raise exception 'Enter a wager amount';
  end if;

  select *
  into target_post
  from public.feed_posts fp
  where fp.id = post_id_input;

  if target_post.id is null then
    raise exception 'Feed post not found';
  end if;

  if target_post.status <> 'open' then
    raise exception 'This market is already settled';
  end if;

  if not exists (
    select 1
    from public.circle_members cm
    where cm.circle_id = target_post.circle_id
      and cm.user_id = auth.uid()
  ) then
    raise exception 'You are not in this friend circle';
  end if;

  select p.balance
  into wallet_balance
  from public.profiles p
  where p.id = auth.uid()
  for update;

  if wallet_balance is null then
    raise exception 'Profile not found';
  end if;

  select coalesce(sum(fw.amount), 0)
  into reserved_balance
  from public.feed_wagers fw
  join public.feed_posts fp on fp.id = fw.post_id
  where fw.user_id = auth.uid()
    and fp.status = 'open';

  if amount_input > wallet_balance - reserved_balance then
    raise exception 'Insufficient BetCoin';
  end if;

  insert into public.feed_wagers (post_id, user_id, choice, amount)
  values (target_post.id, auth.uid(), choice_input, amount_input)
  returning * into created_wager;

  return query
  select created_wager.id, created_wager.post_id, created_wager.user_id, created_wager.choice, created_wager.amount, created_wager.created_at;
end;
$$;

create or replace function public.settle_feed_post(post_id_input uuid, winning_choice_input text)
returns table (
  id uuid,
  circle_id uuid,
  creator_id uuid,
  prompt text,
  category text,
  option_a text,
  option_b text,
  ends_at timestamptz,
  status text,
  winning_choice text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_post public.feed_posts%rowtype;
  settled_post public.feed_posts%rowtype;
  winning_pool integer;
  losing_pool integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if winning_choice_input not in ('A', 'B') then
    raise exception 'Choose A or B';
  end if;

  select *
  into target_post
  from public.feed_posts fp
  where fp.id = post_id_input
  for update;

  if target_post.id is null then
    raise exception 'Feed post not found';
  end if;

  if target_post.creator_id <> auth.uid() then
    raise exception 'Only the creator can settle this market';
  end if;

  if target_post.status <> 'open' then
    raise exception 'This market is already settled';
  end if;

  select
    coalesce(sum(amount) filter (where choice = winning_choice_input), 0),
    coalesce(sum(amount) filter (where choice <> winning_choice_input), 0)
  into winning_pool, losing_pool
  from public.feed_wagers
  where post_id = target_post.id;

  if winning_pool > 0 and losing_pool > 0 then
    update public.profiles p
    set
      balance = greatest(0, p.balance - losses.amount),
      win_streak = 0,
      updated_at = now()
    from (
      select user_id, sum(amount)::integer as amount
      from public.feed_wagers
      where post_id = target_post.id
        and choice <> winning_choice_input
      group by user_id
    ) losses
    where p.id = losses.user_id;

    update public.profiles p
    set
      balance = p.balance + winners.share,
      win_streak = p.win_streak + 1,
      updated_at = now()
    from (
      with winner_amounts as (
        select user_id, sum(amount)::integer as amount
        from public.feed_wagers
        where post_id = target_post.id
          and choice = winning_choice_input
        group by user_id
      ),
      base_shares as (
        select
          user_id,
          amount,
          floor((amount::numeric / winning_pool::numeric) * losing_pool::numeric)::integer as base_share
        from winner_amounts
      ),
      remainder as (
        select losing_pool - coalesce(sum(base_share), 0)::integer as extra
        from base_shares
      ),
      ranked_winners as (
        select
          user_id,
          base_share,
          row_number() over (order by amount desc, user_id asc) as winner_rank
        from base_shares
      )
      select
        rw.user_id,
        rw.base_share + case when rw.winner_rank <= r.extra then 1 else 0 end as share
      from ranked_winners rw
      cross join remainder r
    ) winners
    where p.id = winners.user_id;
  end if;

  update public.feed_posts fp
  set status = 'settled', winning_choice = winning_choice_input
  where fp.id = target_post.id
  returning * into settled_post;

  return query
  select
    settled_post.id,
    settled_post.circle_id,
    settled_post.creator_id,
    settled_post.prompt,
    settled_post.category,
    settled_post.option_a,
    settled_post.option_b,
    settled_post.ends_at,
    settled_post.status,
    settled_post.winning_choice,
    settled_post.created_at;
end;
$$;

create or replace function public.create_wager_notification_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_circle public.circles%rowtype;
  target_post public.feed_posts%rowtype;
  actor_name text;
  choice_label text;
begin
  if tg_table_name = 'feed_posts' and tg_op = 'INSERT' then
    select * into target_circle from public.circles c where c.id = new.circle_id;

    insert into public.notification_events (circle_id, actor_id, event_type, title, body, url, metadata)
    values (
      new.circle_id,
      new.creator_id,
      'feed_post_created',
      'New bet in ' || coalesce(target_circle.name, 'Wager'),
      new.prompt,
      '/',
      jsonb_build_object('post_id', new.id)
    );

    return new;
  end if;

  if tg_table_name = 'feed_wagers' and tg_op = 'INSERT' then
    select * into target_post from public.feed_posts fp where fp.id = new.post_id;
    select username into actor_name from public.profiles p where p.id = new.user_id;
    choice_label := case when new.choice = 'A' then target_post.option_a else target_post.option_b end;

    insert into public.notification_events (circle_id, actor_id, event_type, title, body, url, metadata)
    values (
      target_post.circle_id,
      new.user_id,
      'feed_wager_created',
      coalesce(actor_name, 'Someone') || ' placed a bet',
      coalesce(actor_name, 'Someone') || ' put ' || new.amount::text || ' BetCoin on ' || coalesce(choice_label, 'a side') || '.',
      '/',
      jsonb_build_object('post_id', new.post_id, 'wager_id', new.id, 'choice', new.choice, 'amount', new.amount)
    );

    return new;
  end if;

  if tg_table_name = 'feed_posts' and tg_op = 'UPDATE' then
    if old.status <> 'settled' and new.status = 'settled' then
      choice_label := case when new.winning_choice = 'A' then new.option_a else new.option_b end;

      insert into public.notification_events (circle_id, actor_id, event_type, title, body, url, metadata)
      values (
        new.circle_id,
        new.creator_id,
        'feed_post_settled',
        'Market settled',
        new.prompt || ' settled: ' || coalesce(choice_label, 'winner picked') || ' won.',
        '/',
        jsonb_build_object('post_id', new.id, 'winning_choice', new.winning_choice)
      );
    end if;

    return new;
  end if;

  return new;
end;
$$;

create or replace function public.create_circle_join_notification_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_circle public.circles%rowtype;
  actor_name text;
begin
  select * into target_circle from public.circles c where c.id = new.circle_id;
  select username into actor_name from public.profiles p where p.id = new.user_id;

  insert into public.notification_events (circle_id, actor_id, event_type, title, body, url, metadata)
  values (
    new.circle_id,
    new.user_id,
    'circle_member_joined',
    coalesce(actor_name, 'Someone') || ' joined ' || coalesce(target_circle.name, 'your circle'),
    coalesce(actor_name, 'Someone') || ' is now in the friend feed.',
    '/',
    jsonb_build_object('circle_id', new.circle_id)
  );

  return new;
end;
$$;

drop trigger if exists feed_posts_notification_insert on public.feed_posts;
create trigger feed_posts_notification_insert
after insert on public.feed_posts
for each row execute function public.create_wager_notification_event();

drop trigger if exists feed_posts_notification_settle on public.feed_posts;
create trigger feed_posts_notification_settle
after update of status, winning_choice on public.feed_posts
for each row execute function public.create_wager_notification_event();

drop trigger if exists feed_wagers_notification_insert on public.feed_wagers;
create trigger feed_wagers_notification_insert
after insert on public.feed_wagers
for each row execute function public.create_wager_notification_event();

drop trigger if exists circle_members_notification_insert on public.circle_members;
create trigger circle_members_notification_insert
after insert on public.circle_members
for each row execute function public.create_circle_join_notification_event();

create index if not exists circle_members_user_id_idx on public.circle_members(user_id);
create index if not exists feed_posts_circle_created_idx on public.feed_posts(circle_id, created_at desc);
create index if not exists feed_wagers_post_id_idx on public.feed_wagers(post_id);
create index if not exists private_bets_circle_created_idx on public.private_bets(circle_id, created_at desc);
create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions(user_id);
create index if not exists notification_events_circle_created_idx on public.notification_events(circle_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.circles enable row level security;
alter table public.circle_members enable row level security;
alter table public.feed_posts enable row level security;
alter table public.feed_wagers enable row level security;
alter table public.private_bets enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_events enable row level security;

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
  or public.is_circle_member(id)
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
  or public.is_circle_member(circle_members.circle_id)
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
  public.is_circle_member(feed_posts.circle_id)
);

drop policy if exists "feed_posts_insert_circle_member" on public.feed_posts;
create policy "feed_posts_insert_circle_member"
on public.feed_posts for insert
to authenticated
with check (
  creator_id = (select auth.uid())
  and public.is_circle_member(feed_posts.circle_id)
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
    where fp.id = feed_wagers.post_id
      and public.is_circle_member(fp.circle_id)
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
    where fp.id = feed_wagers.post_id
      and fp.status = 'open'
      and public.is_circle_member(fp.circle_id)
  )
);

drop policy if exists "private_bets_select_circle_member" on public.private_bets;
create policy "private_bets_select_circle_member"
on public.private_bets for select
to authenticated
using (
  public.is_circle_member(private_bets.circle_id)
);

drop policy if exists "private_bets_insert_circle_member" on public.private_bets;
create policy "private_bets_insert_circle_member"
on public.private_bets for insert
to authenticated
with check (
  creator_id = (select auth.uid())
  and public.is_circle_member(private_bets.circle_id)
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

drop policy if exists "wager_images_select_public" on storage.objects;
create policy "wager_images_select_public"
on storage.objects for select
to public
using (bucket_id = 'wager-images');

drop policy if exists "wager_images_insert_own_folder" on storage.objects;
create policy "wager_images_insert_own_folder"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'wager-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "wager_images_update_own_folder" on storage.objects;
create policy "wager_images_update_own_folder"
on storage.objects for update
to authenticated
using (
  bucket_id = 'wager-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'wager-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "wager_images_delete_own_folder" on storage.objects;
create policy "wager_images_delete_own_folder"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'wager-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "push_subscriptions_select_self" on public.push_subscriptions;
create policy "push_subscriptions_select_self"
on public.push_subscriptions for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "push_subscriptions_insert_self" on public.push_subscriptions;
create policy "push_subscriptions_insert_self"
on public.push_subscriptions for insert
to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "push_subscriptions_update_self" on public.push_subscriptions;
create policy "push_subscriptions_update_self"
on public.push_subscriptions for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "push_subscriptions_delete_self" on public.push_subscriptions;
create policy "push_subscriptions_delete_self"
on public.push_subscriptions for delete
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "notification_events_select_circle_member" on public.notification_events;
create policy "notification_events_select_circle_member"
on public.notification_events for select
to authenticated
using (
  circle_id is not null
  and public.is_circle_member(notification_events.circle_id)
);

revoke all on public.profiles from anon, authenticated;
revoke all on public.circles from anon, authenticated;
revoke all on public.circle_members from anon, authenticated;
revoke all on public.feed_posts from anon, authenticated;
revoke all on public.feed_wagers from anon, authenticated;
revoke all on public.private_bets from anon, authenticated;
revoke all on public.push_subscriptions from anon, authenticated;
revoke all on public.notification_events from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (username, avatar_color, avatar_url, updated_at) on public.profiles to authenticated;
grant select on public.circles to authenticated;
grant select on public.circle_members to authenticated;
grant select, insert on public.feed_posts to authenticated;
grant select on public.feed_wagers to authenticated;
grant select on public.private_bets to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select on public.notification_events to authenticated;
revoke all on function public.join_circle_by_code(text) from public, anon;
revoke all on function public.ensure_profile(text, text, text) from public, anon;
revoke all on function public.is_circle_member(uuid) from public, anon;
revoke all on function public.create_circle(text, text) from public, anon;
revoke all on function public.place_feed_wager(uuid, text, integer) from public, anon;
revoke all on function public.settle_feed_post(uuid, text) from public, anon;
revoke all on function public.create_wager_notification_event() from public, anon;
revoke all on function public.create_circle_join_notification_event() from public, anon;
grant execute on function public.join_circle_by_code(text) to authenticated;
grant execute on function public.ensure_profile(text, text, text) to authenticated;
grant execute on function public.is_circle_member(uuid) to authenticated;
grant execute on function public.create_circle(text, text) to authenticated;
grant execute on function public.place_feed_wager(uuid, text, integer) to authenticated;
grant execute on function public.settle_feed_post(uuid, text) to authenticated;

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

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'notification_events'
    ) then
      alter publication supabase_realtime add table public.notification_events;
    end if;
  end if;
end $$;

notify pgrst, 'reload schema';
