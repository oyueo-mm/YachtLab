/** PPO clipped ratio and GAE(λ) with terminal winner-credit rewards. Reuses the current observed action and its *frozen behavior policy* log probability. */
export function ppoSurrogate(oldLogProbability:number,newLogProbability:number,advantage:number,epsilon=.2){
  if(![oldLogProbability,newLogProbability,advantage].every(Number.isFinite)||!(epsilon>0&&epsilon<1))throw Error("Invalid PPO policy update");
  const ratio=Math.exp(Math.max(-30,Math.min(30,newLogProbability-oldLogProbability)));
  const clipped=Math.max(1-epsilon,Math.min(1+epsilon,ratio));
  const objective=Math.min(ratio*advantage,clipped*advantage);
  const frozen=(advantage>=0&&ratio>1+epsilon)||(advantage<0&&ratio<1-epsilon);
  return {objective,ratio,gradientFactor:frozen?0:ratio*advantage,clipped:frozen};
}
export function terminalGae(values:number[],credit:number,gamma=1,lambda_=0.95){
  if(!(credit>=0&&credit<=1)||!(gamma>0&&gamma<=1)||!(lambda_>=0&&lambda_<=1))throw Error("Invalid GAE parameters");
  const advantages=Array(values.length).fill(0),returns=Array(values.length).fill(0);
  let g=0;
  for(let i=values.length-1;i>=0;i--){
    const next=i===values.length-1?0:values[i+1];
    const reward=i===values.length-1?credit:0;
    const td=reward+gamma*next-values[i];
    g=td+gamma*lambda_*g;
    advantages[i]=g;returns[i]=g+values[i];
  }
  return {advantages,returns};
}
