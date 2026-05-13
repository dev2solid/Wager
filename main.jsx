import React from "react";
import ReactDOM from "react-dom/client";
import Wager from "./wager.jsx";

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Wager app crashed:", error, info);
  }

  clearSavedData = () => {
    localStorage.removeItem("wgr_bets");
    localStorage.removeItem("wgr_balance");
    localStorage.removeItem("wgr_next_reup_at");
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#09090B",
            color: "#FAFAFA",
            padding: 24,
            fontFamily: "'Sora', -apple-system, sans-serif",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 420,
              background: "#111115",
              border: "1.5px solid rgba(255,255,255,0.08)",
              borderRadius: 20,
              padding: 24,
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.12em",
                color: "#FBBF24",
                marginBottom: 12,
              }}
            >
              APP ERROR
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 10 }}>
              The app hit a startup error.
            </div>
            <div style={{ fontSize: 14, color: "rgba(255,255,255,0.6)", lineHeight: 1.5, marginBottom: 16 }}>
              You should now see the error message instead of a blank screen. If this came from old saved data, clear it and reload.
            </div>
            <div
              style={{
                fontSize: 12,
                color: "rgba(255,255,255,0.45)",
                background: "rgba(255,255,255,0.04)",
                borderRadius: 14,
                padding: 14,
                marginBottom: 16,
                wordBreak: "break-word",
              }}
            >
              {String(this.state.error?.message || this.state.error)}
            </div>
            <button
              onClick={this.clearSavedData}
              style={{
                width: "100%",
                background: "#00C87A",
                color: "#09090B",
                border: "none",
                borderRadius: 16,
                padding: 16,
                fontSize: 16,
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              Clear Data And Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <AppErrorBoundary>
    <Wager />
  </AppErrorBoundary>
);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("Wager service worker registration failed:", error);
    });
  });
}
