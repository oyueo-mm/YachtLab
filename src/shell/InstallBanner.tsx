import { useEffect, useState } from "react";
import { Download, Share2, X } from "lucide-react";
import "./install-banner.css";

type InstallPrompt = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
const DISMISS_KEY = "yachtlab.install-dismissed.v1";

function wasDismissed() {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export default function InstallBanner({ active }: { active: boolean }) {
  const [offer, setOffer] = useState<InstallPrompt | null>(null);
  const [dismissed, setDismissed] = useState(wasDismissed);
  const mode = window.matchMedia("(display-mode: standalone)");
  const standalone = () => mode.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const [installed, setInstalled] = useState(standalone);
  const [instructions, setInstructions] = useState(false);
  const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  useEffect(() => {
    const prompt = (event: Event) => {
      if (!window.matchMedia("(max-width: 760px)").matches) return;
      event.preventDefault();
      setOffer(event as InstallPrompt);
    };
    const didInstall = () => {
      setOffer(null);
      setInstalled(true);
    };
    const modeChanged = () => setInstalled(standalone());
    window.addEventListener("beforeinstallprompt", prompt);
    window.addEventListener("appinstalled", didInstall);
    mode.addEventListener("change", modeChanged);
    return () => {
      window.removeEventListener("beforeinstallprompt", prompt);
      window.removeEventListener("appinstalled", didInstall);
      mode.removeEventListener("change", modeChanged);
    };
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // The banner remains dismissed for the current tab.
    }
  };

  const install = async () => {
    if (!offer) return;
    setOffer(null);
    try {
      await offer.prompt();
      if ((await offer.userChoice).outcome === "accepted") setInstalled(true);
      else dismiss();
    } catch {
      // A browser may invalidate its one-use prompt, for example after changing tabs.
    }
  };

  if (!active || dismissed || installed || (!offer && !iOS)) return null;
  return (
    <aside className="install-banner" aria-label="앱 설치">
      <div>
        <strong>홈 화면에서 YachtLab 열기</strong>
        {instructions && <p>Safari에서 공유 버튼을 누르고 ‘홈 화면에 추가’를 선택하세요.</p>}
      </div>
      {offer ? (
        <button type="button" className="secondary" onClick={() => void install()}><Download size={16} aria-hidden="true" /> 설치</button>
      ) : (
        <button type="button" className="secondary" aria-expanded={instructions} onClick={() => setInstructions(!instructions)}><Share2 size={16} aria-hidden="true" /> 추가 방법</button>
      )}
      <button type="button" className="icon-button" aria-label="설치 안내 닫기" onClick={dismiss}><X size={18} aria-hidden="true" /></button>
    </aside>
  );
}
