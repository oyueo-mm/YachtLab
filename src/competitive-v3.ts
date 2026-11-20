import kernel from "./dp-kernel.json";
import { chanceValues, dpFutureValue } from "./dp";
import { dpOpponentGains, winDPv2Decision } from "./competitive-v2";
import { categories, total, upper, type Game } from "./engine";
import type { Decision } from "./ai";

// EXACT for our last <=3 scoring turns versus an assumed, EXOGENOUS final
// opponent score distribution. That opponent distribution is APPROXIMATE when
// the opponent has more than two turns remaining. This is not exact multiplayer
// minimax or an equilibrium, and must remain research-only until tested.
type Plan = { win: Float64Array[]; points: Float64Array[]; picks: Int16Array[]; turnWin: number; turnPoints: number };
export type OpponentForecast = { meanBias?: number; stdDev?: number; byRemaining?: Record<string, { bias: number; std: number }>; discreteResidualByRemaining?: Record<string, { offset: number; probabilities: number[] }> };
const EPS = 1e-12;
const FACES = 252;
const fullIndex = new Map(kernel.states.slice(210).map((d, i) => [d.join(""), i]));
const priorCache = new Map<string, Plan>();
const bitcount = (n: number) => { let c = 0; for (; n; n &= n - 1) c++; return c; };
const mask = (state: Game, p: number) => categories.reduce((m, c, i) => m | (state.cards[p][c] === undefined ? 1 << i : 0), 0);
const nextU = (c: number, pts: number, u: number) => c < 6 ? Math.min(63, u + pts) : u;
const prefer = (w: number, p: number, bw: number, bp: number) => w > bw + EPS || (Math.abs(w - bw) <= EPS && p > bp + EPS);
function normalCdf(x: number): number {
  // Abramowitz & Stegun 7.1.26, maximum abs CDF approximation error ~1e-7.
  const z = Math.abs(x), t = 1 / (1 + .2316419 * z);
  const phi = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
  const cdf = 1 - phi * (.319381530*t - .356563782*t*t + 1.781477937*t*t*t - 1.821255978*t*t*t*t + 1.330274429*t*t*t*t*t);
  return x >= 0 ? cdf : 1 - cdf;
}

export function opponentForecastPayoff(state: Game, forecast: OpponentForecast = {}) {
  const p = 1 - state.player, other = state.cards[p], remMask = mask(state, p), n = bitcount(remMask);
  const ownBase = total(other), u = Math.min(63, upper(other));
  if (n <= 2) {
    const dist = dpOpponentGains(remMask, u);
    const prefix = new Float64Array(dist.length + 1);
    for (let i = 0; i < dist.length; i++) prefix[i + 1] = prefix[i] + dist[i];
    return { mean: ownBase + dist.reduce((a,v,i)=>a+i*v,0), sigma:0, kind:"exact conditional DP opponent PMF",
      payoff: (finalScore: number) => {
        const diff = finalScore - ownBase;
        if (diff < 0) return 0;
        if (diff >= dist.length) return 1;
        return prefix[diff] + dist[diff] / 2;
      }
    };
  }
  const empirical = forecast.discreteResidualByRemaining?.[String(n)];
  if(empirical) {
    const probabilities=empirical.probabilities;
    const sum=probabilities.reduce((a,b)=>a+b,0);
    if(!probabilities.length || probabilities.some(p=>!Number.isFinite(p)||p<0)||Math.abs(sum-1)>1e-6)throw Error("Invalid opponent score residual PMF");
    const mean=ownBase+dpFutureValue(remMask,u),predicted=mean+
      probabilities.reduce((a,p,i)=>a+p*(empirical.offset+i),0);
    const points=probabilities.map((p,i)=>({score:Math.round(mean+empirical.offset+i),probability:p}));
    return {mean:predicted,sigma:NaN,kind:"empirical discrete conditional final-score residual PMF (score-bin approximation)",
      payoff:(finalScore:number)=>points.reduce((a,x)=>a+x.probability*(finalScore>x.score?1:finalScore===x.score?0.5:0),0)
    };
  }
  const calibration = forecast.byRemaining?.[String(n)];
  const bias = calibration?.bias ?? forecast.meanBias ?? 0;
  const sigma = Math.max(2, calibration?.std ?? forecast.stdDev ?? 11 * Math.sqrt(n));
  const mean = ownBase + dpFutureValue(remMask, u) + bias;
  return { mean, sigma, kind:"normal approximation of DP Expert future score (uncalibrated if no forecast provided)",
    payoff: (finalScore: number) => .5 * (normalCdf((finalScore - mean - .5) / sigma) + normalCdf((finalScore - mean + .5) / sigma))
  };
}

