import{expect,it}from"vitest";
import{BIN_LIMIT,trainConditionalScoreModel,predictConditionalResidual,predictUnconditionalResidual,scoreDiscretePmf,scorecardPmfPayoff,gaussianResidualPmf}from"../src/conditional-score-pmf";
it("scorecard mask conditions distinct empirical final-score distributions",()=>{
 const rows=[];for(let i=0;i<100;i++)for(const [mask,residual] of [[2048,25],[1024,-25]])rows.push({remaining:3,mask,upper:i%4,current:120,projected:150,residual,game:i});
 const model=trainConditionalScoreModel(rows,{minLeaf:25,alpha:2,bandwidth:2,maxDepth:3});
 const plus=predictConditionalResidual(model,{remaining:3,mask:2048,upper:0,current:120,projected:150});
 const minus=predictConditionalResidual(model,{remaining:3,mask:1024,upper:0,current:120,projected:150});
 const mu=p=>p.probabilities.reduce((sum,v,i)=>sum+v*(i-BIN_LIMIT),0);
 expect(mu(plus)).toBeGreaterThan(15);expect(mu(minus)).toBeLessThan(-15);
 expect(plus.probabilities.reduce((a,b)=>a+b,0)).toBeCloseTo(1,10);
 expect(scoreDiscretePmf(plus,25).crps).toBeLessThan(scoreDiscretePmf(plus,-25).crps);
 expect(predictUnconditionalResidual(model,3).probabilities.reduce((a,b)=>a+b,0)).toBeCloseTo(1,10);
});
it("scorecard predicted total produces monotone bounded win-payoff",()=>{
 const g=gaussianResidualPmf(0,9),c=scorecardPmfPayoff(g,180.7);
 expect(c.payoff(120)).toBeLessThan(c.payoff(180));
 expect(c.payoff(200)).toBeLessThanOrEqual(1);
 expect(c.mean).toBeGreaterThan(178);expect(c.mean).toBeLessThan(184);
 expect(c.payoff(180)).toBeGreaterThan(0);expect(c.payoff(180)).toBeLessThan(1);
});
it("requires valid rows and accessible cohorts",()=>{
 expect(()=>trainConditionalScoreModel([],{minLeaf:10,alpha:2,bandwidth:5,maxDepth:3})).toThrow();
 const m=trainConditionalScoreModel([{remaining:12,mask:4095,upper:0,current:0,projected:191,residual:0,game:1}],{minLeaf:2,alpha:5,bandwidth:5,maxDepth:1});
 expect(()=>predictConditionalResidual(m,{remaining:3,mask:1,upper:0,current:0,projected:20})).toThrow();
});
