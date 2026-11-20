/** Policy-conditional scorecard-state residual PMF, trained only from completed games.
 * Every remaining-category cohort has a CART-style tree on open-category mask,
 * upper subtotal, current score and projected DP final score. A leaf's empirical
 * histogram is Gaussian-smoothed and shrunk to its cohort prior.
 * This is conditional empirical estimation, NOT exact remaining-game DP PMF.
 */
export type ScorecardObservation={remaining:number;mask:number;upper:number;current:number;projected:number;residual:number;game:number};
export type ConditionalParams={minLeaf:number;alpha:number;bandwidth:number;maxDepth:number};
export type Pmf={offset:number;probabilities:number[];n:number};
export type TreeNode={n:number;split?:{feature:string;threshold:number};left?:TreeNode;right?:TreeNode;leaf?:Pmf};
export type ConditionalScoreModel={params:ConditionalParams;byRemaining:Record<string,{prior:Pmf;tree:TreeNode;mean:number;std:number;leaves:number}>};
export const BIN_LIMIT=160;
const BINS=BIN_LIMIT*2+1;
const bounded=(x:number)=>Math.max(0,Math.min(BINS-1,Math.round(x)+BIN_LIMIT));
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
function histogram(rows:ScorecardObservation[],bandwidth:number):number[]{
  const counts=new Float64Array(BINS),out=new Float64Array(BINS),kernel=[];
  for(const r of rows)counts[bounded(r.residual)]++;
  const radius=Math.min(100,Math.ceil(bandwidth*4));
  for(let d=-radius;d<=radius;d++)kernel.push(Math.exp(-d*d/(2*bandwidth*bandwidth)));
  const norm=kernel.reduce((a,b)=>a+b,0);
  for(let k=0;k<BINS;k++)if(counts[k]){
    for(let d=-radius;d<=radius;d++){
      const i=k+d;if(i>=0&&i<BINS)out[i]+=counts[k]*kernel[d+radius]/norm;
    }
  }
  const mass=out.reduce((a,b)=>a+b,0);
  return Array.from(out,x=>x/mass);
}
function statistics(rows:ScorecardObservation[]){const mu=mean(rows.map(r=>r.residual));const variance=mean(rows.map(r=>(r.residual-mu)**2));return{mean:mu,std:Math.max(2,Math.sqrt(variance))};}
function scoreSplit(rows:ScorecardObservation[],kind:string,threshold:number,minLeaf:number){
 const low:ScorecardObservation[]=[],high:ScorecardObservation[]=[];
 for(const row of rows){const v=kind.startsWith("mask")?((row.mask&(1<<Number(kind.slice(4))))!==0?1:0):kind==="upper"?row.upper:kind==="current"?row.current:row.projected;(v<=threshold?low:high).push(row);}
 if(low.length<minLeaf||high.length<minLeaf)return null;
 const a=statistics(low),b=statistics(high);
 const mu=(a.mean*low.length+b.mean*high.length)/rows.length;
 const gain=low.length*(a.mean-mu)**2+high.length*(b.mean-mu)**2;
 return{low,high,gain};
}
function choose(rows:ScorecardObservation[],minLeaf:number){
 const choices:Array<[string,number]>=[];
 for(let k=0;k<12;k++)choices.push(["mask"+k,.5]);
 for(const x of [21,42,62])choices.push(["upper",x]);
 for(const feature of ["current","projected"]){
  const sorted=rows.map(r=>feature==="current"?r.current:r.projected).sort((a,b)=>a-b);
  for(const q of [.25,.5,.75])choices.push([feature,sorted[Math.floor(q*(sorted.length-1))]]);
 }
 let chosen:null|{feature:string;threshold:number;low:ScorecardObservation[];high:ScorecardObservation[];gain:number}=null;
 for(const [feature,threshold] of choices){
  const s=scoreSplit(rows,feature,threshold,minLeaf);
  if(s&&s.gain>(chosen?.gain??1e-6))chosen={feature,threshold,...s};
 }
 return chosen;
}
function makeTree(rows:ScorecardObservation[],prior:Pmf,params:ConditionalParams,depth:number):TreeNode{
 const node:TreeNode={n:rows.length};
 const split=depth<params.maxDepth&&rows.length>=2*params.minLeaf?choose(rows,params.minLeaf):null;
 if(split){
  node.split={feature:split.feature,threshold:split.threshold};
  node.left=makeTree(split.low,prior,params,depth+1);
  node.right=makeTree(split.high,prior,params,depth+1);
 }else{
  const estimate=histogram(rows,params.bandwidth),alpha=params.alpha,n=rows.length;
  const probabilities=estimate.map((p,i)=>(n*p+alpha*prior.probabilities[i])/(n+alpha));
  node.leaf={offset:-BIN_LIMIT,probabilities,n};
 }
 return node;
}
function leaves(node:TreeNode):number{return node.leaf?1:leaves(node.left!)+leaves(node.right!);}
function traverse(node:TreeNode,state:Pick<ScorecardObservation,"mask"|"upper"|"current"|"projected">):Pmf{
 if(node.leaf)return node.leaf;
 const {feature,threshold}=node.split!;
 const v=feature.startsWith("mask")?(state.mask&(1<<Number(feature.slice(4)))?1:0):feature==="upper"?state.upper:feature==="current"?state.current:state.projected;
 return traverse(v<=threshold?node.left!:node.right!,state);
}
export function trainConditionalScoreModel(rows:ScorecardObservation[],params:ConditionalParams):ConditionalScoreModel{
 if(!rows.length||params.bandwidth<=0||params.alpha<0||params.minLeaf<2||params.maxDepth<0)throw Error("Invalid conditional scorecard dataset or hyperparameters.");
 const byRemaining:ConditionalScoreModel["byRemaining"]={};
 for(let n=3;n<=12;n++){
  const cohort=rows.filter(r=>r.remaining===n);
  if(!cohort.length)continue;
  const global={offset:-BIN_LIMIT,probabilities:histogram(cohort,params.bandwidth),n:cohort.length};
  const tree=makeTree(cohort,global,params,0);
  byRemaining[n]={prior:global,tree,...statistics(cohort),leaves:leaves(tree)};
 }
 return{params,byRemaining};
}
export function predictConditionalResidual(model:ConditionalScoreModel,state:Pick<ScorecardObservation,"remaining"|"mask"|"upper"|"current"|"projected">):Pmf{
 const group=model.byRemaining[String(state.remaining)];
 if(!group)throw Error("No trained PMF cohort for remaining categories "+state.remaining);
 return traverse(group.tree,state);
}
export function predictUnconditionalResidual(model:ConditionalScoreModel,remaining:number):Pmf{
 const group=model.byRemaining[String(remaining)];if(!group)throw Error("No unconditional PMF for "+remaining);return group.prior;
}
export function scoreDiscretePmf(pmf:Pmf,observedResidual:number){
 if(pmf.probabilities.length!==BINS)throw Error("Residual PMF must contain 321 bins.");
 const index=bounded(observedResidual);
 let cumulative=0,crps=0;
 for(let i=0;i<BINS;i++){
  cumulative+=pmf.probabilities[i];
  const truth=i>=index?1:0;
  crps+=(cumulative-truth)**2;
 }
 return{crps,nll:-Math.log(Math.max(1e-14,pmf.probabilities[index]))};
}
export function gaussianResidualPmf(mu:number,std:number):Pmf{
 if(!Number.isFinite(mu)||!(std>0))throw Error("Invalid Gaussian mean/sigma");
 const raw=Array.from({length:BINS},(_,i)=>Math.exp(-.5*((i-BIN_LIMIT-mu)/std)**2));
 const total=raw.reduce((a,b)=>a+b,0);
 return{offset:-BIN_LIMIT,probabilities:raw.map(p=>p/total),n:0};
}
export function scorecardPmfPayoff(pmf:Pmf,predictedFinal:number){
 // Forecast as a discrete total; interpolation between adjacent integral total
 // values prevents a discontinuous rounding artifact at a fractional DP mean.
 const outcomes=Array(601).fill(0);
 for(let i=0;i<pmf.probabilities.length;i++){
  const x=predictedFinal+pmf.offset+i,lo=Math.floor(x),hi=lo+1,t=x-lo;
  if(lo>=0&&lo<outcomes.length)outcomes[lo]+=pmf.probabilities[i]*(1-t);
  if(hi>=0&&hi<outcomes.length)outcomes[hi]+=pmf.probabilities[i]*t;
 }
 const prefix=Array(outcomes.length+1).fill(0);
 for(let i=0;i<outcomes.length;i++)prefix[i+1]=prefix[i]+outcomes[i];
 const mean=outcomes.reduce((sum,p,i)=>sum+p*i,0);
 return{mean,payoff:(score:number)=>{
  const i=Math.floor(score);
  if(i<0)return 0;if(i>=outcomes.length)return 1;
  return prefix[i]+outcomes[i]*.5;
 }};
}
