/**
 * Builds docs/economy/FOLLOWUP-GENERATED.md from docs/economy/results/followup.json (+ room-writes.json).
 * Usage: npx tsx scripts/economy/report-followup.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
const F = JSON.parse(readFileSync("docs/economy/results/followup.json", "utf8"));
const pct = (x: number | null | undefined, d = 0) => (x === null || x === undefined || !Number.isFinite(x) ? "—" : `${(x * 100).toFixed(d)}%`);
const num = (x: number | null | undefined, d = 0) => (x === null || x === undefined || !Number.isFinite(x) ? "—" : x.toLocaleString("en-US", { maximumFractionDigits: d }));
const day = (x: number, H: number) => (x > H ? `${H}일 내 미달` : `${num(x)}일`);
const table = (head: string[], rows: (string | number)[][]) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
const P: Record<string, string> = { occasional: "비정기", light: "라이트", regular: "일반", heavy: "헤비", extreme: "극단 헤비", saver: "저축형" };
const RAR = ["일반", "고급", "영웅", "전설", "신화"];
const H5 = F.generated.quick ? 730 : 1825;
const o: string[] = [];
const I = F.integer;
o.push(`# 경제 추가 검증 결과 (자동 생성)\n\n> \`scripts/economy/run-followup.ts\` → \`scripts/economy/report-followup.ts\`. 손으로 고치지 말 것. 해석: [ECONOMY-RESEARCH §16~](./ECONOMY-RESEARCH.md#16-추가-검증-2026-11-24-2차).\n\n- 시드 ${F.generated.seed} (다중 시드 ${F.generated.seeds.join(", ")}), 코호트당 ${F.generated.users}명, 실행 ${F.generated.runtimeSeconds}초${F.generated.quick ? " (**빠른 모드**)" : ""}. 사용자 행동은 모두 가정.\n- 기준 모델 **${I.model.id}** (정수 운영안): ${I.model.summary}\n- 정수안의 기준 사용자(일반 유저·로그인·무과금) 1년 중앙 소득: **${num(I.refCoinsPerDay, 1)}코인/일, ${num(I.refGemsPerDay, 2)}보석/일**, 보석 1 ≈ ${num(I.gemValue, 1)}코인(시간 동등).`);
o.push(`\n## 0. 정수안 가격표(같은 목표 일수로 역산)\n`);
o.push(table(["등급", "코인", "보석"], RAR.map((r, k) => [r, num(I.prices.coin[k]), num(I.prices.gem[k])])));
o.push(`\n슬롯(이모티콘 5~8번째, 채팅 7~10번째 각각): ${I.slots.costs.map((c: number, i: number) => `${num(c)}코인/${num(I.slots.gemCosts[i])}보석`).join(" · ")}`);

o.push(`\n## 1. 정수안 재검증(무과금, 일반 구매형)\n`);
o.push(table(["유형", "코인/일 1년(중앙·p10·p90·최소)", "보석/일", "신화 1년", "신화 3년", `신화 ${H5 / 365}년`, `신화 최대 강화 ${H5 / 365}년`], F.F1.rows.map((r: any) => [P[r.persona], `${num(r.coinsPerDay1y.median)} · ${num(r.coinsPerDay1y.p10)} · ${num(r.coinsPerDay1y.p90)} · ${num(r.coinsPerDay1y.min)}`, num(r.gemsPerDay1y.median, 2), pct(r.mythic1y), pct(r.mythic3y), pct(r.mythic5y), pct(r.mythicMax5y)])));
o.push(`\n서버 AI 봇(하루 23시간) 30일 코인 ÷ 헤비 유저: **${num(F.F1.botRatio30d, 2)}배**.`);

o.push(`\n## 2. 접속일당 경기 수별 공급량(일반 유저 접속 빈도 0.65, 1년)\n`);
o.push(table(["접속일당 경기", "코인/접속일", "코인/경기", "코인/시간(7분)", "보석/접속일", "일일 퀘스트 3개 완료 비율", "코인/일(달력)", "신화 1년", "신화 중앙 일수"], F.F2.map((r: any) => [r.matchesPerActiveDay, num(r.coinsPerActiveDay), num(r.coinsPerMatch, 1), num(r.coinsPerHour7min), num(r.gemsPerActiveDay, 2), pct(r.dailyQuestAllShare), num(r.coinsPerDay), pct(r.mythic1y), day(r.mythicDay, 365)])));

o.push(`\n## 3. 경기 시간 민감도(하루 플레이 시간 고정 → 경기 수 = 기준×7/분)\n`);
o.push(table(["경기 시간", "유형", "접속일당 경기", "코인/일", "코인/플레이 시간", "보석/일", "신화 1년"], F.F3.map((r: any) => [`${r.minutes}분`, P[r.persona], num(r.matchesPerActiveDay, 1), num(r.coinsPerDay), num(r.coinsPerHour), num(r.gemsPerDay, 2), pct(r.mythic1y)])));

o.push(`\n## 4. 연차별 반복 획득 vs 일회성(업적·신규·게스트 소급), 무과금\n`);
o.push(table(["유형", "연차", "반복 코인", "일회성 코인", "반복 보석", "일회성 보석", "보석 내역(일일/주간/이벤트/업적)"], Object.entries(F.F4).flatMap(([pid, ys]: any) => ys.map((y: any) => [P[pid], `${y.year}년차`, num(y.recurringCoins), num(y.oneTimeCoins), num(y.recurringGems), num(y.oneTimeGems), `${num(y.bySourceGems.quest_daily)}/${num(y.bySourceGems.quest_weekly)}/${num(y.bySourceGems.event)}/${num(y.bySourceGems.achievement)}`]))));

o.push(`\n## 5. 업적을 대부분 달성한 장기 사용자의 보석 구매력(마지막 연차의 반복 수입만)\n`);
o.push(table(["유형", "연차", "비상징 업적 달성률", "반복 보석/년", "반복 코인/년", ...RAR.map((r) => `${r} 보석 상품/년`), "신화 보석 상품 1개 연수"], Object.entries(F.F5).map(([pid, v]: any) => [P[pid], `${v.lastYear}년차`, pct(v.achievementsUnlockedShare), num(v.recurringGemsPerYear), num(v.recurringCoinsPerYear), ...v.gemItemsPerYear.map((x: number) => num(x, 1)), num(v.yearsPerGemItem[4], 2)])));

o.push(`\n## 6. 신규·지속·이탈 사용자(모집단: 하루 신규 30명, ${F.generated.quick ? 1 : 3}년 종료 시점, 로그인 사용자)\n`);
o.push(table(["구분", "사용자 수", "수명 중앙(일)", "코인/생존일", "미사용 코인 중앙", "미사용 보석 중앙", "보유 아이템 중앙", "신화 보유", "이탈자 잔액 합"], Object.entries(F.F6).map(([k, v]: any) => [{ new: "신규(30일 미만)", continuing: "지속(30일 이상)", churned: "이탈" }[k as "new"], num(v.users), num(v.lifetime.median), num(v.coinsPerDay.median), num(v.unspentCoins.median), num(v.unspentGems.median), num(v.owned.median), pct(v.mythicShare, 1), v.strandedCoinsTotal === null ? "—" : num(v.strandedCoinsTotal)])));

o.push(`\n## 7. 독립 시드 반복(${F.F7.seeds.length}개 시드)\n`);
o.push(table(["지표", "평균", "표준편차", "최소", "최대"], Object.entries(F.F7.stats).map(([k, s]: any) => [k, num(s.mean, 3), num(s.sd, 3), num(s.min, 3), num(s.max, 3)])));

o.push(`\n### 7-2. 신화 결제 경로 구성 × 카탈로그 시드(${F.F7.seeds.length}개) — 일반 구매형 무과금 신화 획득\n`);
o.push(table(["신화 결제 구성", "일반 1년 평균(최소~최대)", "일반 3년", "헤비 1년"], F.F7b.map((r: any) => [r.label, `${pct(r.reg1y.mean)} (${pct(r.reg1y.min)}~${pct(r.reg1y.max)})`, `${pct(r.reg3y.mean)} (${pct(r.reg3y.min)}~${pct(r.reg3y.max)})`, `${pct(r.heavy1y.mean)} (${pct(r.heavy1y.min)}~${pct(r.heavy1y.max)})`])));
o.push(`\n## 8. 승리 보너스 비율 비교(정수안, 완료 10코인 기준)\n`);
o.push(table(["승리 보너스", "일반 코인/일(승률 0.5)", "승률 0.35 / 0.65 코인/일", "강자÷약자", "경기 코인 중 승리 비중", "신화 1년(0.5)", "서버 AI 봇÷헤비", "무작위 봇(승률 0.65)÷헤비"], F.F8.map((r: any) => [`+${r.win} (${Math.round(r.winPct * 100)}%)`, num(r.regular.coinsPerDay), `${num(r.weak035.coinsPerDay)} / ${num(r.strong065.coinsPerDay)}`, num(r.strongOverWeak, 3), pct(r.winShareOfMatchCoins), pct(r.regular.mythic1y), num(r.botAIRatio, 2), num(r.botRandomRatio065, 2)])));

o.push(`\n## 9. 이벤트가 없어도 유지되는가\n`);
o.push(table(["조건", "라이트 코인/일·신화3년", "일반 코인/일·신화1년·3년", "헤비 코인/일·신화1년·3년", "모집단 코인 발행/소비(1년, 신규 30/일)", "보석 발행/소비"], F.F9.map((r: any) => [r.label, `${num(r.light.coinsPerDay1y)} · ${pct(r.light.mythic3y)}`, `${num(r.regular.coinsPerDay1y)} · ${pct(r.regular.mythic1y)} · ${pct(r.regular.mythic3y)}`, `${num(r.heavy.coinsPerDay1y)} · ${pct(r.heavy.mythic1y)} · ${pct(r.heavy.mythic3y)}`, `${num(r.population.coinsIssued)} / ${num(r.population.coinsSpent)} (${num(r.population.coinsIssued / r.population.coinsSpent, 2)})`, `${num(r.population.gemsIssued)} / ${num(r.population.gemsSpent)}`])));

o.push(`\n## 10. 게스트 기록 소급 지급 후보(확정 아님)\n\n게스트로 L일 플레이 후 계정 연결. 소급은 경기 코인만(퀘스트·업적·보석 없음), server-verified 경기만.\n`);
o.push(table(["후보", "L=3일: 소급 코인·경기", "L=14일", "L=60일", "게스트 봇 60일 후 연결: 소급 코인·경기"], F.F10.map((r: any) => [`${r.id} ${r.label}`, `${num(r.login3.carryCoins)} · ${num(r.login3.creditedMatches)}`, `${num(r.login14.carryCoins)} · ${num(r.login14.creditedMatches)}`, `${num(r.login60.carryCoins)} · ${num(r.login60.creditedMatches)}`, `${num(r.farmer60.carryCoins)} · ${num(r.farmer60.creditedMatches)}`])));

o.push(`\n## 11. 퀘스트별 실제 필요 경기 수(독립 사건 가정, ${num(F.F11.trials)}회 모의)\n`);
o.push(table(["퀘스트", "주기·난이도", "입문 평균/중앙/p90", "중급 평균/중앙/p90", "전문가 평균/중앙/p90"], F.F11.perQuest.map((q: any) => [q.label, `${q.period}·${["쉬움", "보통", "어려움"][q.difficulty]}`, ...["beginner", "intermediate", "expert"].map((t) => `${num(q.byTier[t].mean, 1)} / ${num(q.byTier[t].median)} / ${num(q.byTier[t].p90)}`)])));
o.push(`\n일일 퀘스트 3개 세트(난이도별 1개씩 무작위) 모두 완료까지:\n`);
o.push(table(["단계", "필요 경기 중앙", "p90", "3경기로 완료", "6경기로 완료", "10경기로 완료", "15경기로 완료"], Object.entries(F.F11.dailySet).map(([t, v]: any) => [t, num(v.matches.median), num(v.matches.p90), pct(v.pAllDoneBy[3]), pct(v.pAllDoneBy[6]), pct(v.pAllDoneBy[10]), pct(v.pAllDoneBy[15])])));

o.push(`\n## 12. 강화 비율(가격 : Lv1→2 : Lv2→3)과 획득 기간 — 목표 저축형 vs 일반 구매형\n\n목표 저축형 = 신화 1개만 노리고 다른 것은 사지 않은 뒤 그 아이템만 강화. 일반 구매형 = 여러 상품 구매(기존 일반·헤비 유형).\n`);
o.push(table(["비율", "신화 총비용(코인)", "목표형 라이트: 신화·최대", "목표형 일반: 신화·최대", "목표형 헤비: 신화·최대", "목표형 극단: 최대", "일반 구매형 일반: 최대 강화 3년/5년", "일반 구매형 헤비: 최대 강화 3년/5년"], F.F12.ratios.map((r: any) => [r.ratio, num(r.totalMythicCoins), `${day(r.focus_light.mythicDay, H5)} · ${day(r.focus_light.maxDay, H5)}`, `${day(r.focus_regular.mythicDay, H5)} · ${day(r.focus_regular.maxDay, H5)}`, `${day(r.focus_heavy.mythicDay, H5)} · ${day(r.focus_heavy.maxDay, H5)}`, day(r.focus_extreme.maxDay, H5), `${pct(r.buyer_regular.maxReach3y)} / ${pct(r.buyer_regular.maxReach5y)}`, `${pct(r.buyer_heavy.maxReach3y)} / ${pct(r.buyer_heavy.maxReach5y)}`])));
o.push(`\n보석으로 산 신화의 강화 재화 정책(목표 저축형이 보석으로 신화 구매):\n`);
o.push(table(["정책", "일반: 신화·최대", "일반: 강화에 쓴 보석·코인", "헤비: 신화·최대"], F.F12.gemPolicy.map((g: any) => [{ coin: "강화는 항상 코인", same: "구매한 재화로 강화", either: "코인·보석 중 선택" }[g.policy as "coin"], `${day(g.regular.mythicDay, H5)} · ${day(g.regular.maxDay, H5)}`, `${num(g.regular.gemsOnUpgrade)} · ${num(g.regular.coinsOnUpgrade)}`, `${day(g.heavy.mythicDay, H5)} · ${day(g.heavy.maxDay, H5)}`])));

o.push(`\n## 13. 상징적 초고가 상품(코인, 반복 수입만으로 걸리는 연수)\n`);
o.push(table(["가격", ...Object.keys(F.F13[0].yearsF2P).map((p) => `${P[p]} 무과금`), "고액 결제(구매 코인만)"], F.F13.map((r: any) => [num(r.price), ...Object.values(r.yearsF2P).map((y: any) => `${num(y, 1)}년`), `${num(r.yearsBigPayerPurchaseOnly, 1)}년`])));

const C = F.F14;
o.push(`\n## 14. Cloudflare 무료 플랜 — 실측 쓰기와 최대 운영 규모\n\n실측(\`scripts/economy/measure-room-writes.ts\`, 실제 \`worker/src/host.ts\` + 계수 저장소, DP Expert 2인, ${C.measured.matches}경기): 레코드 저장 ${num(C.measured.perMatch.recordSaves, 1)}회(굴림 ${num(C.measured.perMatch.saveByAction.roll, 1)} · 점수 ${num(C.measured.perMatch.saveByAction.score)} · 생성·입장·시작 3) + 알람 ${num(C.measured.perMatch.setAlarm, 1)}회 + 디렉터리 ${C.measured.directory.create + C.measured.directory.cleanup}회 ≈ **${num(C.measured.totalRoomRowWrites, 1)}**, 정리(삭제·알람 해제) +2 → 경기당 **${num(C.perMatchUsed, 1)}행**. 고정(hold) 메시지 ${num(C.measured.perMatch.holdMessages, 1)}개는 저장 0. 기존 설계 추정 120.\n`);
o.push(table(["저장 설계", "경기당 방 쓰기", "경제 쓰기/플레이어-경기", "무료 몫 50%", "70%", "100%"], C.designs.flatMap((d: any) => [0, 2, 3].map((e) => [`${d.id} ${d.label}`, num(d.writes, 1), e, ...[0.5, 0.7, 1].map((sh) => num(C.capacity.find((c: any) => c.design === d.id && c.econWritesPerPlayerMatch === e && c.quotaShare === sh).pvpMatchesPerDay))]))));
o.push(`\n(값 = 하루 PvP **경기** 수 상한. 1경기 = 플레이어 2명.)\n\nDO 실행 시간(무료 13,000 GB-s/일, 128MB 과금) — 경기 약 ${num(95 * 4)}초 가정:\n`);
o.push(table(["깨어 있는 비율", "GB-s/경기", "하루 경기 상한"], C.duration.map((d: any) => [pct(d.awakeShare), num(d.gbSecondsPerMatch, 1), num(d.matchesPerDay)])));
o.push(`\nDAU 환산(DAU는 신규 사용자 수와 다름):\n`);
o.push(table(["DAU 1명당 하루 PvP 경기", "현재 하루 방 300 한도의 DAU", "설계 B·경제 2쓰기·무료 몫 70%의 DAU"], C.dau.map((d: any) => [d.pvpMatchesPerDauPerDay, num(d.dauAt300RoomLimit), num(d.dauAtRowCapB70)])));
o.push(`\n${C.notes.map((n: string) => `- ${n}`).join("\n")}`);
writeFileSync("docs/economy/FOLLOWUP-GENERATED.md", o.join("\n") + "\n");
console.log("wrote docs/economy/FOLLOWUP-GENERATED.md");
