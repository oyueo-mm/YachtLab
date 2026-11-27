import { Scale } from "lucide-react";
import data from "./third-party-licenses.json";
import { LegalNav } from "./LegalNav";

type Entry = { name: string; version?: string; license: string; homepage: string | null; text: string; use?: string; changes?: string; commit?: string };

function Item({ entry }: { entry: Entry }) {
  return (
    <details className="license-item">
      <summary>
        <strong>{entry.name}</strong>
        {entry.version && <span>{entry.version}</span>}
        <span className="license-kind">{entry.license}</span>
      </summary>
      {entry.homepage && /^https:\/\//.test(entry.homepage) && (
        <p>
          <a href={entry.homepage} target="_blank" rel="noopener noreferrer">{entry.homepage}</a>
          {entry.commit && <> · 기준 커밋 <code>{entry.commit.slice(0, 12)}</code></>}
        </p>
      )}
      {entry.use && <p>사용: {entry.use}</p>}
      {entry.changes && <p>변경 사항: {entry.changes}</p>}
      <pre>{entry.text}</pre>
    </details>
  );
}

/** Open-source notice (MIT/ISC/0BSD/Apache-2.0 require the copyright and license text with copies). */
export default function LicensesPage() {
  const { packages, ported } = data as { packages: Entry[]; ported: Entry[] };
  return (
    <article className="legal-page" aria-labelledby="licenses-title">
      <div className="page-heading">
        <div>
          <h1 id="licenses-title">오픈소스 라이선스</h1>
          <p>이 사이트에 포함된 오픈소스 소프트웨어와 이식한 코드의 저작권·라이선스 고지</p>
        </div>
        <Scale size={25} aria-hidden="true" />
      </div>
      <div className="legal-body">
        <h2>포함된 라이브러리</h2>
        {packages.map((entry) => <Item key={entry.name} entry={entry} />)}
        <h2>이식한 코드</h2>
        <p>아래 프로젝트의 AI 판단 로직을 YachtLab 규칙에 맞게 고쳐 연구용 AI 상대로 씁니다. 원 저작자의 공식 버전이 아니에요.</p>
        {ported.map((entry) => <Item key={entry.name} entry={entry} />)}
        <h2>그 밖의 자료</h2>
        <p>배경 음악·효과음은 이 프로젝트에서 직접 만든 합성음이고, 글꼴은 기기에 설치된 시스템 글꼴을 써요. 이모지는 기기의 이모지 글꼴로 표시돼요.</p>
      </div>
      <LegalNav current="licenses" />
    </article>
  );
}
