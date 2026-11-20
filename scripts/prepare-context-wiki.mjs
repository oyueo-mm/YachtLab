import {readFile,writeFile,mkdir} from "node:fs/promises";
import path from "node:path";

const destination=process.argv[2];
if(!destination)throw Error("Usage: node scripts/prepare-context-wiki.mjs <local-wiki-clone>");
const repo=process.env.GITHUB_REPOSITORY??"oyueo-mm/YachtLab";
const names=new Map([
  ["docs/context/README.md","Home.md"],
  ["docs/context/_generated/CURRENT_STATE.md","자동-현재-상태.md"],
  ["docs/context/RESULTS.md","실험-결과.md"],
  ["docs/context/TECHNIQUES.md","알고리즘-기법-도감.md"],
  ["docs/context/ROADMAP.md","연구-로드맵.md"],
  ["docs/context/DECISIONS.md","설계-결정.md"],
  ["docs/context/HANDOFF.md","다음-채팅-인수인계.md"],
  ["docs/context/REFERENCES.md","참고문헌.md"],
  ["docs/context/AUTOMATION.md","자동-갱신.md"],
]);
const root=process.cwd();
function translated(p,markdown){
  return markdown.replace(/\]\(([^)]+)\)/g,(_whole,href)=>{
    if(/^(?:https?:|#|mailto:)/.test(href))return "]("+href+")";
    const [location,anchor]=href.split("#");
    const next=path.posix.normalize(path.posix.join(path.posix.dirname(p),location));
    const wikiName=names.get(next);
    if(wikiName)return "]("+wikiName.replace(/\.md$/,"")+(anchor?"#"+anchor:"")+")";
    return "](https://github.com/"+repo+"/blob/main/"+next+(anchor?"#"+anchor:"")+")";
  });
}
for(const [src,name] of names){
  const content=await readFile(path.join(root,src),"utf8");
  const original="\n\n---\n\n[원본 GitHub 파일](https://github.com/"+repo+"/blob/main/"+src+") · Wiki는 원본의 자동 복사본입니다.\n";
  await mkdir(destination,{recursive:true});
  await writeFile(path.join(destination,name),translated(src,content)+original,"utf8");
}
const nav=["# YachtLab 맥락 허브","",...names.entries().map(([from,to])=>"- ["+(from==="docs/context/README.md"?"홈":to.replace(/\.md$/,"").replace(/-/g," "))+"]("+to.replace(/\.md$/,"")+")")];
await writeFile(path.join(destination,"_Sidebar.md"),nav.join("\n")+"\n","utf8");
await writeFile(path.join(destination,"_Footer.md"),"원본: https://github.com/"+repo+"/tree/main/docs/context · GitHub Actions가 원본 문서 변경사항을 동기화합니다.\n","utf8");
console.log("CONTEXT_WIKI_PREPARED "+names.size+" pages");
