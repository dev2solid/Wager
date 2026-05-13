import { isSupabaseConfigured, supabase } from "./supabaseClient.js";

const BETCOIN = "BetCoin";

const genInviteName = () => `Circle ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
const DEFAULT_AVATAR_COLOR = "#19D12E";

export const backendEnabled = isSupabaseConfigured;

export async function getCurrentSession() {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export function onAuthChanged(callback) {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}

export async function signInWithEmail(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUpWithEmail(email, password, username, avatarColor = DEFAULT_AVATAR_COLOR) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { username, avatar_color: avatarColor } },
  });
  if (error) throw error;
  if (data.session && data.user) await ensureProfile(data.user, username, avatarColor);
  return data;
}

export async function signUpAndJoinCircle({ email, password, username, inviteCode, avatarColor }) {
  const data = await signUpWithEmail(email, password, username, avatarColor);
  if (!data.session) {
    return { ...data, pendingEmailConfirmation: true };
  }
  const profile = await ensureProfile(data.user, username, avatarColor);
  try {
    const circle = await joinCircleByInviteCode(inviteCode);
    return { ...data, profile, circle, pendingEmailConfirmation: false };
  } catch (error) {
    return { ...data, profile, circle: null, joinError: error, pendingEmailConfirmation: false };
  }
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function ensureProfile(user, username = null, avatarColor = null) {
  const profile = {
    id: user.id,
    username: username || user.user_metadata?.username || user.email?.split("@")[0] || "You",
    avatar_color: avatarColor || user.user_metadata?.avatar_color || DEFAULT_AVATAR_COLOR,
  };
  const { data, error } = await supabase
    .from("profiles")
    .upsert(profile, { onConflict: "id" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateProfile(userId, changes) {
  const { data, error } = await supabase
    .from("profiles")
    .update({
      ...changes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function listCircles() {
  const { data, error } = await supabase
    .from("circles")
    .select("id, name, invite_code, created_at")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createCircle(userId, name = genInviteName()) {
  const { data: circle, error: circleError } = await supabase
    .from("circles")
    .insert({ name, created_by: userId })
    .select("id, name, invite_code, created_at")
    .single();
  if (circleError) throw circleError;

  const { error: memberError } = await supabase
    .from("circle_members")
    .insert({ circle_id: circle.id, user_id: userId, role: "owner" });
  if (memberError) throw memberError;

  return circle;
}

export async function joinCircleByInviteCode(inviteCode) {
  const { data, error } = await supabase.rpc("join_circle_by_code", {
    invite_code_input: inviteCode.trim().toUpperCase(),
  });
  if (error) throw error;
  return data?.[0] || null;
}

export async function listFeedPosts(circleId) {
  const { data, error } = await supabase
    .from("feed_posts")
    .select(`
      id,
      circle_id,
      creator_id,
      prompt,
      category,
      option_a,
      option_b,
      ends_at,
      status,
      winning_choice,
      created_at,
      profiles:creator_id(username, avatar_color),
      feed_wagers(
        id,
        user_id,
        choice,
        amount,
        created_at,
        profiles:user_id(username, avatar_color)
      )
    `)
    .eq("circle_id", circleId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(mapFeedPost);
}

export async function createFeedPost(circleId, userId, draft) {
  const { data, error } = await supabase
    .from("feed_posts")
    .insert({
      circle_id: circleId,
      creator_id: userId,
      prompt: draft.prompt.trim(),
      category: draft.category.trim() || "Community Bet",
      option_a: draft.optionA.trim(),
      option_b: draft.optionB.trim(),
      ends_at: draft.endsAt || null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function placeFeedWager(postId, userId, choice, amount) {
  const { data, error } = await supabase
    .from("feed_wagers")
    .insert({ post_id: postId, user_id: userId, choice, amount })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function settleFeedPostRemote(postId, winningChoice) {
  const { data, error } = await supabase
    .from("feed_posts")
    .update({ status: "settled", winning_choice: winningChoice })
    .eq("id", postId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateProfileWallet(userId, changes) {
  const { data, error } = await supabase
    .from("profiles")
    .update(changes)
    .eq("id", userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export function subscribeToCircleFeed(circleId, onChange) {
  if (!supabase || !circleId) return () => {};
  const channel = supabase
    .channel(`circle-feed:${circleId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "feed_posts", filter: `circle_id=eq.${circleId}` },
      onChange
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "feed_wagers" },
      onChange
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

function mapFeedPost(row) {
  return {
    id: row.id,
    creator: row.profiles?.username || "Friend",
    creatorAvatarColor: row.profiles?.avatar_color || DEFAULT_AVATAR_COLOR,
    creatorId: row.creator_id,
    prompt: row.prompt,
    category: row.category,
    optionA: row.option_a,
    optionB: row.option_b,
    createdAt: new Date(row.created_at).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }),
    endsAt: row.ends_at ? row.ends_at.slice(0, 16) : null,
    pricingMode: "no_house",
    oddsA: 1.9,
    oddsB: 1.9,
    status: row.status,
    winningChoice: row.winning_choice,
    wagers: (row.feed_wagers || []).map((wager) => ({
      id: wager.id,
      bettorName: wager.profiles?.username || "Friend",
      bettorAvatarColor: wager.profiles?.avatar_color || DEFAULT_AVATAR_COLOR,
      userId: wager.user_id,
      choice: wager.choice,
      amount: wager.amount,
      createdAt: new Date(wager.created_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
      isLocal: false,
    })),
  };
}

export { BETCOIN, DEFAULT_AVATAR_COLOR };
