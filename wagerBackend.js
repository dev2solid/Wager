import { isSupabaseConfigured, supabase } from "./supabaseClient.js";

const BETCOIN = "BetCoin";

const genInviteName = () => `Circle ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
const DEFAULT_AVATAR_COLOR = "#19D12E";
const IMAGE_BUCKET = "wager-images";
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || "";

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
  const { data, error } = await supabase.rpc("ensure_profile", {
    username_input: username || user.user_metadata?.username || user.email?.split("@")[0] || "You",
    avatar_color_input: avatarColor || user.user_metadata?.avatar_color || DEFAULT_AVATAR_COLOR,
    avatar_url_input: user.user_metadata?.avatar_url || null,
  });
  if (error) throw error;
  return data?.[0] || null;
}

export async function getProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select()
    .eq("id", userId)
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

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

export function getNotificationSupportStatus() {
  if (typeof window === "undefined") return "not_supported";
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isStandalone = window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
  if (isIos && !isStandalone) return "install_required";
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) return "not_supported";
  if (Notification.permission === "denied") return "blocked";
  if (!VAPID_PUBLIC_KEY) return "not_configured";
  if (Notification.permission === "granted") return "enabled";
  return "available";
}

export async function enablePushNotifications(userId) {
  if (!supabase || !userId) throw new Error("Sign in before enabling notifications.");
  if (!VAPID_PUBLIC_KEY) throw new Error("VAPID public key is missing.");
  const supportStatus = getNotificationSupportStatus();
  if (supportStatus === "install_required") throw new Error("Install Wager to your Home Screen to enable notifications on iPhone.");
  if (supportStatus === "not_supported") throw new Error("Push notifications are not supported in this browser.");
  if (supportStatus === "not_configured") throw new Error("Notification keys are not configured yet.");
  if (supportStatus === "blocked") throw new Error("Notifications are blocked. Turn them back on in your browser settings.");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    if (permission === "denied") throw new Error("Notifications are blocked. Turn them back on in your browser settings.");
    throw new Error("Notification permission was not granted.");
  }

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });
  const json = subscription.toJSON();

  const { error } = await supabase.from("push_subscriptions").upsert({
    user_id: userId,
    endpoint: subscription.endpoint,
    p256dh: json.keys?.p256dh,
    auth: json.keys?.auth,
    user_agent: navigator.userAgent,
    updated_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
  }, { onConflict: "endpoint" });
  if (error) throw error;
  return subscription;
}

export async function disablePushNotifications(userId) {
  if (!supabase || !userId || !("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.ready.catch(() => null);
  const subscription = await registration?.pushManager?.getSubscription();
  if (!subscription) return;
  await supabase
    .from("push_subscriptions")
    .delete()
    .eq("user_id", userId)
    .eq("endpoint", subscription.endpoint);
  await subscription.unsubscribe().catch(() => {});
}

function getFileExtension(file) {
  const fromName = file?.name?.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]+$/.test(fromName)) return fromName === "jpeg" ? "jpg" : fromName;
  const fromType = file?.type?.split("/").pop()?.toLowerCase();
  return fromType && /^[a-z0-9]+$/.test(fromType) ? fromType : "jpg";
}

async function uploadImage(file, userId, kind) {
  if (!file || !userId) return null;
  const extension = getFileExtension(file);
  const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const path = `${userId}/${kind}-${id}.${extension}`;
  const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, file, {
    cacheControl: "31536000",
    contentType: file.type || "image/jpeg",
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export async function uploadProfileImage(file, userId) {
  return uploadImage(file, userId, "profile");
}

export async function uploadMarketImage(file, userId) {
  return uploadImage(file, userId, "market");
}

export async function listCircles() {
  const { data, error } = await supabase
    .from("circles")
    .select("id, name, invite_code, created_at")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createCircle(_userId, name = genInviteName(), inviteCode = null) {
  const { data, error } = await supabase.rpc("create_circle", {
    circle_name_input: name,
    invite_code_input: inviteCode,
  });
  if (error) throw error;
  return data?.[0] || null;
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
      image_url,
      ends_at,
      status,
      winning_choice,
      created_at,
      profiles!feed_posts_creator_profile_fkey(username, avatar_color, avatar_url),
      feed_wagers(
        id,
        user_id,
        choice,
        amount,
        created_at,
        profiles!feed_wagers_user_profile_fkey(username, avatar_color, avatar_url)
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
      image_url: draft.imageUrl || null,
      ends_at: draft.endsAt || null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function createFeedPostsForCircles(circleIds, userId, draft) {
  const uniqueCircleIds = [...new Set((circleIds || []).filter(Boolean))];
  if (uniqueCircleIds.length === 0) throw new Error("Choose at least one circle.");
  const results = [];
  const failures = [];

  for (const circleId of uniqueCircleIds) {
    try {
      const post = await createFeedPost(circleId, userId, draft);
      results.push({ circleId, post });
    } catch (error) {
      failures.push({ circleId, error });
    }
  }

  if (failures.length > 0) {
    const message = failures.map((failure) => failure.error?.message || "Unknown error").join("; ");
    throw new Error(`Could not post to ${failures.length} circle${failures.length === 1 ? "" : "s"}: ${message}`);
  }

  return results;
}

export async function placeFeedWager(postId, userId, choice, amount) {
  const { data, error } = await supabase.rpc("place_feed_wager", {
    post_id_input: postId,
    choice_input: choice,
    amount_input: amount,
  });
  if (error) throw error;
  return data?.[0] || null;
}

export async function settleFeedPostRemote(postId, winningChoice) {
  const { data, error } = await supabase.rpc("settle_feed_post", {
    post_id_input: postId,
    winning_choice_input: winningChoice,
  });
  if (error) throw error;
  return data?.[0] || null;
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

export function subscribeToNotificationEvents(userId, onEvent) {
  if (!supabase || !userId) return () => {};
  const channel = supabase
    .channel(`wager-notifications:${userId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "notification_events" },
      (payload) => {
        if (payload.new?.actor_id === userId) return;
        onEvent(payload.new);
      }
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
    imageUrl: row.image_url || null,
    creatorAvatarUrl: row.profiles?.avatar_url || null,
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
      bettorAvatarUrl: wager.profiles?.avatar_url || null,
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
