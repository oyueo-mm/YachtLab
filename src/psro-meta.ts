/** True empirical restricted meta-game solver for a symmetric two-player zero-sum YachtLab league. Each matrix cell is a seat-swapped estimate of E[2*winCredit-1]. This does not solve the full extensive-form game. */
export type MetaSolution = { mixture:number[]; rowMixture:number[]; columnMixture:number[]; restrictedExploitability:number; dualityGap:number; iterations:number };
const normalize=(v:number[])=>{const n=v.reduce((a,b)=>a+b,0);return v.map(x=>x/n);};
export function checkPayoff(payoff:number[][]):number {
  const n=payoff.length;
  if(!n||payoff.some(row=>row.length!==n))throw Error("Non-square empirical meta-game");
  for(let i=0;i<n;i++)for(let j=0;j<n;j++) {
    if(!Number.isFinite(payoff[i][j])||Math.abs(payoff[i][j])>1+1e-8)throw Error("Payoffs must be finite and in [-1,1]");
    if(Math.abs(payoff[i][j]+payoff[j][i])>1e-6)throw Error("Expected symmetric zero-sum antisymmetric payoff");
  }
  return n;
}
export function solveZeroSumMetaGame(payoff:number[][],iterations=20000):MetaSolution {
  const n=checkPayoff(payoff);if(!Number.isInteger(iterations)||iterations<10)throw Error("Need >=10 solver iterations");
  // Two-player fictitious play: row best response to column empirical distribution,
  // column minimizer best response to row empirical distribution. In zero sum,
  // the averaged empirical strategies approach a restricted Nash minimax profile.
  const row=Array(n).fill(1),col=Array(n).fill(1);
  for(let t=0;t<iterations;t++){
    const x=normalize(row),y=normalize(col);
    let bestRow=0,bestCol=0,largest=-Infinity,smallest=Infinity;
    for(let i=0;i<n;i++){
      const value=payoff[i].reduce((sum,u,j)=>sum+u*y[j],0);
      if(value>largest+1e-13){largest=value;bestRow=i;}
    }
    for(let j=0;j<n;j++){
      let value=0;for(let i=0;i<n;i++)value+=x[i]*payoff[i][j];
      if(value<smallest-1e-13){smallest=value;bestCol=j;}
    }
    row[bestRow]++;col[bestCol]++;
  }
  const x=normalize(row),y=normalize(col),mix=normalize(x.map((a,i)=>a+y[i]));
  const responses=payoff.map(r=>r.reduce((s,u,j)=>s+u*mix[j],0));
  const rowBest=Math.max(...payoff.map(r=>r.reduce((s,u,j)=>s+u*y[j],0)));
  const colBest=Math.min(...payoff[0].map((_,j)=>x.reduce((s,w,i)=>s+w*payoff[i][j],0)));
  return {mixture:mix,rowMixture:x,columnMixture:y,restrictedExploitability:Math.max(0,...responses),dualityGap:rowBest-colBest,iterations};
}
export function drawMetaPolicy(weights:number[],r:number):number {
  if(!weights.length||weights.some(x=>!Number.isFinite(x)||x<0)||Math.abs(weights.reduce((a,b)=>a+b,0)-1)>1e-5)throw Error("Invalid meta distribution");
  if(!(r>=0&&r<1))throw Error("Random draw must be in [0,1)");
  let t=r;for(let i=0;i<weights.length;i++){t-=weights[i];if(t<0||i===weights.length-1)return i;}
  return weights.length-1;
}
