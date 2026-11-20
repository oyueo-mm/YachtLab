import { createServer } from "vite";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
const smoke=process.argv.includes("--smoke");
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:"custom"});
const mix=x=>{x>>>=0;x=Math.imul(x^(x>>>16),0x85ebca6b)>>>0;x=Math.imul(x^(x>>>13),0xc2b2ae35)>>>0;return(x^(x>>>16))>>>0;};
const mean=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
try {
  const engine=await server.ssrLoadModule("/src/engine.ts");
  const {decide}=await server.ssrLoadModule("/src/ai.ts");
  const {dpDecision,dpFutureValue,setDPTable}=await server.ssrLoadModule("/src/dp.ts");
  const {winDPv2Decision}=await server.ssrLoadModule("/src/competitive-v2.ts");
  const manifest=JSON.parse(await readFile("src/dp-manifest.json","utf8"));
  const b=gunzipSync(await readFile("public/ai/"+manifest.asset));
  setDPTable(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
  const mask=card=>engine.categories.reduce((m,c,i)=>m|(card[c]===undefined?1<<i:0),0);
  const agents=["DP Expert","Win DP v2","Greedy"];
  const ntrain=smoke?4:240,ntest=smoke?4:240;
  function run(policy,seed) {
    let s=engine.createGame(seed,true);
    const checkpoints=[];
    while(!s.done){
      if(!s.rolls){
        s=engine.transition(s,{type:"roll"});
        if(s.player===0){
          const card=s.cards[0],remaining=engine.available(card).length;
          checkpoints.push({remaining,predicted:engine.total(card)+dpFutureValue(mask(card),Math.min(63,engine.upper(card)))});
        }
        continue;
      }
      const choice=s.player===0?policy:"DP Expert";
      const d=choice==="DP Expert"?dpDecision(s):choice==="Win DP v2"?(winDPv2Decision(s)??dpDecision(s)):decide(s,"Greedy");
      if(d.type==="score")s=engine.transition(s,{type:"score",category:d.category});
      else{s=engine.transition(s,{type:"hold",ids:d.ids});s=engine.transition(s,{type:"roll"});}
    }
    const actual=engine.total(s.cards[0]);
    return checkpoints.map(x=>({...x,residual:actual-x.predicted,actual}));
  }
  function fit(rows) {
    const result={};
    for(let rem=1;rem<=12;rem++){
      const values=rows.filter(r=>r.remaining===rem).map(r=>r.residual);
      const mu=mean(values),std=Math.sqrt(values.reduce((a,v)=>a+(v-mu)**2,0)/Math.max(1,values.length-1));
      result[String(rem)]={bias:mu,std:Math.max(2,std),samples:values.length};
    }
    return result;
  }
  function evaluate(rows,model) {
    let mse=0,nll=0,mseUncalibrated=0,meanResidual=0;
    for(const r of rows){
      const {bias,std}=model[String(r.remaining)],error=r.residual-bias;
      mse+=error*error;mseUncalibrated+=r.residual*r.residual;meanResidual+=error;
      nll+=.5*Math.log(2*Math.PI*std*std)+error*error/(2*std*std);
    }
    return {games:rows.length/12,checkpoints:rows.length,rmse:Math.sqrt(mse/rows.length),
      uncalibratedRmse:Math.sqrt(mseUncalibrated/rows.length),
      gaussianNll:nll/rows.length,meanResidual:meanResidual/rows.length};
  }
  const models={};
  for(let index=0;index<agents.length;index++){
    const name=agents[index],train=[],test=[];
    for(let i=0;i<ntrain;i++)train.push(...run(name,mix(25100000+index*80000+i)));
    for(let i=0;i<ntest;i++)test.push(...run(name,mix(25500000+index*80000+i)));
    const parameters=fit(train);
    models[name]={parameters,validation:evaluate(test,parameters),
      caution:"Conditional empirical Gaussian residual around expected-score DP; trained on this policy and game rules; not exact opponent probability."};
    console.log("OPPONENT_CALIBRATION "+JSON.stringify({name,validation:models[name].validation,
      rem3:parameters["3"],rem5:parameters["5"],rem8:parameters["8"]}));
  }
  const output={modelVersion:process.env.GITHUB_SHA??"local",timestamp:new Date().toISOString(),
    rules:"Nintendo-style 12 categories, five dice, max three rolls, upper bonus 35 at >=63",
    trainGamesPerOpponent:ntrain,testGamesPerOpponent:ntest,trainingAndValidationSeedsSeparate:true,
    model:"conditional Gaussian residual around predicted final score = current total + exact solo DP future expectation",
    opponents:models,limitations:[
      "Normal residual model is calibrated empirically, not an exact score PMF.",
      "Single-player DP projected mean is a feature; future Win DP v2/Greedy behavior can make it biased.",
      "Every round checkpoint within a game is correlated; evaluation log-loss describes a forecast, not an independent trial-based win-rate test.",
      "Opponent behavior may adapt to our policy, violating the static empirical forecast assumption.",
    ]};
  await mkdir("training/results",{recursive:true});
  await writeFile("training/results/opponent-calibration.json",JSON.stringify(output,null,2)+"\n");
  console.log("CALIBRATION_SUMMARY "+JSON.stringify({trainGames:ntrain,testGames:ntest,results:agents.map(name=>({name,...models[name].validation}))}));
}finally{await server.close();}
