import React, { useState, useEffect } from "react";
import {
  backendEnabled,
  createCircle,
  createFeedPost as createFeedPostRemote,
  ensureProfile,
  getCurrentSession,
  getProfile,
  listCircles,
  listFeedPosts,
  joinCircleByInviteCode,
  onAuthChanged,
  placeFeedWager,
  settleFeedPostRemote,
  signInWithEmail,
  signOut,
  signUpAndJoinCircle,
  subscribeToCircleFeed,
} from "./wagerBackend.js";

const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const genId = () => Math.random().toString(36).slice(2, 9);
const now = () => new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const BETCOIN = "BetCoin";
const BETCOIN_COIN_IMAGE = "/assets/betcoin.jpg";
const BETCOIN_COIN_VIDEO_WEBM = "/assets/betcoin-flip.webm";
const BETCOIN_COIN_VIDEO = "/assets/betcoin-flip.mp4";
const QUICK_WAGERS = ["Friendly Bet", "Dinner", "Drinks", "Car wash", "Coffee", "Custom..."];
const QUICK_BETCOIN = [50, 100, 250, 500, 1000];
const FEED_TEMPLATES = [
  { id: "over_under", label: "Over / Under", optionA: "Over", optionB: "Under" },
  { id: "yes_no", label: "Yes / No", optionA: "Yes", optionB: "No" },
  { id: "team_a_b", label: "Team A / Team B", optionA: "Team A", optionB: "Team B" },
];
const ONBOARDING_STEPS = [
  {
    eyebrow: "Welcome",
    title: "Your friends' betting feed",
    body: "Post funny predictions, pick sides, and let the group pile in with fake BetCoin.",
  },
  {
    eyebrow: "BetCoin",
    title: "Fake money, real bragging rights",
    body: "Everyone starts with a wallet. BetCoin tracks who is hot without touching real money.",
  },
  {
    eyebrow: "Friend circles",
    title: "The feed is private",
    body: "Each circle has its own feed and invite code. Only members can see the posts, wagers, and results.",
  },
  {
    eyebrow: "Create account",
    title: "Get into the circle",
    body: "Make your profile, enter your friend code, and the feed opens with everyone in the same room.",
  },
];
const REUP_AMOUNT = 250;
const REUP_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const CURRENT_USER = "You";
const PENDING_INVITE_KEY = "wgr_pending_invite_code";
const AVATAR_COLORS = ["#19D12E", "#FBBF24", "#38BDF8", "#A78BFA", "#F472B6", "#FB7185"];
const formatBetCoin = (amount) => `${Number(amount).toLocaleString("en-US")} ${BETCOIN}`;
const getInitials = (value) => {
  const parts = String(value || "You").trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] || "Y";
  const second = parts.length > 1 ? parts[1]?.[0] : parts[0]?.[1];
  return `${first || ""}${second || ""}`.toUpperCase();
};
const getAvatarColor = (value) => {
  const text = String(value || "You");
  const sum = Array.from(text).reduce((total, char) => total + char.charCodeAt(0), 0);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
};
const parseBetCoinAmount = (value) => {
  if (value == null || value === "") return null;
  const normalized = String(value).replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  if (!normalized) return null;
  const amount = Math.floor(Number(normalized[1]));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
};
const isBetCoinWager = (bet) => bet?.currency === BETCOIN || /betcoin/i.test(bet?.wager ?? "");
const getBetCoinAmount = (bet) => isBetCoinWager(bet) ? parseBetCoinAmount(bet.amount ?? bet.wager) : null;
const getWagerLabel = (bet) => {
  const betCoinAmount = getBetCoinAmount(bet);
  return betCoinAmount ? formatBetCoin(betCoinAmount) : bet.wager;
};
const getSettlementDelta = (status, amount) => {
  if (!amount) return 0;
  if (status === "p1_won") return amount;
  if (status === "p2_won") return -amount;
  return 0;
};
const formatTimeUntil = (target, nowMs) => {
  const remaining = Math.max(target - nowMs, 0);
  const hours = Math.floor(remaining / (60 * 60 * 1000));
  const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
  return `${hours}h ${minutes}m`;
};
const toDateTimeLocal = (date = new Date()) => {
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return adjusted.toISOString().slice(0, 16);
};
const defaultFeedEndsAt = () => toDateTimeLocal(new Date(Date.now() + 24 * 60 * 60 * 1000));
const safeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const parseOddsValue = (value, fallback = 1.9) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1.01, Math.round(parsed * 100) / 100);
};
const formatOdds = (value) => `${parseOddsValue(value).toFixed(2)}x`;
const isCurrentUserName = (value) => typeof value === "string" && value.trim().toLowerCase() === CURRENT_USER.toLowerCase();
const normalizeBet = (bet) => {
  if (!bet || typeof bet !== "object") return null;
  return {
    id: typeof bet.id === "string" ? bet.id : genId(),
    what: typeof bet.what === "string" ? bet.what : "",
    wager: typeof bet.wager === "string" ? bet.wager : "",
    currency: bet.currency === BETCOIN ? BETCOIN : null,
    amount: parseBetCoinAmount(bet.amount),
    status: ["open", "locked", "p1_won", "p2_won", "disputed"].includes(bet.status) ? bet.status : "open",
    date: typeof bet.date === "string" ? bet.date : now(),
    p1_bet: Boolean(bet.p1_bet),
    p2_bet: Boolean(bet.p2_bet),
  };
};
const loadBets = () => {
  const stored = load("wgr_bets", []);
  if (!Array.isArray(stored)) return [];
  return stored.map(normalizeBet).filter(Boolean);
};
const loadBalance = () => Math.max(safeNumber(load("wgr_balance", 1000), 1000), 0);
const loadNextReupAt = () => Math.max(safeNumber(load("wgr_next_reup_at", 0), 0), 0);
const loadWinStreak = () => Math.max(safeNumber(load("wgr_win_streak", 0), 0), 0);
const normalizeFeedWager = (wager) => {
  if (!wager || typeof wager !== "object") return null;
  const amount = parseBetCoinAmount(wager.amount);
  if (!amount) return null;
  return {
    id: typeof wager.id === "string" ? wager.id : genId(),
    bettorName: typeof wager.bettorName === "string" && wager.bettorName.trim() ? wager.bettorName.trim() : "Friend",
    choice: wager.choice === "A" ? "A" : "B",
    amount,
    createdAt: typeof wager.createdAt === "string" ? wager.createdAt : now(),
    isLocal: Boolean(wager.isLocal),
  };
};
const normalizeFeedPost = (post) => {
  if (!post || typeof post !== "object") return null;
  return {
    id: typeof post.id === "string" ? post.id : genId(),
    creator: typeof post.creator === "string" && post.creator.trim() ? post.creator.trim() : CURRENT_USER,
    prompt: typeof post.prompt === "string" ? post.prompt : "",
    category: typeof post.category === "string" ? post.category : "Community Bet",
    optionA: typeof post.optionA === "string" && post.optionA.trim() ? post.optionA.trim() : "Option A",
    optionB: typeof post.optionB === "string" && post.optionB.trim() ? post.optionB.trim() : "Option B",
    createdAt: typeof post.createdAt === "string" ? post.createdAt : now(),
    endsAt: typeof post.endsAt === "string" && post.endsAt ? post.endsAt : null,
    pricingMode: post.pricingMode === "odds" ? "odds" : "no_house",
    oddsA: parseOddsValue(post.oddsA, 1.9),
    oddsB: parseOddsValue(post.oddsB, 1.9),
    status: post.status === "settled" ? "settled" : "open",
    winningChoice: post.winningChoice === "A" || post.winningChoice === "B" ? post.winningChoice : null,
    wagers: Array.isArray(post.wagers) ? post.wagers.map(normalizeFeedWager).filter(Boolean) : [],
  };
};
const loadFeedPosts = () => {
  const stored = load("wgr_feed_posts", []);
  if (!Array.isArray(stored)) return [];
  return stored.map(normalizeFeedPost).filter(Boolean);
};

function BalanceBadge({ balance, label = null }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 14px",
        borderRadius: 999,
        border: "1.5px solid rgba(255,255,255,0.08)",
        background: "rgba(17,17,21,0.95)",
        boxShadow: "0 10px 28px rgba(0,0,0,0.28)",
      }}
    >
      <img
        src={BETCOIN_COIN_IMAGE}
        alt="BetCoin"
        style={{
          width: 26,
          height: 26,
          borderRadius: "50%",
          objectFit: "cover",
          boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
        }}
      />
      <span style={{ fontSize: 13, fontWeight: 800, color: "#FAFAFA", letterSpacing: "0.02em" }}>
        {formatBetCoin(balance)}
      </span>
      {label && (
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", color: "rgba(255,255,255,0.38)", textTransform: "uppercase" }}>
          {label}
        </span>
      )}
    </div>
  );
}

function CoinFlip({ size = 110, showRing = true }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        overflow: "hidden",
        position: "relative",
        flexShrink: 0,
        background: "radial-gradient(circle at 50% 50%, rgba(0,200,122,0.2), rgba(255,255,255,0.04))",
        border: showRing ? "1.5px solid rgba(255,255,255,0.08)" : "none",
        boxShadow: "0 12px 34px rgba(0,0,0,0.35), 0 0 36px rgba(0,200,122,0.12)",
      }}
    >
      <video
        autoPlay
        loop
        muted
        playsInline
        poster={BETCOIN_COIN_IMAGE}
        style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scale(1.08)" }}
      >
        <source src={BETCOIN_COIN_VIDEO_WEBM} type="video/webm" />
        <source src={BETCOIN_COIN_VIDEO} type="video/mp4" />
      </video>
    </div>
  );
}

function CoinFace({ size = 44 }) {
  return (
    <img
      src={BETCOIN_COIN_IMAGE}
      alt="BetCoin"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        objectFit: "cover",
        boxShadow: "0 8px 24px rgba(0,0,0,0.28)",
        flexShrink: 0,
      }}
    />
  );
}

function ProfileAvatar({ name, color, size = 42 }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: color || getAvatarColor(name),
        color: "#050505",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.max(12, Math.floor(size * 0.34)),
        fontWeight: 900,
        flexShrink: 0,
        boxShadow: "0 10px 24px rgba(0,0,0,0.24)",
      }}
    >
      {getInitials(name)}
    </div>
  );
}

