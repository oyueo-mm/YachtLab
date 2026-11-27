import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderMarkdown, unresolved } from "../src/legal/markdown";
import { LEGAL_RELEASED, OPERATOR, POLICY_ROUTES } from "../src/legal/release";
// @ts-expect-error plain ESM script without type declarations
import { build } from "../scripts/legal/third-party-licenses.mjs";

const text = (route: string) => readFileSync(new URL(`../src/legal/content/${route}.md`, import.meta.url), "utf8");
const html = (md: string, values: Record<string, string | null> = {}) => renderToStaticMarkup(createElement(Fragment, null, ...renderMarkdown(md, values)));

describe("정책 문서 렌더러", () => {
  it("제목·목록·표·굵게·링크를 그리고 HTML은 글자로만 둔다", () => {
    const out = html("## 제목\n\n- 하나\n- **둘**\n\n| a | b |\n|---|---|\n| 1 | [문의](#contact) |\n\n<script>alert(1)</script> <img src=x onerror=alert(1)>");
    expect(out).toContain("<h2>제목</h2>");
    expect(out).toContain("<li><strong>둘</strong></li>");
    expect(out).toContain('<a href="#contact">문의</a>');
    expect(out).toContain("<th scope=\"col\">a</th>");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;script&gt;");
  });
  it("허용하지 않은 링크 주소는 링크로 만들지 않는다", () => {
    const out = html("[x](javascript:alert(1)) [y](http://example.com) [z](https://example.com)");
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain('href="http://');
    expect(out).toContain('href="https://example.com" target="_blank" rel="noopener noreferrer"');
  });
  it("운영자 값이 없으면 미확정, 확인 필요 표시는 강조해서 보인다", () => {
    expect(html("메일 {{operator.contactEmail}}")).toContain("미확정");
    expect(html("메일 {{operator.contactEmail}}", { contactEmail: "a@b.c" })).toContain("a@b.c");
    expect(html("[[확인 필요: 보존 기간]]")).toContain('data-pending="보존 기간"');
    expect(unresolved("{{operator.contactEmail}} [[확인 필요: 기간]]", { contactEmail: null })).toEqual(["operator.contactEmail", "기간"]);
  });
});

describe("공개 게이트", () => {
  it("미확정 항목이 남은 문서는 공개(LEGAL_RELEASED)할 수 없다", () => {
    const missing = POLICY_ROUTES.flatMap((route) => unresolved(text(route), OPERATOR).map((item) => `${route}: ${item}`));
    if (LEGAL_RELEASED) expect(missing).toEqual([]);
    else expect(missing.length).toBeGreaterThan(0);
  });
  it("운영자 정보는 임의로 채우지 않는다(공개 전에는 모두 비어 있음)", () => {
    if (!LEGAL_RELEASED) expect(Object.values(OPERATOR).every((v) => v === null)).toBe(true);
  });
});

describe("개인정보 처리방침 초안의 필수 항목", () => {
  const privacy = text("privacy");
  it("개인정보 보호법 제30조 제1항의 항목을 다룬다", () => {
    for (const heading of ["처리 목적", "처리하는 개인정보 항목", "보유 기간", "파기", "처리 위탁과 국외 이전", "권리", "개인정보 보호책임자", "브라우저에 저장하는 정보와 쿠키", "안전성 확보 조치"])
      expect(privacy).toContain(heading);
  });
  it("제28조의8 제2항의 국외 이전 고지 항목을 표로 둔다", () => {
    for (const column of ["이전받는 자(연락처)", "이전 항목", "국가", "시기·방법", "목적·보유 기간", "국외 이전을 원하지 않으면"]) expect(privacy).toContain(column);
  });
  it("받지 않는 정보와 공개되는 경기 범위를 사실대로 적는다", () => {
    expect(privacy).toContain("이메일·이름·사진·전화번호는 받지 않아요");
    expect(privacy).toContain("빠른 대전은 항상 관전방에 공개되는 경기");
  });
});

describe("오픈소스 고지", () => {
  it("커밋된 목록이 잠금 파일·이식 소스와 일치한다", () => {
    expect(readFileSync(new URL("../src/legal/third-party-licenses.json", import.meta.url), "utf8")).toBe(build());
  });
  it("모든 항목에 라이선스 전문이 있다", () => {
    const data = JSON.parse(build()) as { packages: { name: string; text: string }[]; ported: { name: string; text: string }[] };
    expect(data.packages.map((p) => p.name)).toEqual(expect.arrayContaining(["react", "react-dom", "three", "cannon-es", "lucide-react", "@dnd-kit/core"]));
    for (const entry of [...data.packages, ...data.ported]) expect(entry.text.length, entry.name).toBeGreaterThan(300);
  });
});
