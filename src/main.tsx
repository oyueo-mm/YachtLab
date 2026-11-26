import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./shell.css";
import "./game-flow.css";
import "./play-table.css";
import "./matte.css";
import "./mobile-play.css";
import "./online.css";
import "./responsive.css";
import "./mobile-play-v2.css";
import "./profile.css";
import "./items.css";
import "./items-content.css";
import "./onboarding.css";
import "./table-v4.css";
import { captureAttribution } from "./analytics/attribution";

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: "none" }).catch(() => undefined);
}

// Campaign links: remember first/latest utm_* on this device and tidy the address bar (D-065).
captureAttribution();
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