function createPlan(maskOfOpen: number, currentU: number, base: number, payoff: (points: number) => number, memo: Map<string, Plan>): Plan {
  const key = maskOfOpen + ":" + currentU + ":" + base;
  const hit = memo.get(key);
  if (hit) return hit;
  const stopW = new Float64Array(FACES), stopP = new Float64Array(FACES), scoreChoices = new Int16Array(FACES);
  const future = new Map<string, Plan>();
  for (let d = 0; d < FACES; d++) {
    let bw = -Infinity, bp = -Infinity, bc = -1;
    for (let c = 0; c < 12; c++) {
      if (!(maskOfOpen & (1 << c))) continue;
      const pts = kernel.points[d][c], nu = nextU(c, pts, currentU);
      const gain = pts + (currentU < 63 && nu >= 63 ? 35 : 0);
      const sum = base + gain, next = maskOfOpen ^ (1 << c);
      let w: number, p: number;
      if (next === 0) { w = payoff(sum); p = sum; }
      else {
        const nextKey = next + ":" + nu + ":" + sum;
        let child = future.get(nextKey);
        if (!child) { child = createPlan(next, nu, sum, payoff, memo); future.set(nextKey, child); }
        w = child.turnWin; p = child.turnPoints;
      }
      if (prefer(w, p, bw, bp)) { bw = w; bp = p; bc = c; }
    }
    stopW[d] = bw; stopP[d] = bp; scoreChoices[d] = bc;
  }
  const win = [stopW], points = [stopP], picks = [scoreChoices];
  for (let left = 1; left <= 2; left++) {
    const cw = chanceValues(win[left - 1]), cp = chanceValues(points[left - 1]);
    const w = new Float64Array(FACES), p = new Float64Array(FACES), a = new Int16Array(FACES);
    for (let d = 0; d < FACES; d++) {
      let bw = stopW[d], bp = stopP[d], selected = scoreChoices[d];
      for (const h of kernel.holds[d]) {
        if (h >= 210) continue;
        if (prefer(cw[h], cp[h], bw, bp)) { bw = cw[h]; bp = cp[h]; selected = 12 + h; }
      }
      w[d] = bw; p[d] = bp; a[d] = selected;
    }
    win.push(w); points.push(p); picks.push(a);
  }
  let ew = 0, ep = 0;
  for (let d = 0; d < FACES; d++) { ew += kernel.probabilities[d] * win[2][d]; ep += kernel.probabilities[d] * points[2][d]; }
  const value = { win, points, picks, turnWin:ew, turnPoints:ep };
  memo.set(key, value);
  return value;
}

export function winDPv3Decision(state: Game, forecast: OpponentForecast = {}): Decision | null {
  if (state.done || !state.rolls) throw Error("Win DP v3 requires visible dice after a roll.");
  const m = mask(state, state.player), rem = bitcount(m);
  if (rem <= 2) return winDPv2Decision(state);
  if (rem !== 3) return null;
  const opponent = opponentForecastPayoff(state, forecast);
  const key = [m, Math.min(63, upper(state.cards[state.player])), total(state.cards[state.player]),
    mask(state, 1-state.player), total(state.cards[1-state.player]), Math.min(63,upper(state.cards[1-state.player])),
    opponent.mean.toFixed(3),String(opponent.sigma),opponent.kind, forecast.discreteResidualByRemaining?JSON.stringify(forecast.discreteResidualByRemaining[String(bitcount(mask(state,1-state.player)))])??"":""].join(":");
  let plan = priorCache.get(key);
  if (!plan) {
    plan = createPlan(m, Math.min(63, upper(state.cards[state.player])), total(state.cards[state.player]), opponent.payoff, new Map());
    if (priorCache.size >= 5) priorCache.clear();
    priorCache.set(key, plan);
  }
  const d = fullIndex.get(state.dice.map(x=>x.value).sort((a,b)=>a-b).join(""))!;
  const left = 3-state.rolls, action = plan.picks[left][d];
  const common = { value:plan.win[left][d], candidates:[],
    note:"Win DP v3 (research): exact own last-three-turn Bellman under fixed opponent-score forecast; "+opponent.kind+"; not full-game equilibrium" };
  if (action < 12) return { type:"score", category:categories[action], ...common };
  const keep = [...kernel.states[action-12]];
  const ids = state.dice.filter(die => {
    const at = keep.indexOf(die.value);
    if (at < 0) return false;
    keep.splice(at,1);
    return true;
  }).map(die=>die.id);
  return { type:"reroll", ids, ...common };
}
