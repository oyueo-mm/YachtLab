import "./legal.css";
import { LEGAL_VISIBLE, POLICY_ROUTES, POLICY_TITLES, type PolicyRoute } from "./release";

type Doc = PolicyRoute | "licenses";

/** Links to the policy pages that can be shown in this build (the license notice always). */
export function legalLinks(): Doc[] {
  return [...(LEGAL_VISIBLE ? POLICY_ROUTES : []), "licenses"];
}

/** A compact row of links, used at the bottom of the policy pages, the home screen and settings. */
export function LegalNav({ current, className = "legal-nav", onNavigate }: { current?: Doc; className?: string; onNavigate?: () => void }) {
  return (
    <nav className={className} aria-label="정책과 안내">
      {legalLinks().map((doc) => (
        <a key={doc} href={`#${doc}`} aria-current={doc === current ? "page" : undefined} onClick={onNavigate}>
          {POLICY_TITLES[doc]}
        </a>
      ))}
    </nav>
  );
}