export default function Wager() {
  const [bets, setBets] = useState(loadBets);
  const [feedPosts, setFeedPosts] = useState(loadFeedPosts);
  const [screen, setScreen] = useState("feed"); // feed | bet | history | home | detail
  const [activeBet, setActiveBet] = useState(null);
  const [detailOrigin, setDetailOrigin] = useState("home");
  const [step, setStep] = useState(1); // 1=what, 2=wager, 3=confirm
  const [draft, setDraft] = useState({ what: "", wagerType: "betcoin", wager: "", custom: "", betCoinAmount: "100" });
  const [feedDraft, setFeedDraft] = useState({
    creator: CURRENT_USER,
    prompt: "",
    category: "Over / Under",
    optionA: "Over",
    optionB: "Under",
    endsAt: "",
    pricingMode: "no_house",
    oddsA: "1.90",
    oddsB: "1.90",
  });
  const [feedBetDrafts, setFeedBetDrafts] = useState({});
  const [locked, setLocked] = useState(false); // animation lock
  const [flash, setFlash] = useState(false);
  const [balance, setBalance] = useState(loadBalance);
  const [nextReupAt, setNextReupAt] = useState(loadNextReupAt);
  const [winStreak, setWinStreak] = useState(loadWinStreak);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [celebration, setCelebration] = useState(null);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [onTheLineOpen, setOnTheLineOpen] = useState(false);
  const [reviewTicketOpen, setReviewTicketOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [feedRemindersSeen, setFeedRemindersSeen] = useState([]);
  const [feedComposerOpen, setFeedComposerOpen] = useState(false);
  const [feedView, setFeedView] = useState("feed");
  const [expandedFeedPostId, setExpandedFeedPostId] = useState(null);
  const [feedBetModalPostId, setFeedBetModalPostId] = useState(null);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [circles, setCircles] = useState([]);
  const [activeCircleId, setActiveCircleId] = useState(null);
  const [authMode, setAuthMode] = useState("join");
  const [authForm, setAuthForm] = useState({ email: "", password: "", username: "", inviteCode: "" });
  const [joinCode, setJoinCode] = useState("");
  const [newCircleName, setNewCircleName] = useState("");
  const [backendStatus, setBackendStatus] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(() => !load("wgr_seen_onboarding", false));
  const [onboardingStep, setOnboardingStep] = useState(0);
  const profileName = profile?.username || session?.user?.user_metadata?.username || CURRENT_USER;
  const profileColor = profile?.avatar_color || session?.user?.user_metadata?.avatar_color || getAvatarColor(profileName);
  const activeCircle = circles.find((circle) => circle.id === activeCircleId) || null;

  useEffect(() => { save("wgr_bets", bets); }, [bets]);
  useEffect(() => { if (!backendEnabled) save("wgr_feed_posts", feedPosts); }, [feedPosts]);
  useEffect(() => { save("wgr_balance", balance); }, [balance]);
  useEffect(() => { save("wgr_next_reup_at", nextReupAt); }, [nextReupAt]);
  useEffect(() => { save("wgr_win_streak", winStreak); }, [winStreak]);
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!backendEnabled) return undefined;
    let cancelled = false;

    const boot = async () => {
      try {
        const currentSession = await getCurrentSession();
        if (cancelled) return;
        setSession(currentSession);
        if (currentSession?.user) {
          const nextProfile = await ensureProfile(currentSession.user);
          if (!cancelled) {
            setProfile(nextProfile);
            setBalance(nextProfile.balance ?? 1000);
            setWinStreak(nextProfile.win_streak ?? 0);
          }
        }
      } catch (error) {
        setBackendStatus(error.message || "Could not connect to Supabase.");
      }
    };

    boot();
    const unsubscribe = onAuthChanged(async (nextSession) => {
      setSession(nextSession);
      setProfile(null);
      setCircles([]);
      setActiveCircleId(null);
      setFeedPosts([]);
      if (!nextSession?.user) return;
      try {
        const nextProfile = await ensureProfile(nextSession.user);
        setProfile(nextProfile);
        setBalance(nextProfile.balance ?? 1000);
        setWinStreak(nextProfile.win_streak ?? 0);
        const pendingInviteCode = load(PENDING_INVITE_KEY, "");
        if (pendingInviteCode) {
          const circle = await joinCircleByInviteCode(pendingInviteCode);
          localStorage.removeItem(PENDING_INVITE_KEY);
          setCircles((current) => current.some((item) => item.id === circle.id) ? current : [...current, circle]);
          setActiveCircleId(circle.id);
          setAuthNotice("");
          triggerCelebration("Circle joined", "Your friend code worked.");
        }
      } catch (error) {
        setBackendStatus(error.message || "Could not load your profile.");
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (!backendEnabled || !session?.user) return;
    let cancelled = false;

    const loadUserCircles = async () => {
      try {
        const rows = await listCircles();
        if (cancelled) return;
        setCircles(rows);
        setActiveCircleId((current) => current || rows[0]?.id || null);
      } catch (error) {
        setBackendStatus(error.message || "Could not load your friend feed.");
      }
    };

    loadUserCircles();
    return () => {
      cancelled = true;
    };
  }, [session]);
  useEffect(() => {
    if (!backendEnabled || !session?.user || !activeCircleId) return undefined;
    let cancelled = false;

    const refreshFeed = async () => {
      try {
        const posts = await listFeedPosts(activeCircleId);
        if (cancelled) return;
        setFeedPosts(posts.map((post) => ({
          ...post,
          creator: post.creatorId === session.user.id ? CURRENT_USER : post.creator,
          wagers: post.wagers.map((wager) => ({
            ...wager,
            bettorName: wager.userId === session.user.id ? CURRENT_USER : wager.bettorName,
            isLocal: wager.userId === session.user.id,
          })),
        })));
      } catch (error) {
        setBackendStatus(error.message || "Could not refresh your feed.");
      }
    };

    refreshFeed();
    return subscribeToCircleFeed(activeCircleId, refreshFeed);
  }, [session, activeCircleId]);
  useEffect(() => {
    const dueOwnedPosts = feedPosts.filter((post) => {
      if (post.status !== "open") return false;
      if (!isCurrentUserName(post.creator)) return false;
      if (!post.endsAt) return false;
      return new Date(post.endsAt).getTime() <= nowMs;
    });
    const nextReminder = dueOwnedPosts.find((post) => !feedRemindersSeen.includes(post.id));
    if (!nextReminder) return;
    triggerCelebration("Result needed", "Pick the winner so BetCoin can settle.");
    setFeedRemindersSeen((current) => [...current, nextReminder.id]);
  }, [feedPosts, nowMs, feedRemindersSeen]);

  const directReservedBalance = bets.reduce((total, bet) => {
    if (bet.status !== "open" && bet.status !== "locked") return total;
    return total + (getBetCoinAmount(bet) || 0);
  }, 0);
  const feedReservedBalance = feedPosts.reduce((total, post) => {
    if (post.status !== "open") return total;
    return total + post.wagers.reduce((sum, wager) => sum + (wager.isLocal ? wager.amount : 0), 0);
  }, 0);
  const reservedBalance = directReservedBalance + feedReservedBalance;
  const availableBalance = Math.max(balance - reservedBalance, 0);
  const isBroke = balance === 0 && reservedBalance === 0;
  const canClaimReup = isBroke && nowMs >= nextReupAt;
  const reupCountdown = !canClaimReup && nextReupAt ? formatTimeUntil(nextReupAt, nowMs) : null;
  const draftBetCoinAmount = parseBetCoinAmount(draft.betCoinAmount);
  const customWagerValue = draft.wager === "Custom..." ? draft.custom.trim() : draft.wager;
  const draftWagerLabel = draft.wagerType === "betcoin" ? (draftBetCoinAmount ? formatBetCoin(draftBetCoinAmount) : "") : customWagerValue;
  const draftCoinTooHigh = draft.wagerType === "betcoin" && draftBetCoinAmount > availableBalance;
  const canAdvanceWagerStep = draft.wagerType === "betcoin"
    ? Boolean(draftBetCoinAmount) && !draftCoinTooHigh
    : Boolean(draft.wager) && (draft.wager !== "Custom..." || Boolean(draft.custom.trim()));
  const feedPostsSorted = [...feedPosts].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const getFeedChoiceTotal = (post, choice) => post.wagers.filter((wager) => wager.choice === choice).reduce((sum, wager) => sum + wager.amount, 0);
  const getFeedPot = (post) => post.wagers.reduce((sum, wager) => sum + wager.amount, 0);
  const isFeedClosedForBetting = (post) => post.status !== "open" || Boolean(post.endsAt && new Date(post.endsAt).getTime() <= nowMs);
  const isFeedAwaitingCreatorResult = (post) => post.status === "open" && Boolean(post.endsAt && new Date(post.endsAt).getTime() <= nowMs);
  const isFeedOwner = (post) => backendEnabled && session?.user
    ? post.creatorId === session.user.id
    : isCurrentUserName(post.creator);
  const canFeedOwnerSettle = (post) => post.status === "open" && isFeedOwner(post) && (!post.endsAt || new Date(post.endsAt).getTime() <= nowMs);
  const feedStatusLabel = (post) => {
    if (post.status === "settled") return `Settled • ${post.winningChoice === "A" ? post.optionA : post.optionB}`;
    if (!post.endsAt) return isFeedOwner(post) ? "Live • settle anytime" : "Live • creator settles";
    if (new Date(post.endsAt).getTime() <= nowMs) return isFeedOwner(post) ? "Result needed" : "Awaiting result";
    return `Live • ends ${new Date(post.endsAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
  };
  const getFeedSettlementDeltas = (post, winningChoice) => {
    if (post.pricingMode === "odds") {
      const winningOdds = winningChoice === "A" ? parseOddsValue(post.oddsA) : parseOddsValue(post.oddsB);
      const deltas = {};
      const creatorIsLocal = isFeedOwner(post);
      post.wagers.forEach((wager) => {
        const isWinner = wager.choice === winningChoice;
        if (wager.isLocal) {
          deltas[wager.id] = isWinner ? Math.round(wager.amount * (winningOdds - 1)) : -wager.amount;
        } else if (creatorIsLocal) {
          deltas[wager.id] = isWinner ? -Math.round(wager.amount * (winningOdds - 1)) : wager.amount;
        } else {
          deltas[wager.id] = 0;
        }
      });
      return deltas;
    }

    const winners = post.wagers.filter((wager) => wager.choice === winningChoice);
    const losers = post.wagers.filter((wager) => wager.choice !== winningChoice);
    const winningPool = winners.reduce((sum, wager) => sum + wager.amount, 0);
    const losingPool = losers.reduce((sum, wager) => sum + wager.amount, 0);
    const deltas = {};

    if (!winningPool || !losingPool) {
      post.wagers.forEach((wager) => {
        deltas[wager.id] = 0;
      });
      return deltas;
    }

    losers.forEach((wager) => {
      deltas[wager.id] = -wager.amount;
    });

    const winnerShares = winners.map((wager) => {
      const exactShare = (wager.amount / winningPool) * losingPool;
      return {
        id: wager.id,
        whole: Math.floor(exactShare),
        fraction: exactShare - Math.floor(exactShare),
      };
    });

    let remaining = losingPool - winnerShares.reduce((sum, wager) => sum + wager.whole, 0);
    winnerShares
      .sort((a, b) => b.fraction - a.fraction)
      .forEach((wager) => {
        const bonus = remaining > 0 ? 1 : 0;
        if (remaining > 0) remaining -= 1;
        deltas[wager.id] = wager.whole + bonus;
      });

    return deltas;
  };
  const liveExposureItems = [
    ...bets
      .filter((bet) => bet.status === "open" || bet.status === "locked")
      .map((bet) => ({
        id: `direct-${bet.id}`,
        title: bet.what,
        subtitle: bet.status === "locked" ? "Direct bet • locked in" : "Direct bet • waiting",
        amount: getBetCoinAmount(bet) || 0,
      }))
      .filter((item) => item.amount > 0),
    ...feedPosts.flatMap((post) =>
      post.status !== "open"
        ? []
        : post.wagers
            .filter((wager) => wager.isLocal)
            .map((wager) => ({
              id: `feed-${post.id}-${wager.id}`,
              title: post.prompt,
              subtitle: `Feed • ${wager.choice === "A" ? post.optionA : post.optionB}`,
              amount: wager.amount,
            }))
    ),
  ];
  const creatorResultPosts = feedPostsSorted.filter((post) => isFeedAwaitingCreatorResult(post) && isFeedOwner(post));
  const visibleFeedPosts = feedPostsSorted.filter((post) => (
    feedView === "yours"
      ? isFeedOwner(post) && post.status === "open"
      : true
  ));
  const feedBetModalPost = feedPosts.find((post) => post.id === feedBetModalPostId) || null;

  const openBet = (bet, origin = screen) => {
    setActiveBet(bet);
    setDetailOrigin(origin === "detail" ? detailOrigin : origin);
    setScreen("detail");
  };

  const startNew = () => {
    setDraft({ what: "", wagerType: "betcoin", wager: "", custom: "", betCoinAmount: "100" });
    setStep(1);
    setReviewTicketOpen(false);
    setScreen("bet");
  };

  const switchTab = (target) => {
    if (target === "bet") {
      setStep(1);
      setLocked(false);
    }
    setReviewTicketOpen(false);
    setFeedBetModalPostId(null);
    setScreen(target);
  };

  const applyFeedTemplate = (template) => {
    setFeedDraft((current) => ({
      ...current,
      category: template.label,
      optionA: template.optionA,
      optionB: template.optionB,
    }));
  };

  const handleSignIn = async () => {
    if (!authForm.email.trim() || !authForm.password) return;
    setBackendStatus("");
    setAuthNotice("");
    try {
      await signInWithEmail(authForm.email.trim(), authForm.password);
      closeOnboarding();
    } catch (error) {
      setBackendStatus(error.message || "Could not sign in.");
    }
  };

  const handleSignUp = async () => {
    if (!authForm.email.trim() || !authForm.password || !authForm.username.trim() || !authForm.inviteCode.trim()) return;
    setBackendStatus("");
    setAuthNotice("");
    try {
      const username = authForm.username.trim();
      const avatarColor = getAvatarColor(username);
      const result = await signUpAndJoinCircle({
        email: authForm.email.trim(),
        password: authForm.password,
        username,
        inviteCode: authForm.inviteCode,
        avatarColor,
      });
      if (result.pendingEmailConfirmation) {
        save(PENDING_INVITE_KEY, authForm.inviteCode.trim().toUpperCase());
        setAuthNotice("Check your email to finish joining. Your friend code is saved for your first login.");
        save("wgr_seen_onboarding", true);
        return;
      }
      if (result.profile) {
        setProfile(result.profile);
        setBalance(result.profile.balance ?? 1000);
        setWinStreak(result.profile.win_streak ?? 0);
      }
      if (result.circle) {
        setCircles((current) => current.some((item) => item.id === result.circle.id) ? current : [...current, result.circle]);
        setActiveCircleId(result.circle.id);
      } else if (result.joinError) {
        setJoinCode(authForm.inviteCode.trim().toUpperCase());
        setBackendStatus("Account created, but that friend code did not work. Try another code or create a new circle.");
      }
      setAuthForm({ email: "", password: "", username: "", inviteCode: "" });
      if (!result.joinError) {
        closeOnboarding();
        triggerCelebration("Welcome in", "Your friends feed is ready.");
      }
    } catch (error) {
      setBackendStatus(error.message || "Could not join with that friend code.");
    }
  };

  const handleCreateCircle = async () => {
    if (!backendEnabled || !session?.user) return;
    setBackendStatus("");
    try {
      const name = newCircleName.trim() || `${profileName}'s Circle`;
      const circle = await createCircle(session.user.id, name);
      setCircles((current) => [...current, circle]);
      setActiveCircleId(circle.id);
      setNewCircleName("");
      triggerCelebration("Circle created", `${circle.name} is ready for friends.`);
    } catch (error) {
      setBackendStatus(error.message || "Could not create a friend feed.");
    }
  };

  const handleJoinCircle = async () => {
    if (!backendEnabled || !session?.user || !joinCode.trim()) return;
    setBackendStatus("");
    try {
      const circle = await joinCircleByInviteCode(joinCode);
      if (!circle) return;
      setCircles((current) => current.some((item) => item.id === circle.id) ? current : [...current, circle]);
      setActiveCircleId(circle.id);
      setJoinCode("");
      triggerCelebration("Circle joined", "You are in the friends feed.");
    } catch (error) {
      setBackendStatus(error.message || "Could not join that friend circle.");
    }
  };

  const shareAccessCode = async () => {
    if (!activeCircle?.invite_code) return;
    const text = `Join my Wager feed with friend code ${activeCircle.invite_code}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Join my Wager feed", text });
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(activeCircle.invite_code);
        triggerCelebration("Code copied", "Send it to your friends.");
      }
    } catch (error) {
      if (error?.name !== "AbortError") setBackendStatus("Could not share the friend code.");
    }
  };

  const handleSignOut = async () => {
    setBackendStatus("");
    try {
      setProfileMenuOpen(false);
      await signOut();
    } catch (error) {
      setBackendStatus(error.message || "Could not sign out.");
    }
  };

  const closeOnboarding = () => {
    save("wgr_seen_onboarding", true);
    setOnboardingOpen(false);
    setOnboardingStep(0);
  };

  const advanceOnboarding = () => {
    if (onboardingStep >= ONBOARDING_STEPS.length - 1 && backendEnabled && !session) return;
    if (onboardingStep >= ONBOARDING_STEPS.length - 1) {
      closeOnboarding();
      return;
    }
    setOnboardingStep((current) => current + 1);
  };

  const createFeedPost = async () => {
    if (!feedDraft.prompt.trim() || !feedDraft.optionA.trim() || !feedDraft.optionB.trim()) return;
    if (backendEnabled) {
      if (!session?.user || !activeCircleId) return;
      setBackendStatus("");
      try {
        await createFeedPostRemote(activeCircleId, session.user.id, feedDraft);
        setFeedDraft({
          creator: profile?.username || CURRENT_USER,
          prompt: "",
          category: "Over / Under",
          optionA: "Over",
          optionB: "Under",
          endsAt: "",
          pricingMode: "no_house",
          oddsA: "1.90",
          oddsB: "1.90",
        });
        setFeedComposerOpen(false);
        triggerCelebration("Post live", "Your friends can bet it now.");
      } catch (error) {
        setBackendStatus(error.message || "Could not post this bet.");
      }
      return;
    }
    const post = {
      id: genId(),
      creator: feedDraft.creator.trim() || CURRENT_USER,
      prompt: feedDraft.prompt.trim(),
      category: feedDraft.category.trim() || "Community Bet",
      optionA: feedDraft.optionA.trim(),
      optionB: feedDraft.optionB.trim(),
      createdAt: now(),
      endsAt: feedDraft.endsAt || null,
      pricingMode: feedDraft.pricingMode === "odds" ? "odds" : "no_house",
      oddsA: parseOddsValue(feedDraft.oddsA),
      oddsB: parseOddsValue(feedDraft.oddsB),
      status: "open",
      winningChoice: null,
      wagers: [],
    };
    setFeedPosts((current) => [post, ...current]);
    setFeedDraft({
      creator: CURRENT_USER,
      prompt: "",
      category: "Over / Under",
      optionA: "Over",
      optionB: "Under",
      endsAt: "",
      pricingMode: "no_house",
      oddsA: "1.90",
      oddsB: "1.90",
    });
    setFeedComposerOpen(false);
    triggerCelebration("Post live", "Your feed bet is out for the group.");
    setScreen("feed");
  };

  const updateFeedBetDraft = (postId, changes) => {
    setFeedBetDrafts((current) => ({
      ...current,
      [postId]: {
        bettorName: CURRENT_USER,
        choice: "A",
        amount: "",
        ...(current[postId] || {}),
        ...changes,
      },
    }));
  };

  const placeFeedBet = async (postId) => {
    const post = feedPosts.find((item) => item.id === postId);
    const draftState = feedBetDrafts[postId] || { bettorName: CURRENT_USER, choice: "A", amount: "" };
    const amount = parseBetCoinAmount(draftState.amount);
    const bettorName = (draftState.bettorName || CURRENT_USER).trim();
    const isLocal = bettorName.toLowerCase() === CURRENT_USER.toLowerCase();
    if (!post || !amount || !bettorName || isFeedClosedForBetting(post)) return false;
    if (isLocal && amount > availableBalance) return false;
    if (backendEnabled) {
      if (!session?.user) return false;
      setBackendStatus("");
      try {
        await placeFeedWager(postId, session.user.id, draftState.choice === "B" ? "B" : "A", amount);
        setFeedBetDrafts((current) => ({
          ...current,
          [postId]: { bettorName: CURRENT_USER, choice: "A", amount: "" },
        }));
        triggerCelebration(`-${formatBetCoin(amount)} reserved`, `You backed ${draftState.choice === "B" ? post.optionB : post.optionA}.`);
        return true;
      } catch (error) {
        setBackendStatus(error.message || "Could not place this bet.");
        return false;
      }
    }
    const wager = {
      id: genId(),
      bettorName,
      choice: draftState.choice === "B" ? "B" : "A",
      amount,
      createdAt: now(),
      isLocal,
    };
    setFeedPosts((current) => current.map((item) => item.id === postId ? { ...item, wagers: [wager, ...item.wagers] } : item));
    setFeedBetDrafts((current) => ({
      ...current,
      [postId]: { bettorName: CURRENT_USER, choice: "A", amount: "" },
    }));
    if (isLocal) {
      triggerCelebration(`-${formatBetCoin(amount)} reserved`, `You backed ${wager.choice === "A" ? post.optionA : post.optionB}.`);
    }
    return true;
  };

  const settleFeedPost = async (postId, winningChoice) => {
    const post = feedPosts.find((item) => item.id === postId);
    if (!post || post.status !== "open") return;
    const deltas = getFeedSettlementDeltas(post, winningChoice);
    const localDelta = post.wagers.reduce((sum, wager) => {
      if (!wager.isLocal) return sum;
      return sum + (deltas[wager.id] || 0);
    }, 0);
    const localWagers = post.wagers.filter((wager) => wager.isLocal);

    const showSettlementResult = (nextStreak = winStreak) => {
      if (localWagers.length === 0) return;
      if (localDelta > 0) {
        triggerCelebration(`+${formatBetCoin(localDelta)}`, `Feed win. Streak x${nextStreak}.`, "win");
      } else if (localDelta < 0) {
        triggerCelebration(`${formatBetCoin(Math.abs(localDelta))} lost`, "Your side got faded on this market.", "loss");
      } else {
        triggerCelebration("Push market", "Nobody got paid because there was no opposite side to win from.");
      }
    };

    if (backendEnabled) {
      try {
        await settleFeedPostRemote(postId, winningChoice);
        if (session?.user) {
          const nextProfile = await getProfile(session.user.id);
          setProfile(nextProfile);
          setBalance(nextProfile.balance ?? balance);
          setWinStreak(nextProfile.win_streak ?? winStreak);
          showSettlementResult(nextProfile.win_streak ?? winStreak);
        } else {
          showSettlementResult();
        }
      } catch (error) {
        setBackendStatus(error.message || "Could not settle this bet.");
      }
      return;
    }
    if (localDelta !== 0) {
      setBalance((current) => Math.max(0, current + localDelta));
    }
    const nextLocalStreak = localDelta > 0 ? winStreak + 1 : localDelta < 0 ? 0 : winStreak;
    setWinStreak(nextLocalStreak);
    showSettlementResult(nextLocalStreak);
    setFeedPosts((current) => current.map((item) => item.id === postId ? { ...item, status: "settled", winningChoice } : item));
  };

  const triggerCelebration = (title, subtitle, tone = "neutral") => {
    setCelebration({ title, subtitle, tone, id: Date.now() });
    window.clearTimeout(triggerCelebration.timeoutId);
    triggerCelebration.timeoutId = window.setTimeout(() => setCelebration(null), 2200);
  };

  const lockBet = () => {
    const isBetCoin = draft.wagerType === "betcoin";
    const wagerVal = isBetCoin ? draftWagerLabel : customWagerValue;
    if (!draft.what.trim() || !wagerVal.trim()) return;
    if (isBetCoin && (!draftBetCoinAmount || draftBetCoinAmount > availableBalance)) return;
    const bet = {
      id: genId(),
      what: draft.what.trim(),
      wager: wagerVal.trim(),
      currency: isBetCoin ? BETCOIN : null,
      amount: isBetCoin ? draftBetCoinAmount : null,
      status: "open", // open | p1_won | p2_won | disputed
      date: now(),
      p1_bet: false,
      p2_bet: false,
    };
    setBets(p => [bet, ...p]);
    setActiveBet(bet);
    setDetailOrigin("bet");
    setLocked(true);
    setReviewTicketOpen(false);
    setTimeout(() => { setLocked(false); setScreen("detail"); }, 1200);
  };

  const buildShareMessage = ({ what, wager }) => (
    [
      "You in on this bet?",
      "",
      `Bet: "${what}"`,
      `On the line: ${wager}`,
      "",
      "Open Wager and hit BET so we can lock it in."
    ].join("\n")
  );

  const shareBet = async (betLike) => {
    const sharePayload = {
      title: "Wager",
      text: buildShareMessage({
        what: betLike.what,
        wager: getWagerLabel(betLike),
      }),
    };

    try {
      if (navigator.share) {
        await navigator.share(sharePayload);
        triggerCelebration("Sent to friend", "Share sheet opened. Drop it in iMessage.");
        return;
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(sharePayload.text);
        triggerCelebration("Invite copied", "Paste it into Messages and send it.");
        return;
      }

      window.prompt("Copy this bet invite", sharePayload.text);
    } catch (error) {
      if (error?.name === "AbortError") return;
      triggerCelebration("Share not available", "Copy and send the bet invite manually.");
    }
  };

  const shareDraftBet = () => {
    if (!draft.what.trim() || !draftWagerLabel.trim()) return;
    shareBet({
      what: draft.what.trim(),
      wager: draftWagerLabel,
      currency: draft.wagerType === "betcoin" ? BETCOIN : null,
      amount: draft.wagerType === "betcoin" ? draftBetCoinAmount : null,
    });
  };

  const updateBet = (id, changes) => {
    setBets(p => p.map(b => b.id === id ? { ...b, ...changes } : b));
    if (activeBet?.id === id) setActiveBet(b => ({ ...b, ...changes }));
  };

  const pressBet = (betId, who) => {
    const bet = bets.find(b => b.id === betId);
    if (!bet || bet.status !== "open") return;
    const newP1 = who === "p1" ? true : bet.p1_bet;
    const newP2 = who === "p2" ? true : bet.p2_bet;
    const bothIn = newP1 && newP2;
    setFlash(true);
    setTimeout(() => setFlash(false), 600);
    updateBet(betId, { p1_bet: newP1, p2_bet: newP2, status: bothIn ? "locked" : "open" });
  };

  const settle = (betId, outcome) => {
    const bet = bets.find(b => b.id === betId);
    if (!bet) return;
    const amount = getBetCoinAmount(bet);
    const previousDelta = getSettlementDelta(bet.status, amount);
    const nextDelta = getSettlementDelta(outcome, amount);
    if (previousDelta !== nextDelta) {
      setBalance(current => Math.max(0, current + nextDelta - previousDelta));
    }
    updateBet(betId, { status: outcome });
    if (outcome === "p1_won") {
      const nextStreak = winStreak + 1;
      setWinStreak(nextStreak);
      triggerCelebration(
        amount ? `+${formatBetCoin(amount)}` : "You won",
        nextStreak > 1 ? `Win streak x${nextStreak}` : "Locked in. Cash it.",
        "win"
      );
    } else if (outcome === "p2_won") {
      setWinStreak(0);
      triggerCelebration(
        amount ? `-${formatBetCoin(amount)}` : "They won",
        "BetCoin moved the other way on this one.",
        "loss"
      );
    } else if (outcome === "disputed") {
      setWinStreak(0);
    }
  };

  const claimReup = () => {
    if (!canClaimReup) return;
    setBalance(current => current + REUP_AMOUNT);
    setNextReupAt(Date.now() + REUP_COOLDOWN_MS);
    setNowMs(Date.now());
    triggerCelebration(`+${formatBetCoin(REUP_AMOUNT)}`, "Re-up claimed. You are back in.");
  };

  const resetApp = () => {
    localStorage.removeItem("wgr_bets");
    localStorage.removeItem("wgr_feed_posts");
    localStorage.removeItem("wgr_balance");
    localStorage.removeItem("wgr_next_reup_at");
    localStorage.removeItem("wgr_win_streak");
    setBets([]);
    setFeedPosts([]);
    setBalance(1000);
    setNextReupAt(0);
    setWinStreak(0);
    setActiveBet(null);
    setDraft({ what: "", wagerType: "betcoin", wager: "", custom: "", betCoinAmount: "100" });
    setFeedDraft({
      creator: CURRENT_USER,
      prompt: "",
      category: "Over / Under",
      optionA: "Over",
      optionB: "Under",
      endsAt: "",
      pricingMode: "no_house",
      oddsA: "1.90",
      oddsB: "1.90",
    });
    setFeedBetDrafts({});
    setFeedRemindersSeen([]);
    setFeedComposerOpen(false);
    setFeedView("feed");
    setFeedBetModalPostId(null);
    setReviewTicketOpen(false);
    setStep(1);
    setScreen("feed");
    setConfirmResetOpen(false);
    setOnTheLineOpen(false);
    setHistoryQuery("");
  };

  const pending = bets.filter(b => b.status === "open" || b.status === "locked");
  const openFeedPosts = feedPosts.filter((post) => post.status === "open").length;
  const history = bets.filter(b => b.status === "p1_won" || b.status === "p2_won" || b.status === "disputed");
  const allActivity = [...pending, ...history];
  const filteredHistory = allActivity.filter((bet) => {
    if (!historyQuery.trim()) return true;
    const search = historyQuery.trim().toLowerCase();
    return bet.what.toLowerCase().includes(search) || getWagerLabel(bet).toLowerCase().includes(search);
  });
  const betPagePrimary = step === 1 ? "NEXT" : "REVIEW";
  const canSubmitBet = step === 1 ? Boolean(draft.what.trim()) : canAdvanceWagerStep;
  const betStepTitle = step === 1 ? "What’s the bet?" : "What’s on the line?";
  const betStepSubtitle = step === 1
    ? "Start with the exact thing everybody is betting on."
    : "Pick the BetCoin amount or the friendly side bet.";
  const runBetPrimary = () => {
    if (step === 1 && draft.what.trim()) setStep(2);
    if (step === 2 && canAdvanceWagerStep) setReviewTicketOpen(true);
  };
  const showTabBar = screen !== "detail";
  const rootBackground = screen === "bet" ? "#19D12E" : "#0A0A0A";
  const rootColor = screen === "bet" ? "#050505" : "#FAFAFA";

  const statusLabel = (s) => ({ open: "WAITING", locked: "LOCKED IN 🔒", p1_won: "YOU WON 🏆", p2_won: "THEY WON", disputed: "DISPUTED" }[s] || s);
  const statusColor = (s) => ({ open: "#FBBF24", locked: "#00C87A", p1_won: "#00C87A", p2_won: "#EF4444", disputed: "#A78BFA" }[s] || "#888");

  return (
    <div style={{ fontFamily: "'Sora', -apple-system, sans-serif", background: rootBackground, minHeight: "100vh", color: rootColor, maxWidth: 420, margin: "0 auto", position: "relative", overflow: "hidden", transition: "background 0.25s ease, color 0.25s ease" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&family=Bebas+Neue&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
        ::-webkit-scrollbar { display: none; }

        @keyframes popIn { 0% { transform: scale(0.85); opacity: 0; } 60% { transform: scale(1.04); } 100% { transform: scale(1); opacity: 1; } }
        @keyframes slideUp { from { transform: translateY(30px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes flashGreen { 0%,100% { background: #09090B; } 50% { background: rgba(0,200,122,0.08); } }
        @keyframes shake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-6px)} 40%{transform:translateX(6px)} 60%{transform:translateX(-4px)} 80%{transform:translateX(4px)} }
        @keyframes betPop { 0%{transform:scale(1)} 40%{transform:scale(0.93)} 70%{transform:scale(1.06)} 100%{transform:scale(1)} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes celebrateIn {
          0% { transform: translate(-50%, -18px) scale(0.92); opacity: 0; }
          18% { transform: translate(-50%, 0) scale(1.02); opacity: 1; }
          82% { transform: translate(-50%, 0) scale(1); opacity: 1; }
          100% { transform: translate(-50%, -12px) scale(0.97); opacity: 0; }
        }
        @keyframes coinBurst {
          0% { transform: translateY(0) scale(0.8); opacity: 0; }
          20% { opacity: 1; }
          100% { transform: translateY(-50px) scale(1.2); opacity: 0; }
        }

        .screen { min-height: 100vh; display: flex; flex-direction: column; }
        .big-btn {
          background: #00C87A; color: #09090B;
          font-family: 'Bebas Neue', sans-serif;
          font-size: 22px; letter-spacing: 0.08em;
          border: none; border-radius: 18px;
          padding: 18px; cursor: pointer; width: 100%;
          transition: transform 0.12s, opacity 0.12s;
          box-shadow: 0 0 0 1px rgba(0,200,122,0.3), 0 8px 32px rgba(0,200,122,0.2);
        }
        .big-btn:active { transform: scale(0.96); opacity: 0.9; }
        .big-btn:disabled { opacity: 0.35; cursor: default; transform: none; }
        .ghost-btn {
          background: rgba(255,255,255,0.05);
          color: rgba(255,255,255,0.45);
          border: 1.5px solid rgba(255,255,255,0.08);
          font-family: 'Sora', sans-serif; font-weight: 600;
          font-size: 14px; border-radius: 14px;
          padding: 14px; cursor: pointer; width: 100%;
          transition: background 0.15s;
        }
        .ghost-btn:active { background: rgba(255,255,255,0.1); }
        .field {
          background: #111115; border: 1.5px solid rgba(255,255,255,0.08);
          color: #FAFAFA; font-family: 'Sora', sans-serif;
          font-size: 16px; font-weight: 500;
          padding: 16px; border-radius: 16px; width: 100%;
          outline: none; transition: border-color 0.18s;
          resize: none;
        }
        .field:focus { border-color: #00C87A; }
        .field::placeholder { color: rgba(255,255,255,0.18); }
        .bet-btn {
          flex: 1; display: flex; flex-direction: column;
          align-items: center; justify-content: center; gap: 6px;
          border: 2px solid; border-radius: 20px;
          padding: 24px 16px; cursor: pointer;
          font-family: 'Bebas Neue', sans-serif;
          font-size: 26px; letter-spacing: 0.06em;
          transition: all 0.15s; min-height: 130px;
          background: none;
        }
        .chip {
          border: 1.5px solid rgba(255,255,255,0.1);
          background: #111115; color: rgba(255,255,255,0.6);
          border-radius: 10px; padding: 10px 14px;
          font-size: 13px; font-weight: 600; cursor: pointer;
          transition: all 0.15s; font-family: 'Sora', sans-serif;
          white-space: nowrap;
        }
        .chip.picked { background: rgba(0,200,122,0.12); border-color: #00C87A; color: #00C87A; }
        .chip:active { transform: scale(0.95); }
        .mode-btn {
          flex: 1;
          border: 1.5px solid rgba(255,255,255,0.08);
          background: #111115;
          color: rgba(255,255,255,0.45);
          border-radius: 16px;
          padding: 14px 16px;
          cursor: pointer;
          transition: all 0.15s;
          text-align: left;
        }
        .mode-btn.active {
          border-color: #00C87A;
          background: rgba(0,200,122,0.1);
          color: #FAFAFA;
          box-shadow: 0 0 0 1px rgba(0,200,122,0.15);
        }
        .back-btn {
          background: none; border: none; color: rgba(255,255,255,0.4);
          font-size: 22px; cursor: pointer; padding: 4px 8px;
        }
        .card {
          background: #111115;
          border: 1.5px solid rgba(255,255,255,0.07);
          border-radius: 18px; padding: 18px;
          cursor: pointer; transition: border-color 0.15s;
          animation: slideUp 0.25s ease both;
        }
        .card:active { border-color: rgba(255,255,255,0.2); }
        .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
      `}</style>

	      {celebration && (
	        <div
          style={{
            position: "fixed",
            top: 18,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 40,
            width: "calc(100% - 32px)",
            maxWidth: 360,
            pointerEvents: "none",
            animation: "celebrateIn 2.2s ease forwards",
          }}
        >
          <div
            style={{
              position: "relative",
              overflow: "hidden",
              background: celebration.tone === "win"
                ? "linear-gradient(135deg, rgba(25,209,46,0.98), rgba(15,163,49,0.96))"
                : celebration.tone === "loss"
                  ? "linear-gradient(135deg, rgba(239,68,68,0.98), rgba(185,28,28,0.96))"
                  : "linear-gradient(135deg, rgba(0,200,122,0.96), rgba(8,145,178,0.94))",
              color: celebration.tone === "loss" ? "#FFF5F5" : "#03110B",
              borderRadius: 22,
              padding: "16px 18px",
              boxShadow: celebration.tone === "win"
                ? "0 18px 60px rgba(25,209,46,0.26)"
                : celebration.tone === "loss"
                  ? "0 18px 60px rgba(239,68,68,0.28)"
                  : "0 18px 60px rgba(0,200,122,0.25)",
            }}
          >
            {[0, 1, 2].map((index) => (
              <img
                key={index}
                src={BETCOIN_COIN_IMAGE}
                alt=""
                style={{
                  position: "absolute",
                  right: 88 + index * 22,
                  bottom: 18,
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  objectFit: "cover",
                  animation: `coinBurst 900ms ease-out ${index * 90}ms forwards`,
                  opacity: 0,
                }}
              />
            ))}
            {[0, 1].map((index) => (
              <img
                key={`left-${index}`}
                src={BETCOIN_COIN_IMAGE}
                alt=""
                style={{
                  position: "absolute",
                  left: 20 + index * 26,
                  top: 16 + index * 8,
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  objectFit: "cover",
                  animation: `coinBurst 820ms ease-out ${index * 120}ms forwards`,
                  opacity: 0,
                }}
              />
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 30, fontWeight: 900, lineHeight: 1 }}>{celebration.title}</div>
                <div style={{ fontSize: 13, fontWeight: 700, marginTop: 8, opacity: 0.78 }}>{celebration.subtitle}</div>
              </div>
              <div
                style={{
                  width: 92,
                  height: 92,
                  borderRadius: "50%",
                  background: "radial-gradient(circle at 50% 50%, rgba(255,255,255,0.34), rgba(255,255,255,0.02))",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <CoinFace size={74} />
              </div>
            </div>
          </div>
	        </div>
	      )}

	      {onboardingOpen && (() => {
	        const item = ONBOARDING_STEPS[onboardingStep];
	        return (
	          <div
	            style={{
	              position: "fixed",
	              inset: 0,
	              background: "rgba(0,0,0,0.72)",
	              backdropFilter: "blur(10px)",
	              zIndex: 70,
	              display: "flex",
	              alignItems: "center",
	              justifyContent: "center",
	              padding: 20,
	            }}
	          >
	            <div
	              style={{
	                width: "100%",
	                maxWidth: 388,
	                background: "#111115",
	                border: "1.5px solid rgba(255,255,255,0.08)",
	                borderRadius: 30,
	                overflow: "hidden",
	                boxShadow: "0 24px 80px rgba(0,0,0,0.46)",
	              }}
	            >
	              <div style={{ background: "#19D12E", color: "#050505", padding: 24, position: "relative", minHeight: 210 }}>
	                <button
	                  onClick={closeOnboarding}
	                  style={{
	                    position: "absolute",
	                    top: 16,
	                    right: 16,
	                    width: 34,
	                    height: 34,
	                    borderRadius: "50%",
	                    border: "none",
	                    background: "rgba(5,5,5,0.12)",
	                    color: "#050505",
	                    fontSize: 18,
	                    fontWeight: 900,
	                    cursor: "pointer",
	                  }}
	                  aria-label="Close onboarding"
	                >
	                  ×
	                </button>
	                <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
	                  <CoinFlip size={78} />
	                  <div>
	                    <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.14em", opacity: 0.6, marginBottom: 6 }}>{item.eyebrow}</div>
	                    <div style={{ fontSize: 30, fontWeight: 900, lineHeight: 1 }}>{item.title}</div>
	                  </div>
	                </div>
	                <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.45, maxWidth: 300 }}>
	                  {item.body}
	                </div>
	              </div>
		              <div style={{ padding: 20 }}>
		                <div style={{ display: "flex", gap: 7, marginBottom: 18 }}>
	                  {ONBOARDING_STEPS.map((stepItem, index) => (
	                    <button
	                      key={stepItem.eyebrow}
	                      onClick={() => setOnboardingStep(index)}
	                      aria-label={`Go to onboarding step ${index + 1}`}
	                      style={{
	                        flex: 1,
	                        height: 5,
	                        borderRadius: 999,
	                        border: "none",
	                        background: index === onboardingStep ? "#19D12E" : "rgba(255,255,255,0.12)",
	                        cursor: "pointer",
	                      }}
	                    />
	                  ))}
	                </div>
		                {onboardingStep === 2 && (
		                  <div style={{ background: "#1B1B1B", borderRadius: 20, padding: 14, marginBottom: 16 }}>
		                    <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.12em", color: "rgba(255,255,255,0.34)", marginBottom: 8 }}>FRIEND CODE</div>
		                    <div style={{ fontSize: 13, color: "rgba(255,255,255,0.52)", lineHeight: 1.45 }}>
		                      Share your circle code with friends. When they enter it, they join your room and see the same private feed.
		                    </div>
		                  </div>
		                )}
		                {onboardingStep === ONBOARDING_STEPS.length - 1 && backendEnabled && !session ? (
		                  <div>
		                    <div style={{ display: "flex", gap: 8, background: "#1B1B1B", borderRadius: 999, padding: 5, marginBottom: 12 }}>
		                      {[
		                        { id: "join", label: "Create Account" },
		                        { id: "signin", label: "Sign In" },
		                      ].map((item) => (
		                        <button
		                          key={item.id}
		                          onClick={() => {
		                            setAuthMode(item.id);
		                            setBackendStatus("");
		                            setAuthNotice("");
		                          }}
		                          style={{
		                            flex: 1,
		                            border: "none",
		                            borderRadius: 999,
		                            padding: "10px 12px",
		                            background: authMode === item.id ? "#2A2A2A" : "transparent",
		                            color: authMode === item.id ? "#FAFAFA" : "rgba(255,255,255,0.42)",
		                            fontFamily: "'Sora', sans-serif",
		                            fontSize: 12,
		                            fontWeight: 900,
		                            cursor: "pointer",
		                          }}
		                        >
		                          {item.label}
		                        </button>
		                      ))}
		                    </div>
		                    {authMode === "join" && (
		                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
		                        <ProfileAvatar name={authForm.username || "You"} color={getAvatarColor(authForm.username || "You")} size={48} />
		                        <input
		                          className="field"
		                          placeholder="Display name"
		                          value={authForm.username}
		                          onChange={e => setAuthForm((current) => ({ ...current, username: e.target.value }))}
		                          style={{ flex: 1 }}
		                        />
		                      </div>
		                    )}
		                    <input
		                      className="field"
		                      placeholder="Email"
		                      value={authForm.email}
		                      onChange={e => setAuthForm((current) => ({ ...current, email: e.target.value }))}
		                      style={{ marginBottom: 10 }}
		                    />
		                    <input
		                      className="field"
		                      placeholder="Password"
		                      type="password"
		                      value={authForm.password}
		                      onChange={e => setAuthForm((current) => ({ ...current, password: e.target.value }))}
		                      style={{ marginBottom: 10 }}
		                    />
		                    {authMode === "join" && (
		                      <input
		                        className="field"
		                        placeholder="Friend code"
		                        value={authForm.inviteCode}
		                        onChange={e => setAuthForm((current) => ({ ...current, inviteCode: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") }))}
		                        style={{ marginBottom: 12 }}
		                      />
		                    )}
		                    {authNotice && (
		                      <div style={{ background: "rgba(25,209,46,0.1)", border: "1.5px solid rgba(25,209,46,0.2)", color: "#86EFAC", borderRadius: 16, padding: 12, fontSize: 13, fontWeight: 700, lineHeight: 1.4, marginBottom: 12 }}>
		                        {authNotice}
		                      </div>
		                    )}
		                    {backendStatus && (
		                      <div style={{ background: "rgba(239,68,68,0.1)", border: "1.5px solid rgba(239,68,68,0.2)", color: "#FCA5A5", borderRadius: 16, padding: 12, fontSize: 13, fontWeight: 700, lineHeight: 1.4, marginBottom: 12 }}>
		                        {backendStatus}
		                      </div>
		                    )}
		                    <button className="big-btn" onClick={authMode === "join" ? handleSignUp : handleSignIn} style={{ borderRadius: 22, background: "#19D12E", color: "#050505" }}>
		                      {authMode === "join" ? "Create Account" : "Sign In"}
		                    </button>
		                  </div>
		                ) : (
		                  <button className="big-btn" onClick={advanceOnboarding} style={{ borderRadius: 22, background: "#19D12E", color: "#050505" }}>
		                    {onboardingStep === ONBOARDING_STEPS.length - 1 ? "Start Wagering" : "Next"}
		                  </button>
		                )}
		              </div>
	            </div>
	          </div>
	        );
	      })()}

	      {confirmResetOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.62)",
            backdropFilter: "blur(8px)",
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 380,
              background: "#111115",
              border: "1.5px solid rgba(255,255,255,0.08)",
              borderRadius: 22,
              padding: 22,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.12em", color: "#FBBF24", marginBottom: 12 }}>CONFIRM RESET</div>
            <div style={{ fontSize: 23, fontWeight: 800, lineHeight: 1.15, marginBottom: 10 }}>Reset all BetCoin data?</div>
            <div style={{ fontSize: 14, color: "rgba(255,255,255,0.55)", lineHeight: 1.5, marginBottom: 18 }}>
              This clears your wallet, streak, cooldown, and all saved bets on this device.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="ghost-btn" onClick={() => setConfirmResetOpen(false)} style={{ flex: 1 }}>
                Cancel
              </button>
              <button
                onClick={resetApp}
                style={{
                  flex: 1,
                  background: "rgba(239,68,68,0.12)",
                  color: "#EF4444",
                  border: "2px solid rgba(239,68,68,0.25)",
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 20,
                  letterSpacing: "0.04em",
                  borderRadius: 18,
                  padding: "16px",
                  cursor: "pointer",
                }}
              >
                RESET
              </button>
            </div>
          </div>
        </div>
      )}

      {onTheLineOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.62)",
            backdropFilter: "blur(8px)",
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          onClick={() => setOnTheLineOpen(false)}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 380,
              background: "#111115",
              border: "1.5px solid rgba(255,255,255,0.08)",
              borderRadius: 24,
              padding: 22,
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", color: "rgba(255,255,255,0.34)", marginBottom: 8 }}>ON THE LINE</div>
                <div style={{ fontSize: 28, fontWeight: 800 }}>{formatBetCoin(reservedBalance)}</div>
              </div>
              <button className="ghost-btn" onClick={() => setOnTheLineOpen(false)} style={{ width: "auto", padding: "10px 14px" }}>
                Close
              </button>
            </div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", lineHeight: 1.45, marginBottom: 14 }}>
              These are the live bets currently reserving your BetCoin.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 360, overflowY: "auto" }}>
              {liveExposureItems.map((item) => (
                <div key={item.id} style={{ background: "#18181C", borderRadius: 18, padding: 14 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.3, marginBottom: 6 }}>{item.title}</div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.42)" }}>{item.subtitle}</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: "#FBBF24" }}>{formatBetCoin(item.amount)}</div>
                  </div>
                </div>
              ))}
              {liveExposureItems.length === 0 && (
                <div style={{ background: "#18181C", borderRadius: 18, padding: 20, textAlign: "center", color: "rgba(255,255,255,0.38)" }}>
                  Nothing is on the line right now.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {screen === "home" && (
        <div className="screen" style={{ padding: "56px 24px 124px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.14em", color: "rgba(255,255,255,0.34)", marginBottom: 8 }}>WAGER</div>
              <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1 }}>Wallet</div>
            </div>
            <BalanceBadge balance={availableBalance} />
          </div>

          <div style={{ background: "linear-gradient(180deg, #1D1D1D 0%, #161616 100%)", borderRadius: 34, padding: 22, marginBottom: 18, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "rgba(255,255,255,0.72)" }}>Available BetCoin</div>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", color: reservedBalance > 0 ? "#FBBF24" : "rgba(255,255,255,0.32)" }}>
                {reservedBalance > 0 ? "MONEY IN PLAY" : "READY TO BET"}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 18 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 60, fontWeight: 800, lineHeight: 0.95 }}>{availableBalance.toLocaleString("en-US")}</div>
              </div>
              <div style={{ width: 112, display: "flex", justifyContent: "center", position: "relative" }}>
                <div style={{ position: "absolute", inset: 10, borderRadius: "50%", background: "radial-gradient(circle, rgba(0,200,122,0.18), rgba(0,200,122,0))" }} />
                <CoinFace size={108} />
              </div>
            </div>
            <button
              onClick={() => setOnTheLineOpen(true)}
              style={{
                width: "100%",
                marginBottom: 18,
                background: "#121212",
                border: "1px solid rgba(255,255,255,0.05)",
                borderRadius: 22,
                padding: 16,
                color: "#FAFAFA",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", color: "rgba(255,255,255,0.32)", marginBottom: 8 }}>ON THE LINE</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: reservedBalance > 0 ? "#FBBF24" : "#FAFAFA" }}>{formatBetCoin(reservedBalance)}</div>
                </div>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.12em", color: "rgba(255,255,255,0.4)" }}>
                  VIEW LIVE BETS
                </div>
              </div>
            </button>
            <div style={{ display: "flex", gap: 12 }}>
              <button className="ghost-btn" onClick={() => switchTab("feed")} style={{ flex: 1, borderRadius: 22, background: "#262626", color: "#FAFAFA" }}>
                Go To Feed
              </button>
              <button className="ghost-btn" onClick={startNew} style={{ flex: 1, borderRadius: 22, background: "#262626", color: "#FAFAFA" }}>
                New Bet
              </button>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
            <div style={{ flex: 1, background: "#121212", borderRadius: 24, padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", color: "rgba(255,255,255,0.34)", marginBottom: 8 }}>OPEN</div>
              <div style={{ fontSize: 30, fontWeight: 800 }}>{pending.length}</div>
            </div>
            <div style={{ flex: 1, background: "#121212", borderRadius: 24, padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", color: "rgba(255,255,255,0.34)", marginBottom: 8 }}>STREAK</div>
              <div style={{ fontSize: 30, fontWeight: 800, color: winStreak ? "#19D12E" : "#FAFAFA" }}>{winStreak ? `x${winStreak}` : "x0"}</div>
            </div>
          </div>

          {(isBroke || (balance === 0 && reupCountdown)) && (
            <div style={{ background: "#121212", borderRadius: 28, padding: 20, marginBottom: 18 }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", color: "#FBBF24", marginBottom: 8 }}>RE-UP</div>
              <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.3, marginBottom: 8 }}>
                {canClaimReup ? `Claim ${formatBetCoin(REUP_AMOUNT)} and get back in the game.` : "Your next BetCoin re-up is on cooldown."}
              </div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", marginBottom: 14 }}>
                {canClaimReup ? "Re-ups only unlock at zero so the stack still feels earned." : `Next re-up in ${reupCountdown}`}
              </div>
              {canClaimReup && (
                <button className="big-btn" onClick={claimReup} style={{ borderRadius: 22 }}>
                  CLAIM RE-UP
                </button>
              )}
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.12em", color: "rgba(255,255,255,0.34)" }}>PRIVATE BETS</div>
            <button onClick={() => switchTab("history")} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.38)", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
              View all
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {allActivity.slice(0, 5).map((bet) => (
              <button
                key={bet.id}
                className="card"
                onClick={() => openBet(bet, "home")}
                style={{ background: "#121212", borderRadius: 26, border: "none", padding: 18, textAlign: "left" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ width: 52, height: 52, borderRadius: 20, background: bet.status === "p1_won" ? "#19D12E" : "#202020", color: bet.status === "p1_won" ? "#050505" : "#FAFAFA", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 800, flexShrink: 0 }}>
                    {bet.status === "p1_won" ? "+" : bet.status === "p2_won" ? "-" : "B"}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.3, marginBottom: 4 }}>{bet.what}</div>
                    <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)" }}>{bet.date}</div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: bet.status === "p1_won" ? "#19D12E" : "#FAFAFA" }}>{getWagerLabel(bet)}</div>
                    <div style={{ fontSize: 11, color: statusColor(bet.status), fontWeight: 800, marginTop: 4 }}>{statusLabel(bet.status)}</div>
                  </div>
                </div>
              </button>
            ))}
            {allActivity.length === 0 && (
              <div style={{ background: "#121212", borderRadius: 26, padding: 28, textAlign: "center", color: "rgba(255,255,255,0.34)" }}>
                No bets yet. Hit Bet and send one out.
              </div>
            )}
          </div>

          <button onClick={() => setConfirmResetOpen(true)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.18)", fontSize: 12, fontWeight: 600, cursor: "pointer", marginTop: 18, width: "100%", fontFamily: "'Sora', sans-serif" }}>
            Reset BetCoin data
          </button>
        </div>
      )}

      {screen === "feed" && (
        <div className="screen" style={{ padding: "56px 24px 124px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.14em", color: "rgba(255,255,255,0.34)", marginBottom: 8 }}>WAGER</div>
              <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1 }}>Wager Feed</div>
              <div style={{ marginTop: 8, fontSize: 13, color: "rgba(255,255,255,0.42)", fontWeight: 700 }}>
                Pick a side, post a bet, settle the fun.
              </div>
            </div>
	            <div style={{ display: "flex", alignItems: "center", gap: 10, position: "relative" }}>
	              <button
	                onClick={() => setFeedComposerOpen(true)}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "#1A1A1A",
                  color: "#FAFAFA",
                  fontSize: 28,
                  lineHeight: 1,
                  cursor: "pointer",
                  flexShrink: 0,
                }}
                aria-label="Post a feed bet"
	              >
	                +
	              </button>
	              {backendEnabled && session ? (
	                <button
	                  onClick={() => setProfileMenuOpen((open) => !open)}
	                  style={{
	                    display: "flex",
	                    alignItems: "center",
	                    gap: 8,
	                    border: "1px solid rgba(255,255,255,0.08)",
	                    background: "#1A1A1A",
	                    color: "#FAFAFA",
	                    borderRadius: 999,
	                    padding: "8px 10px 8px 8px",
	                    cursor: "pointer",
	                    maxWidth: 166,
	                  }}
	                >
	                  <ProfileAvatar name={profileName} color={profileColor} size={32} />
	                  <div style={{ textAlign: "left", minWidth: 0 }}>
	                    <div style={{ fontSize: 12, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{profileName}</div>
	                    <div style={{ fontSize: 10, fontWeight: 800, color: "#19D12E" }}>{availableBalance.toLocaleString("en-US")} BC</div>
	                  </div>
	                </button>
	              ) : (
	                <BalanceBadge balance={availableBalance} />
	              )}
	              {profileMenuOpen && backendEnabled && session && (
	                <div
	                  style={{
	                    position: "absolute",
	                    right: 0,
	                    top: 54,
	                    width: 236,
	                    background: "#111115",
	                    border: "1.5px solid rgba(255,255,255,0.08)",
	                    borderRadius: 22,
	                    padding: 16,
	                    zIndex: 35,
	                    boxShadow: "0 20px 54px rgba(0,0,0,0.42)",
	                  }}
	                >
	                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
	                    <ProfileAvatar name={profileName} color={profileColor} size={48} />
	                    <div style={{ minWidth: 0 }}>
	                      <div style={{ fontSize: 16, fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{profileName}</div>
	                      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.42)", marginTop: 4 }}>Streak x{winStreak}</div>
	                    </div>
	                  </div>
	                  <div style={{ background: "#1B1B1B", borderRadius: 16, padding: 12, marginBottom: 12 }}>
	                    <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.12em", color: "rgba(255,255,255,0.34)", marginBottom: 6 }}>BETCOIN</div>
	                    <div style={{ fontSize: 20, fontWeight: 900, color: "#19D12E" }}>{formatBetCoin(availableBalance)}</div>
	                  </div>
	                  <button className="ghost-btn" onClick={handleSignOut} style={{ color: "#FAFAFA" }}>
	                    Sign Out
	                  </button>
	                </div>
	              )}
	            </div>
	          </div>

			          {backendEnabled && !session && !onboardingOpen && (
			            <div style={{ background: "#121212", borderRadius: 30, padding: 20, marginBottom: 18, textAlign: "center" }}>
			              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", color: "#19D12E", marginBottom: 8 }}>WELCOME</div>
			              <div style={{ fontSize: 22, fontWeight: 900, lineHeight: 1.2, marginBottom: 10 }}>Create your account in onboarding.</div>
			              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.48)", lineHeight: 1.45, marginBottom: 14 }}>
			                We moved account setup into the final onboarding step so this feed stays clean.
			              </div>
			              <button className="big-btn" onClick={() => { setOnboardingStep(ONBOARDING_STEPS.length - 1); setOnboardingOpen(true); }} style={{ borderRadius: 22, background: "#19D12E", color: "#050505" }}>
			                Open Onboarding
			              </button>
			            </div>
			          )}

		          {backendEnabled && session && (
		            <div style={{ background: "#121212", borderRadius: 26, padding: 16, marginBottom: 18 }}>
		              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
		                <div>
		                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", color: "rgba(255,255,255,0.34)", marginBottom: 6 }}>FRIEND CIRCLE</div>
			                  <div style={{ fontSize: 18, fontWeight: 800 }}>{activeCircle?.name || (circles.length ? "Choose a circle" : "Enter a friend code or create your own circle.")}</div>
		                </div>
		              </div>
		              <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
		                <input
		                  className="field"
		                  placeholder="Name your circle"
		                  value={newCircleName}
		                  onChange={e => setNewCircleName(e.target.value)}
		                  style={{ flex: 1, padding: "12px 14px", borderRadius: 16, fontSize: 13 }}
		                />
		                <button className="ghost-btn" onClick={handleCreateCircle} style={{ width: "auto", padding: "10px 14px", color: "#FAFAFA" }}>
		                  Create
		                </button>
		              </div>
		              {circles.length > 0 && (
		                <div style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 10 }}>
	                  {circles.map((circle) => (
	                    <button
	                      key={circle.id}
	                      className={`chip ${activeCircleId === circle.id ? "picked" : ""}`}
	                      onClick={() => setActiveCircleId(circle.id)}
	                    >
	                      {circle.name}
	                    </button>
		                  ))}
		                </div>
		              )}
		              {activeCircle && (
		                <div style={{ background: "#1B1B1B", borderRadius: 20, padding: 14, marginBottom: 12 }}>
		                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
		                    <div>
			                      <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(25,209,46,0.12)", color: "#86EFAC", border: "1px solid rgba(25,209,46,0.18)", borderRadius: 999, padding: "6px 9px", fontSize: 11, fontWeight: 900, marginBottom: 10 }}>
			                        YOU'RE IN THIS CIRCLE
			                      </div>
			                      <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.12em", color: "rgba(255,255,255,0.34)", marginBottom: 8 }}>FRIEND CODE</div>
		                      <div style={{ fontSize: 26, fontWeight: 900, letterSpacing: "0.08em", color: "#19D12E" }}>{activeCircle.invite_code}</div>
		                    </div>
		                    <button className="ghost-btn" onClick={shareAccessCode} style={{ width: "auto", padding: "12px 14px", color: "#FAFAFA" }}>
		                      Share
		                    </button>
		                  </div>
		                </div>
		              )}
			              <div style={{ display: "flex", gap: 10 }}>
			                <input
			                  className="field"
			                  placeholder="Join another code"
			                  value={joinCode}
		                  onChange={e => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
		                  style={{ flex: 1, padding: "12px 14px", borderRadius: 16, fontSize: 13 }}
		                />
		                <button className="ghost-btn" onClick={handleJoinCircle} style={{ width: "auto", padding: "10px 14px", color: "#FAFAFA" }}>
		                  Join
		                </button>
		              </div>
		            </div>
		          )}

	          {backendStatus && (
	            <div style={{ background: "rgba(239,68,68,0.1)", border: "1.5px solid rgba(239,68,68,0.2)", color: "#FCA5A5", borderRadius: 18, padding: 14, fontSize: 13, fontWeight: 700, lineHeight: 1.4, marginBottom: 18 }}>
	              {backendStatus}
	            </div>
	          )}

	          {creatorResultPosts.length > 0 && (
            <div style={{ background: "rgba(251,191,36,0.12)", border: "1.5px solid rgba(251,191,36,0.24)", borderRadius: 26, padding: 18, marginBottom: 18 }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", color: "#FBBF24", marginBottom: 8 }}>RESULT REMINDER</div>
              <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.25, marginBottom: 8 }}>
                {creatorResultPosts.length === 1 ? "One of your markets is ready to settle." : `${creatorResultPosts.length} of your markets are ready to settle.`}
              </div>
	                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.58)", lineHeight: 1.45 }}>
	                Open your cards below and choose the winner.
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginBottom: 18, background: "#151515", borderRadius: 999, padding: 6 }}>
            {[
	              { id: "feed", label: "All" },
	              { id: "yours", label: "Mine" },
            ].map((item) => {
              const active = feedView === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setFeedView(item.id);
                    setExpandedFeedPostId(null);
                  }}
                  style={{
                    flex: 1,
                    border: "none",
                    borderRadius: 999,
                    padding: "12px 14px",
                    background: active ? "#2A2A2A" : "transparent",
                    color: active ? "#FAFAFA" : "rgba(255,255,255,0.45)",
                    fontFamily: "'Sora', sans-serif",
                    fontSize: 13,
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {visibleFeedPosts.map((post) => {
              const draftState = feedBetDrafts[post.id] || { bettorName: CURRENT_USER, choice: "A", amount: "" };
              const choiceATotal = getFeedChoiceTotal(post, "A");
              const choiceBTotal = getFeedChoiceTotal(post, "B");
              const isExpanded = expandedFeedPostId === post.id;
              const canBetNow = post.status === "open" && !isFeedClosedForBetting(post);
              return (
                <div
                  key={post.id}
                  onClick={() => setExpandedFeedPostId((current) => current === post.id ? null : post.id)}
                  style={{ background: "#121212", borderRadius: 30, padding: 20, cursor: "pointer" }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.12em", color: "rgba(255,255,255,0.34)", marginBottom: 8 }}>
                        {post.category} • @{post.creator}
                      </div>
                      <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.2 }}>{post.prompt}</div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: post.status === "settled" ? "#19D12E" : "rgba(255,255,255,0.5)", marginBottom: 8 }}>
                        {feedStatusLabel(post)}
                      </div>
                      <div style={{ fontSize: 22, fontWeight: 800 }}>{formatBetCoin(getFeedPot(post))}</div>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.38)" }}>total pot</div>
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                      {[
                      { key: "A", label: post.optionA, total: choiceATotal, odds: post.oddsA },
                      { key: "B", label: post.optionB, total: choiceBTotal, odds: post.oddsB },
                    ].map((choice) => (
                      <div
                        key={choice.key}
                        style={{
                          flex: 1,
                          borderRadius: 24,
                          padding: 14,
                          background: post.status === "settled" && post.winningChoice === choice.key ? "rgba(25,209,46,0.12)" : "#1B1B1B",
                          border: `1.5px solid ${draftState.choice === choice.key ? "#19D12E" : "rgba(255,255,255,0.06)"}`,
                        }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>{choice.label}</div>
                        <div style={{ fontSize: 18, fontWeight: 800 }}>{formatBetCoin(choice.total)}</div>
                        {post.pricingMode === "odds" && (
                          <div style={{ fontSize: 11, fontWeight: 800, color: "rgba(255,255,255,0.4)", marginTop: 6 }}>
                            {formatOdds(choice.odds)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
	                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.42)", lineHeight: 1.45, flex: 1, marginBottom: isExpanded ? 0 : 2 }}>
	                      Tap the card for recent bets and result controls.
                    </div>
                    <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
	                      <button
	                        className="ghost-btn"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (!canBetNow) return;
                          setFeedBetModalPostId(post.id);
                        }}
                        style={{
                          width: "auto",
                          padding: "12px 16px",
                          background: canBetNow ? "#19D12E" : "#202020",
                          color: canBetNow ? "#050505" : "rgba(255,255,255,0.35)",
                          borderColor: canBetNow ? "rgba(25,209,46,0.28)" : "rgba(255,255,255,0.08)",
                        }}
                      >
	                        Bet
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div onClick={(event) => event.stopPropagation()} style={{ marginTop: 14 }}>
                      {post.wagers.length > 0 && (
                        <div style={{ background: "#1B1B1B", borderRadius: 22, padding: 14, marginBottom: 12 }}>
                          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", color: "rgba(255,255,255,0.34)", marginBottom: 10 }}>RECENT BETS</div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {post.wagers.slice(0, 5).map((wager) => (
                              <div key={wager.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                                <div style={{ fontSize: 14, fontWeight: 700 }}>
                                  {wager.bettorName} <span style={{ color: "rgba(255,255,255,0.4)" }}>on {wager.choice === "A" ? post.optionA : post.optionB}</span>
                                </div>
                                <div style={{ fontSize: 14, fontWeight: 800, color: wager.isLocal ? "#19D12E" : "#FAFAFA" }}>
                                  {formatBetCoin(wager.amount)}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {post.status === "open" && (
                        <button
                          className="big-btn"
                          onClick={() => {
                            if (!canBetNow) return;
                            setFeedBetModalPostId(post.id);
                          }}
                          style={{
                            marginBottom: canFeedOwnerSettle(post) || isFeedAwaitingCreatorResult(post) ? 12 : 0,
                            borderRadius: 22,
                            background: canBetNow ? "#19D12E" : "#202020",
                            color: canBetNow ? "#050505" : "rgba(255,255,255,0.38)",
                            boxShadow: "none",
                          }}
                        >
                          Place Bet
                        </button>
                      )}

                      {(isFeedAwaitingCreatorResult(post) || canFeedOwnerSettle(post)) && (
                        isFeedOwner(post) ? (
                          <div style={{ background: "rgba(251,191,36,0.08)", border: "1.5px solid rgba(251,191,36,0.18)", borderRadius: 22, padding: 14 }}>
                            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", color: "#FBBF24", marginBottom: 10 }}>POST THE RESULT</div>
                            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 1.45, marginBottom: 12 }}>
                              {post.endsAt
                                ? "This market hit its end time. Pick the winner and the pot will settle across both sides."
                                : "Pick the winner whenever the result is in and the pot will settle across both sides."}
                            </div>
                            <div style={{ display: "flex", gap: 10 }}>
                              <button className="ghost-btn" onClick={() => settleFeedPost(post.id, "A")} style={{ flex: 1, background: "#1B1B1B", color: "#FAFAFA" }}>
                                {post.optionA} Won
                              </button>
                              <button className="ghost-btn" onClick={() => settleFeedPost(post.id, "B")} style={{ flex: 1, background: "#1B1B1B", color: "#FAFAFA" }}>
                                {post.optionB} Won
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ background: "#1B1B1B", borderRadius: 22, padding: 14, fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 1.45 }}>
                            Waiting on @{post.creator} to post the result so the market can settle.
                          </div>
                        )
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {visibleFeedPosts.length === 0 && (
              <div style={{ background: "#121212", borderRadius: 30, padding: 28, textAlign: "center", color: "rgba(255,255,255,0.34)" }}>
                {feedView === "yours"
                  ? "You have not posted any live feed bets yet. Hit the plus button and make one."
                  : "Nothing on the feed yet. Hit the plus button and post a community bet."}
              </div>
            )}
          </div>

          {feedBetModalPost && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.62)",
                backdropFilter: "blur(8px)",
                zIndex: 55,
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "center",
                padding: 18,
              }}
              onClick={() => setFeedBetModalPostId(null)}
            >
              <div
                style={{
                  width: "100%",
                  maxWidth: 392,
                  background: "#111115",
                  border: "1.5px solid rgba(255,255,255,0.08)",
                  borderRadius: 28,
                  padding: 20,
                }}
                onClick={(event) => event.stopPropagation()}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", color: "rgba(255,255,255,0.34)", marginBottom: 8 }}>PLACE A BET</div>
                    <div style={{ fontSize: 23, fontWeight: 800, lineHeight: 1.2 }}>{feedBetModalPost.prompt}</div>
                  </div>
                  <button className="ghost-btn" onClick={() => setFeedBetModalPostId(null)} style={{ width: "auto", padding: "10px 14px" }}>
                    Close
                  </button>
                </div>
                <input
                  className="field"
                  placeholder="Bettor name"
                  value={(feedBetDrafts[feedBetModalPost.id]?.bettorName) || CURRENT_USER}
                  onChange={e => updateFeedBetDraft(feedBetModalPost.id, { bettorName: e.target.value })}
                  style={{ marginBottom: 10 }}
                />
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                  <button
                    className={`chip ${(feedBetDrafts[feedBetModalPost.id]?.choice || "A") !== "B" ? "picked" : ""}`}
                    onClick={() => updateFeedBetDraft(feedBetModalPost.id, { choice: "A" })}
                  >
                    {feedBetModalPost.optionA}
                  </button>
                  <button
                    className={`chip ${(feedBetDrafts[feedBetModalPost.id]?.choice || "A") === "B" ? "picked" : ""}`}
                    onClick={() => updateFeedBetDraft(feedBetModalPost.id, { choice: "B" })}
                  >
                    {feedBetModalPost.optionB}
                  </button>
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <input
                    className="field"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="BetCoin amount"
                    value={feedBetDrafts[feedBetModalPost.id]?.amount || ""}
                    onChange={e => updateFeedBetDraft(feedBetModalPost.id, { amount: e.target.value.replace(/[^\d]/g, "") })}
                    style={{ flex: 1 }}
                  />
                  <button
                    className="big-btn"
	                    onClick={async () => {
	                      const didPlace = await placeFeedBet(feedBetModalPost.id);
	                      if (didPlace) setFeedBetModalPostId(null);
	                    }}
                    style={{ flex: 1, borderRadius: 20 }}
                  >
                    Bet
                  </button>
                </div>
                {((feedBetDrafts[feedBetModalPost.id]?.bettorName) || CURRENT_USER).trim().toLowerCase() === CURRENT_USER.toLowerCase() && (
                  <div style={{ marginTop: 10, fontSize: 12, color: "rgba(255,255,255,0.45)" }}>
                    Your local wallet can currently back up to {formatBetCoin(availableBalance)}.
                  </div>
                )}
              </div>
            </div>
          )}

          {feedComposerOpen && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.62)",
                backdropFilter: "blur(8px)",
                zIndex: 50,
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "center",
                padding: 18,
              }}
              onClick={() => setFeedComposerOpen(false)}
            >
              <div
                style={{
                  width: "100%",
                  maxWidth: 392,
                  background: "#111115",
                  border: "1.5px solid rgba(255,255,255,0.08)",
                  borderRadius: 28,
                  padding: 20,
                }}
                onClick={(event) => event.stopPropagation()}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", color: "rgba(255,255,255,0.34)", marginBottom: 8 }}>POST A BET</div>
                    <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.15 }}>Create A Market Bet</div>
                  </div>
                  <button className="ghost-btn" onClick={() => setFeedComposerOpen(false)} style={{ width: "auto", padding: "10px 14px" }}>
                    Close
                  </button>
                </div>
                <input
                  className="field"
                  placeholder="Creator name"
                  value={feedDraft.creator}
                  onChange={e => setFeedDraft((current) => ({ ...current, creator: e.target.value }))}
                  style={{ marginBottom: 12 }}
                />
                <textarea
                  className="field"
                  rows={3}
                  placeholder='e.g. "Jackson over or under 10 drinks tonight?"'
                  value={feedDraft.prompt}
                  onChange={e => setFeedDraft((current) => ({ ...current, prompt: e.target.value }))}
                  style={{ marginBottom: 12 }}
                />
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                  {FEED_TEMPLATES.map((template) => (
                    <button
                      key={template.id}
                      className={`chip ${feedDraft.category === template.label ? "picked" : ""}`}
                      onClick={() => applyFeedTemplate(template)}
                    >
                      {template.label}
                    </button>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                  <input
                    className="field"
                    placeholder="Side A"
                    value={feedDraft.optionA}
                    onChange={e => setFeedDraft((current) => ({ ...current, optionA: e.target.value }))}
                    style={{ flex: 1 }}
                  />
                  <input
                    className="field"
                    placeholder="Side B"
                    value={feedDraft.optionB}
                    onChange={e => setFeedDraft((current) => ({ ...current, optionB: e.target.value }))}
                    style={{ flex: 1 }}
                  />
                </div>
	                <div style={{ background: "#171717", borderRadius: 18, padding: 14, marginBottom: 12 }}>
	                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", color: "rgba(255,255,255,0.34)", marginBottom: 6 }}>PAYOUT</div>
	                  <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 1.45 }}>
	                    No house. Winners split the losing side's BetCoin.
	                  </div>
	                </div>
	                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", color: "rgba(255,255,255,0.34)", marginBottom: 8 }}>END DATE OPTIONAL</div>
                <input
                  className="field"
                  type="datetime-local"
                  value={feedDraft.endsAt}
                  onChange={e => setFeedDraft((current) => ({ ...current, endsAt: e.target.value }))}
                  style={{ marginBottom: 14 }}
                />
                <button className="big-btn" onClick={createFeedPost} style={{ borderRadius: 20 }}>
                  POST
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {screen === "bet" && (
        <div className="screen" style={{ padding: "54px 24px 176px" }}>
          <div style={{ marginBottom: 24 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 42, fontWeight: 900, lineHeight: 0.95 }}>Live Bet</div>
              <div style={{ marginTop: 8, fontSize: 16, fontWeight: 700, color: "rgba(5,5,5,0.62)" }}>Bet Now</div>
              <div style={{ marginTop: 12, display: "flex", justifyContent: "center" }}>
                <div style={{ transform: "scale(0.88)", transformOrigin: "center top" }}>
                  <BalanceBadge balance={availableBalance} />
                </div>
              </div>
            </div>
          </div>

          <div style={{ background: "rgba(5,5,5,0.08)", borderRadius: 28, padding: "16px 18px", marginBottom: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", color: "rgba(5,5,5,0.45)", marginBottom: 8 }}>
              {betStepTitle}
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.25, color: draft.what.trim() ? "#050505" : "rgba(5,5,5,0.38)", marginBottom: 8 }}>
              {step === 1
                ? (draft.what.trim() || "Type the bet you want to make")
                : (draft.what.trim() || "Add the bet first")}
            </div>
            <div style={{ fontSize: 13, color: "rgba(5,5,5,0.55)", lineHeight: 1.4 }}>
              {betStepSubtitle}
            </div>
          </div>

          <div style={{ background: "rgba(0,0,0,0.92)", color: "#FAFAFA", borderRadius: 34, padding: 22, marginBottom: 16, boxShadow: "0 20px 48px rgba(0,0,0,0.18)" }}>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.12em", color: "rgba(255,255,255,0.34)", marginBottom: 10 }}>BET IDEA</div>
              <textarea
                className="field"
                rows={3}
                placeholder='e.g. "Lakers by 10 tonight"'
                value={draft.what}
                onChange={e => setDraft(d => ({ ...d, what: e.target.value }))}
                style={{ background: "#151518", borderRadius: 20, minHeight: 112 }}
              />
            </div>

            {step >= 2 && (
              <>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.12em", color: "rgba(255,255,255,0.34)", marginBottom: 10 }}>ON THE LINE</div>
                <div style={{ display: "flex", gap: 10, marginBottom: 16, background: "#151518", padding: 6, borderRadius: 22 }}>
                  <button
                    className={`mode-btn ${draft.wagerType === "betcoin" ? "active" : ""}`}
                    onClick={() => setDraft(d => ({ ...d, wagerType: "betcoin" }))}
                    style={{ border: "none", borderRadius: 16, background: draft.wagerType === "betcoin" ? "rgba(0,200,122,0.12)" : "transparent", boxShadow: "none" }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", marginBottom: 4 }}>BETCOIN</div>
                    <div style={{ fontSize: 12, opacity: 0.78 }}>Use your wallet</div>
                  </button>
                  <button
                    className={`mode-btn ${draft.wagerType === "side" ? "active" : ""}`}
                    onClick={() => setDraft(d => ({ ...d, wagerType: "side" }))}
                    style={{ border: "none", borderRadius: 16, background: draft.wagerType === "side" ? "rgba(0,200,122,0.12)" : "transparent", boxShadow: "none" }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", marginBottom: 4 }}>FRIENDLY</div>
                    <div style={{ fontSize: 12, opacity: 0.78 }}>Dinner or drinks</div>
                  </button>
                </div>

                {draft.wagerType === "betcoin" ? (
                  <>
                    <div style={{ background: "#151518", borderRadius: 24, padding: 16, marginBottom: 14 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <CoinFace size={52} />
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", color: "rgba(255,255,255,0.34)", marginBottom: 6 }}>AVAILABLE</div>
                          <div style={{ fontSize: 28, fontWeight: 800, color: "#19D12E" }}>{formatBetCoin(availableBalance)}</div>
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                      {QUICK_BETCOIN.map(amount => (
                        <button key={amount} className={`chip ${draftBetCoinAmount === amount ? "picked" : ""}`} onClick={() => setDraft(d => ({ ...d, betCoinAmount: String(amount) }))}>
                          {formatBetCoin(amount)}
                        </button>
                      ))}
                    </div>
                    <input
                      className="field"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      placeholder="Enter BetCoin amount"
                      value={draft.betCoinAmount}
                      onChange={e => setDraft(d => ({ ...d, betCoinAmount: e.target.value.replace(/[^\d]/g, "") }))}
                      style={{ background: "#151518", borderRadius: 20 }}
                    />
                    {draftCoinTooHigh && (
                      <div style={{ fontSize: 12, color: "#FBBF24", fontWeight: 700, marginTop: 10 }}>
                        That amount is higher than your available BetCoin.
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                      {QUICK_WAGERS.map(w => (
                        <button key={w} className={`chip ${draft.wager === w ? "picked" : ""}`} onClick={() => setDraft(d => ({ ...d, wager: w }))}>
                          {w}
                        </button>
                      ))}
                    </div>
                    {draft.wager === "Custom..." && (
                      <input
                        className="field"
                        placeholder="Type your wager..."
                        value={draft.custom}
                        onChange={e => setDraft(d => ({ ...d, custom: e.target.value }))}
                        style={{ background: "#151518", borderRadius: 20 }}
                      />
                    )}
                  </>
                )}
              </>
            )}

          </div>

          <div style={{ position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: showTabBar ? 96 : 20, width: "calc(100% - 32px)", maxWidth: 388, zIndex: 20 }}>
            <div style={{ background: "rgba(8,8,8,0.18)", borderRadius: 28, padding: 10, backdropFilter: "blur(10px)" }}>
              <div style={{ display: "flex", gap: 10 }}>
              {step > 1 && (
                <button className="ghost-btn" onClick={() => { setReviewTicketOpen(false); setStep(step - 1); }} style={{ flex: 1, borderRadius: 20, background: "rgba(0,0,0,0.16)", color: "#050505", borderColor: "rgba(5,5,5,0.12)" }}>
                  Back
                </button>
              )}
              <button className="big-btn" disabled={!canSubmitBet || locked} onClick={runBetPrimary} style={{ flex: step > 1 ? 2 : 1, borderRadius: 24, background: "#050505", color: "#FAFAFA", boxShadow: "none" }}>
                {locked ? "LOCKED" : betPagePrimary}
              </button>
              </div>
            </div>
          </div>

          {reviewTicketOpen && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.54)",
                backdropFilter: "blur(8px)",
                zIndex: 45,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 20,
              }}
              onClick={() => setReviewTicketOpen(false)}
            >
              <div
                style={{
                  width: "100%",
                  maxWidth: 380,
                  background: "#0F1013",
                  color: "#FAFAFA",
                  borderRadius: 28,
                  padding: 22,
                  boxShadow: "0 24px 70px rgba(0,0,0,0.32)",
                  border: "1.5px solid rgba(255,255,255,0.08)",
                }}
                onClick={(event) => event.stopPropagation()}
              >
                <div style={{ textAlign: "center", marginBottom: 18 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.16em", color: "rgba(255,255,255,0.34)", marginBottom: 10 }}>
                    CONFIRM TICKET
                  </div>
                  <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 36, letterSpacing: "0.04em", color: "#19D12E" }}>
                    LIVE BET TICKET
                  </div>
                </div>

                <div style={{ background: "#15161A", borderRadius: 22, padding: 16, marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", color: "rgba(255,255,255,0.34)", marginBottom: 8 }}>
                    BET
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.35 }}>
                    {draft.what || "Add the bet details above."}
                  </div>
                </div>

                <div style={{ background: "#15161A", borderRadius: 22, padding: 16, marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", color: "rgba(255,255,255,0.34)", marginBottom: 8 }}>
                    ON THE LINE
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: draft.wagerType === "betcoin" ? "#19D12E" : "#FAFAFA" }}>
                    {draftWagerLabel || "Choose what’s on the line"}
                  </div>
                </div>

                {draft.wagerType === "betcoin" && (
                  <div style={{ background: "#15161A", borderRadius: 22, padding: 16, marginBottom: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", color: "rgba(255,255,255,0.34)", marginBottom: 8 }}>
                          AFTER THIS BET
                        </div>
                        <div style={{ fontSize: 18, fontWeight: 800 }}>
                          {formatBetCoin(Math.max(availableBalance - (draftBetCoinAmount || 0), 0))}
                        </div>
                      </div>
                      <CoinFace size={52} />
                    </div>
                  </div>
                )}

                <button className="ghost-btn" onClick={shareDraftBet} style={{ marginBottom: 10, background: "#17191D", color: "#FAFAFA", borderColor: "rgba(255,255,255,0.1)", borderRadius: 18 }}>
                  Send To A Friend
                </button>
                <div style={{ display: "flex", gap: 10 }}>
                  <button className="ghost-btn" onClick={() => setReviewTicketOpen(false)} style={{ flex: 1, borderRadius: 18, background: "#17191D", color: "#FAFAFA", borderColor: "rgba(255,255,255,0.1)" }}>
                    Edit Ticket
                  </button>
                  <button className="big-btn" onClick={lockBet} style={{ flex: 1, borderRadius: 18 }}>
                    Bet
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── BET DETAIL ── */}
      {screen === "detail" && activeBet && (() => {
        const bet = bets.find(b => b.id === activeBet.id) || activeBet;
        const wagerVal = getWagerLabel(bet);
        const betCoinAmount = getBetCoinAmount(bet);
        const isOpen   = bet.status === "open";
        const isLocked = bet.status === "locked";
        const isDone   = bet.status === "p1_won" || bet.status === "p2_won" || bet.status === "disputed";

        return (
          <div className="screen" style={{ padding: "52px 24px 40px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 36 }}>
              <button className="back-btn" onClick={() => setScreen(detailOrigin)}>←</button>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, letterSpacing: "0.04em" }}>THE BET</div>
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
                <BalanceBadge balance={availableBalance} />
                <span style={{ fontSize: 10, fontWeight: 700, color: statusColor(bet.status), background: `${statusColor(bet.status)}18`, padding: "4px 10px", borderRadius: 20 }}>
                  {statusLabel(bet.status)}
                </span>
              </div>
            </div>

            {/* Bet card */}
            <div style={{ background: "#111115", border: "1.5px solid rgba(255,255,255,0.08)", borderRadius: 22, padding: "28px 22px", marginBottom: 24, animation: "slideUp 0.2s ease" }}>
              <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.4, marginBottom: 20 }}>"{bet.what}"</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 32, color: "#00C87A", letterSpacing: "0.04em" }}>{wagerVal}</div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", fontWeight: 600 }}>on the line</div>
              </div>
              <div style={{ marginTop: 14, fontSize: 11, color: "rgba(255,255,255,0.2)", fontWeight: 600 }}>{bet.date}</div>
            </div>

            <button className="ghost-btn" onClick={() => shareBet(bet)} style={{ marginBottom: 24 }}>
              Send To A Friend
            </button>

            {/* BOTH SAY BET - the main interaction */}
            {(isOpen || isLocked) && (
              <>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", color: "rgba(255,255,255,0.3)", marginBottom: 14, textAlign: "center" }}>
                  {isLocked ? "BOTH IN — SETTLE WHEN DONE" : "BOTH PRESS YOUR BET"}
                </div>

                {isLocked ? (
                  <div style={{ background: "rgba(0,200,122,0.08)", border: "2px solid rgba(0,200,122,0.3)", borderRadius: 20, padding: "28px", textAlign: "center", marginBottom: 24, animation: "popIn 0.4s ease" }}>
                    <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 44, color: "#00C87A", letterSpacing: "0.06em" }}>LOCKED 🔒</div>
                    <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginTop: 6 }}>Both confirmed. Settle when you know who won.</div>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
                    <button
                      className="bet-btn"
                      style={{ borderColor: bet.p1_bet ? "#00C87A" : "rgba(255,255,255,0.12)", color: bet.p1_bet ? "#00C87A" : "rgba(255,255,255,0.4)", background: bet.p1_bet ? "rgba(0,200,122,0.08)" : "none", animation: bet.p1_bet ? "betPop 0.35s ease" : "none" }}
                      onClick={() => pressBet(bet.id, "p1")}
                      disabled={bet.p1_bet}
                    >
                      <span style={{ fontSize: bet.p1_bet ? 36 : 28 }}>{bet.p1_bet ? "✓" : "🤝"}</span>
                      BET
                      <span style={{ fontSize: 11, fontFamily: "'Sora', sans-serif", fontWeight: 600, letterSpacing: "0.02em", opacity: 0.6 }}>You</span>
                    </button>
                    <button
                      className="bet-btn"
                      style={{ borderColor: bet.p2_bet ? "#00C87A" : "rgba(255,255,255,0.12)", color: bet.p2_bet ? "#00C87A" : "rgba(255,255,255,0.4)", background: bet.p2_bet ? "rgba(0,200,122,0.08)" : "none", animation: bet.p2_bet ? "betPop 0.35s ease" : "none" }}
                      onClick={() => pressBet(bet.id, "p2")}
                      disabled={bet.p2_bet}
                    >
                      <span style={{ fontSize: bet.p2_bet ? 36 : 28 }}>{bet.p2_bet ? "✓" : "🤝"}</span>
                      BET
                      <span style={{ fontSize: 11, fontFamily: "'Sora', sans-serif", fontWeight: 600, letterSpacing: "0.02em", opacity: 0.6 }}>Them</span>
                    </button>
                  </div>
                )}

                {/* Settle */}
                {isLocked && (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", color: "rgba(255,255,255,0.3)", marginBottom: 12, textAlign: "center" }}>WHO WON?</div>
                    <div style={{ display: "flex", gap: 10 }}>
                      <button className="big-btn" onClick={() => settle(bet.id, "p1_won")} style={{ flex: 1, fontSize: 18 }}>
                        I Won 🏆
                      </button>
                      <button onClick={() => settle(bet.id, "p2_won")}
                        style={{ flex: 1, background: "rgba(239,68,68,0.12)", color: "#EF4444", border: "2px solid rgba(239,68,68,0.25)", fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, letterSpacing: "0.04em", borderRadius: 18, padding: "18px", cursor: "pointer" }}>
                        They Won
                      </button>
                    </div>
                    <button onClick={() => settle(bet.id, "disputed")}
                      style={{ marginTop: 10, background: "none", border: "none", color: "rgba(255,255,255,0.25)", fontSize: 12, fontWeight: 600, cursor: "pointer", width: "100%", fontFamily: "'Sora', sans-serif", padding: "8px" }}>
                      Dispute it ⚠️
                    </button>
                  </>
                )}
              </>
            )}

            {/* Done state */}
            {isDone && (
              <div style={{ animation: "popIn 0.4s ease" }}>
                {bet.status === "p1_won" && (
                  <div style={{ background: "rgba(0,200,122,0.08)", border: "2px solid rgba(0,200,122,0.3)", borderRadius: 20, padding: "32px", textAlign: "center" }}>
                    <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 52, color: "#00C87A", letterSpacing: "0.06em" }}>YOU WON</div>
                    <div style={{ fontSize: 20, fontWeight: 800, marginTop: 8 }}>{wagerVal} 💰</div>
                    {betCoinAmount && (
                      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 8 }}>Wallet balance updated with your winnings.</div>
                    )}
                  </div>
                )}
                {bet.status === "p2_won" && (
                  <div style={{ background: "rgba(239,68,68,0.08)", border: "2px solid rgba(239,68,68,0.25)", borderRadius: 20, padding: "32px", textAlign: "center" }}>
                    <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 52, color: "#EF4444", letterSpacing: "0.06em" }}>THEY WON</div>
                    <div style={{ fontSize: 18, fontWeight: 700, marginTop: 8, color: "rgba(255,255,255,0.5)" }}>{betCoinAmount ? `Wallet debited: ${wagerVal}` : `Pay up: ${wagerVal}`}</div>
                  </div>
                )}
                {bet.status === "disputed" && (
                  <div style={{ background: "rgba(167,139,250,0.08)", border: "2px solid rgba(167,139,250,0.25)", borderRadius: 20, padding: "32px", textAlign: "center" }}>
                    <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 52, color: "#A78BFA", letterSpacing: "0.04em" }}>DISPUTED</div>
                    <div style={{ fontSize: 14, color: "rgba(255,255,255,0.35)", marginTop: 8 }}>Figure it out between you two 💀</div>
                  </div>
                )}
                <button className="ghost-btn" onClick={() => setScreen(detailOrigin)} style={{ marginTop: 16 }}>← Back</button>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── HISTORY ── */}
      {screen === "history" && (
        <div className="screen" style={{ padding: "56px 24px 124px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.14em", color: "rgba(255,255,255,0.34)", marginBottom: 8 }}>WAGER</div>
              <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1 }}>History</div>
            </div>
            <BalanceBadge balance={availableBalance} />
          </div>

          <div style={{ background: "#1A1A1A", borderRadius: 22, padding: "16px 18px", marginBottom: 16 }}>
            <input
              value={historyQuery}
              onChange={e => setHistoryQuery(e.target.value)}
              placeholder="Search bets"
              style={{ width: "100%", background: "transparent", border: "none", outline: "none", color: "#FAFAFA", fontSize: 16, fontWeight: 600, fontFamily: "'Sora', sans-serif" }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {filteredHistory.map((b) => (
              <button
                key={b.id}
                className="card"
                onClick={() => openBet(b, "history")}
                style={{ background: "#121212", borderRadius: 26, border: "none", padding: 18, textAlign: "left" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ width: 48, height: 48, borderRadius: 18, background: b.status === "p1_won" ? "#19D12E" : "#1F1F1F", color: b.status === "p1_won" ? "#050505" : "#FAFAFA", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 800, flexShrink: 0 }}>
                    {b.status === "p1_won" ? "+" : b.status === "p2_won" ? "-" : "B"}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.3, marginBottom: 4 }}>{b.what}</div>
                    <div style={{ fontSize: 13, color: "rgba(255,255,255,0.42)" }}>{b.date}</div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: b.status === "p1_won" ? "#19D12E" : "#FAFAFA" }}>{getWagerLabel(b)}</div>
                    <div style={{ fontSize: 11, fontWeight: 800, color: statusColor(b.status), marginTop: 4 }}>{statusLabel(b.status)}</div>
                  </div>
                </div>
              </button>
            ))}
            {filteredHistory.length === 0 && (
              <div style={{ background: "#121212", borderRadius: 26, padding: 28, textAlign: "center", color: "rgba(255,255,255,0.34)" }}>
                No bets match that search yet.
              </div>
            )}
          </div>
        </div>
      )}

      {showTabBar && (
        <div style={{ position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: 20, width: "calc(100% - 36px)", maxWidth: 360, zIndex: 25 }}>
          <div style={{ display: "flex", gap: 8, background: "rgba(18,18,18,0.94)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 999, padding: 8, backdropFilter: "blur(18px)", boxShadow: "0 14px 40px rgba(0,0,0,0.32)" }}>
	            {[
	              { id: "feed", label: "Feed", icon: "≋" },
	              { id: "bet", label: "New", icon: "+" },
	              { id: "history", label: "Bets", icon: "B" },
	              { id: "home", label: "Wallet", icon: "$" },
	            ].map((item) => {
              const active = screen === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => switchTab(item.id)}
                  style={{
                    flex: 1,
                    border: "none",
                    borderRadius: 999,
                    padding: "14px 10px",
                    cursor: "pointer",
	                    background: active ? (item.id === "bet" ? "#19D12E" : "#2A2A2A") : "transparent",
	                    color: active ? (item.id === "bet" ? "#050505" : "#FAFAFA") : "rgba(255,255,255,0.4)",
                    fontFamily: "'Sora', sans-serif",
                    fontWeight: 800,
                    fontSize: 13,
                    transition: "all 0.18s ease",
                  }}
                >
                  <div style={{ fontSize: 18, lineHeight: 1, marginBottom: 6 }}>{item.icon}</div>
                  <div>{item.label}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
