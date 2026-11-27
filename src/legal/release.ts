/**
 * Policy pages (C4.3): release gate and the operator's information.
 *
 * The privacy policy, terms, operating policy and contact page are DRAFTS until the operator fills
 * every field below and approves the texts (docs/legal/OPERATOR-CHECKLIST.md). Until then:
 *  - a production build (GitHub Pages) does not contain the draft texts at all — the lazy chunk is
 *    removed by dead-code elimination because `LEGAL_VISIBLE` is a build-time constant `false`;
 *  - their routes fall back to home and no link to them is shown;
 *  - the dev server and a test build with `LEGAL_PREVIEW=1` show them with a draft banner.
 * The open-source license notice has no operator-dependent content and is always available.
 *
 * Never fill these fields with guessed values. `null` means "operator has not confirmed it yet".
 */
export type OperatorInfo = {
  /** Public contact e-mail for questions, reports and privacy requests. */
  contactEmail: string | null;
  /** 개인정보 보호책임자: name or role title, and how to reach them (PIPA §30①6, §31). */
  privacyOfficer: string | null;
  /** Operator name shown as the service provider (an individual's name or a business name). */
  operatorName: string | null;
  /** First effective date of the policy texts, e.g. "2026년 12월 1일". */
  effectiveDate: string | null;
};

export const OPERATOR: OperatorInfo = {
  contactEmail: null,
  privacyOfficer: null,
  operatorName: null,
  effectiveDate: null,
};

/**
 * Set to `true` only after every OPERATOR field is filled, every "[[확인 필요: …]]" marker in
 * src/legal/content/*.md is resolved, and the operator approved the texts. `tests/legal.test.ts`
 * refuses a release that still has a missing field or marker.
 */
export const LEGAL_RELEASED = false;

declare const __LEGAL_PREVIEW__: boolean;
/** Test builds (`LEGAL_PREVIEW=1 npm run build`) and the dev server show the drafts for review. */
export const LEGAL_PREVIEW: boolean = (typeof __LEGAL_PREVIEW__ === "boolean" && __LEGAL_PREVIEW__) || import.meta.env.DEV;

/** Policy pages (other than the license notice) can be opened and linked. */
export const LEGAL_VISIBLE: boolean = LEGAL_RELEASED || LEGAL_PREVIEW;

/** Routes of the gated policy pages (the license notice is separate and always on). */
export const POLICY_ROUTES = ["privacy", "terms", "policy", "contact"] as const;
export type PolicyRoute = (typeof POLICY_ROUTES)[number];

export const POLICY_TITLES: Record<PolicyRoute | "licenses", string> = {
  privacy: "개인정보 처리방침",
  terms: "이용약관",
  policy: "운영 정책",
  contact: "문의·개인정보 권리 행사",
  licenses: "오픈소스 라이선스",
};
