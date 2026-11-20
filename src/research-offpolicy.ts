// @ts-nocheck
// Pure utility functions for full-game self-play off-policy RL research.
// All rewards and model targets use win-credit in [0,1] (win=1, tie=.5).
export const F=13;
export const softmax=(xs,temperature=1)=>{const hi=Math.max(...xs),p=xs.map(x=>Math.exp(Math.max(-40,(x-hi)/temperature))),z=p.reduce((a,b)=>a+b,0);return p.map(v=>v/z);};
export const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
export const average=xs=>xs.reduce((s,x)=>s+x,0)/xs.length;
export const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
export const rng=(seed)=>{let s=seed>>>0;return()=>{s=(Math.imul(1664525,s)+1013904223)>>>0;return s/4294967296;}};
export const clone=(p)=>JSON.parse(JSON.stringify(p));
export const vector=(seed,n,scale=.01)=>{const rand=rng(seed);return Array.from({length:n},()=>scale*(rand()*2-1));};
export const represent=(candidate,bestQ)=>[...candidate.features,clamp((candidate.q-bestQ)/6,-1,0)];
export const actionFeatures=(candidates)=>{const best=Math.max(...candidates.map(x=>x.q));return candidates.map(c=>represent(c,best));};
export const HIDDEN=8;
export const encode=(net,feature)=>net.encoder.map((row,j)=>Math.tanh(dot(row,feature)+net.bias[j]));
export const dueling=(net,features)=>{
 const hidden=features.map(f=>encode(net,f));
 const state=Array.from({length:HIDDEN},(_,j)=>average(hidden.map(x=>x[j])));
 const value=dot(net.value,state),raw=hidden.map(x=>dot(net.adv,x)),mean=average(raw);
 return {q:raw.map((x,i)=>clamp(.5+.018*features[i][F-1]+value+x-mean,0,1)),state,raw,hidden};
};
export const createDueling=seed=>({
 encoder:Array.from({length:HIDDEN},(_,i)=>vector(seed+i*121,F,.09)),
 bias:Array(HIDDEN).fill(0),value:vector(seed+21231,HIDDEN,.01),adv:vector(seed+23451,HIDDEN,.01),
});
export const stepDueling=(net,features,action,target,lr,weight=1)=>{
 const info=dueling(net,features),err=clamp(target-info.q[action],-1,1);
 const n=features.length,rate=lr*weight*err,prevValue=[...net.value],prevAdv=[...net.adv];
 for(let j=0;j<HIDDEN;j++){
  net.value[j]+=rate*info.state[j];
  net.adv[j]+=rate*(info.hidden[action][j]-info.state[j]);
  for(let i=0;i<n;i++){
   const influence=(prevValue[j]/n+prevAdv[j]*((i===action?1:0)-1/n))*(1-info.hidden[i][j]**2);
   net.bias[j]+=rate*influence;
   for(let k=0;k<F;k++)net.encoder[j][k]+=rate*influence*features[i][k];
  }
 }
 return{td:err,q:info.q[action]};
};
export const createQuantiles=(seed,k=16)=>({
 encoder:Array.from({length:HIDDEN},(_,i)=>vector(seed+i*173,F,.10)),
 bias:Array(HIDDEN).fill(0),heads:Array.from({length:k},(_,j)=>vector(seed+20021+j*31,HIDDEN,.012)),n:k,
});
export const quantileOutput=(net,feature)=>{
 const hidden=encode(net,feature);
 return net.heads.map(h=>clamp(.5+.018*feature[F-1]+dot(h,hidden),0,1));
};
export const quantileValue=(net,features)=>features.map(f=>average(quantileOutput(net,f)));
export const quantileUpdate=(net,feature,targets,lr,weight=1)=>{
 const hidden=encode(net,feature),predicted=quantileOutput(net,feature),n=predicted.length,m=targets.length,downstream=Array(HIDDEN).fill(0);
 let loss=0;
 for(let i=0;i<n;i++){
  let gradient=0;const tau=(i+.5)/n,oldHead=[...net.heads[i]];
  for(const y of targets){
   const e=y-predicted[i],h=Math.abs(e)<1?.5*e*e:Math.abs(e)-.5,der=clamp(e,-1,1),factor=Math.abs(tau-(e<0?1:0));
   loss+=factor*h/(n*m);gradient+=factor*der/m;
  }
  const g=weight*gradient/n;
  for(let j=0;j<HIDDEN;j++){net.heads[i][j]+=lr*g*hidden[j];downstream[j]+=g*oldHead[j];}
 }
 for(let j=0;j<HIDDEN;j++){
  const g=downstream[j]*(1-hidden[j]*hidden[j]);net.bias[j]+=lr*g;
  for(let k=0;k<F;k++)net.encoder[j][k]+=lr*g*feature[k];
 }
 return{loss,mean:average(predicted),td:average(targets)-average(predicted)};
};
export const projectModel=(sampled,seed,offset=0)=>({seed,rand:rng(seed+offset),network:sampled});
export const maskKey=state=>state.dice.map(x=>x.value).join("");
export const pairCI=values=>{const n=values.length,mu=average(values),sd=Math.sqrt(values.reduce((a,b)=>a+(b-mu)**2,0)/Math.max(1,n-1));return{rate:mu,pairs:n,ci95:[clamp(mu-1.96*sd/Math.sqrt(n),0,1),clamp(mu+1.96*sd/Math.sqrt(n),0,1)]};};
