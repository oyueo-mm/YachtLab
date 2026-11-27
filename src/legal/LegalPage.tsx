import { FileText } from "lucide-react";
import privacy from "./content/privacy.md?raw";
import terms from "./content/terms.md?raw";
import policy from "./content/policy.md?raw";
import contact from "./content/contact.md?raw";
import { renderMarkdown, unresolved } from "./markdown";
import { LEGAL_RELEASED, OPERATOR, type PolicyRoute } from "./release";
import { LegalNav } from "./LegalNav";

/** Draft texts are bundled only into this lazy chunk, which production builds drop until release. */
export const POLICY_TEXTS: Record<PolicyRoute, string> = { privacy, terms, policy, contact };

export default function LegalPage({ route }: { route: PolicyRoute }) {
  const text = POLICY_TEXTS[route];
  const pending = unresolved(text, OPERATOR);
  const [title, ...rest] = text.split("\n");
  return (
    <article className="legal-page" aria-labelledby="legal-title">
      <div className="page-heading">
        <div>
          <h1 id="legal-title">{title.replace(/^#\s+/, "")}</h1>
        </div>
        <FileText size={25} aria-hidden="true" />
      </div>
      {!LEGAL_RELEASED && (
        <p className="legal-draft" role="note">
          검토용 초안이에요. 운영자 확인이 끝나기 전에는 공개 사이트에 게시하지 않아요.{pending.length > 0 && ` 확인이 필요한 항목 ${pending.length}개.`}
        </p>
      )}
      <div className="legal-body">{renderMarkdown(rest.join("\n"), OPERATOR)}</div>
      <LegalNav current={route} />
    </article>
  );
}
