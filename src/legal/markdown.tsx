import type { ReactNode } from "react";

/**
 * A deliberately tiny Markdown subset for the policy texts (no HTML is ever interpreted):
 *   # / ## / ### headings, paragraphs, "- " lists, "1. " lists, | tables |, **bold**, [text](href).
 * Links may only point to an in-app route ("#privacy"), a site path ("/YachtLab/…"), "mailto:" or https.
 * Placeholders:
 *   {{operator.field}}     → the operator's confirmed value, or an "unconfirmed" chip when null
 *   [[확인 필요: 설명]]     → an "operator must confirm" chip (blocks release, see tests/legal.test.ts)
 */
export type Values = Record<string, string | null>;

export const PENDING = /\[\[확인 필요:\s*([^\]]+)\]\]/g;
export const FIELD = /\{\{operator\.([a-zA-Z]+)\}\}/g;

const SAFE_HREF = /^(#[a-z-]+|\/YachtLab\/[\w\-./#]*|mailto:[^\s"'<>]+|https:\/\/[^\s"'<>]+)$/;

/** Unresolved items of one text: missing operator fields and "확인 필요" markers. */
export function unresolved(text: string, values: Values): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(FIELD)) if (!values[m[1]]) out.push(`operator.${m[1]}`);
  for (const m of text.matchAll(PENDING)) out.push(m[1].trim());
  return out;
}

function inline(text: string, values: Values, key: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|\{\{operator\.([a-zA-Z]+)\}\}|\[\[확인 필요:\s*([^\]]+)\]\]/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index! > last) nodes.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (m[1] !== undefined) nodes.push(<strong key={k}>{inline(m[1], values, k)}</strong>);
    else if (m[2] !== undefined) {
      const href = m[3];
      if (SAFE_HREF.test(href)) {
        const external = href.startsWith("https://");
        nodes.push(<a key={k} href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{m[2]}</a>);
      } else nodes.push(m[2]);
    } else if (m[4] !== undefined) {
      const value = values[m[4]];
      nodes.push(value ? <span key={k}>{value}</span> : <mark key={k} className="legal-pending" data-pending={`operator.${m[4]}`}>미확정</mark>);
    } else nodes.push(<mark key={k} className="legal-pending" data-pending={m[5].trim()} title={m[5].trim()}>확인 필요: {m[5].trim()}</mark>);
    last = m.index! + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

/** Render the Markdown subset to React elements (text only — never `dangerouslySetInnerHTML`). */
export function renderMarkdown(source: string, values: Values): ReactNode[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let n = 0;
  const key = () => `b${n++}`;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const k = key();
      const content = inline(heading[2], values, k);
      out.push(level === 1 ? <h1 key={k}>{content}</h1> : level === 2 ? <h2 key={k}>{content}</h2> : <h3 key={k}>{content}</h3>);
      i++;
      continue;
    }
    if (/^\s*\|/.test(line)) {
      const rows: string[] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      const [head, , ...body] = rows;
      const k = key();
      out.push(
        <div key={k} className="legal-table-wrap">
          <table>
            <thead>
              <tr>{cells(head).map((c, j) => <th key={j} scope="col">{inline(c, values, `${k}h${j}`)}</th>)}</tr>
            </thead>
            <tbody>
              {body.map((row, r) => <tr key={r}>{cells(row).map((c, j) => <td key={j}>{inline(c, values, `${k}r${r}c${j}`)}</td>)}</tr>)}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const bullet = /^\s*[-*]\s+/;
    const ordered = /^\s*\d+\.\s+/;
    if (bullet.test(line) || ordered.test(line)) {
      const isOrdered = ordered.test(line);
      const pattern = isOrdered ? ordered : bullet;
      const items: string[] = [];
      while (i < lines.length && pattern.test(lines[i])) items.push(lines[i++].replace(pattern, ""));
      const k = key();
      const children = items.map((item, j) => <li key={j}>{inline(item, values, `${k}-${j}`)}</li>);
      out.push(isOrdered ? <ol key={k}>{children}</ol> : <ul key={k}>{children}</ul>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|\s*\||\s*[-*]\s|\s*\d+\.\s)/.test(lines[i])) para.push(lines[i++].trim());
    const k = key();
    out.push(<p key={k}>{inline(para.join(" "), values, k)}</p>);
  }
  return out;
}
