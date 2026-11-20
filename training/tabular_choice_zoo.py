"""Research-only tabular control algorithms on the exact Choice last-turn MDP.
All observations are dice multiset and remaining rerolls. Never reads Game.seed/rng.
Eight distinct tabular learners/configurations; no claim of full-game SOTA.
"""
import argparse
import itertools
import json
import math
import random
from collections import deque
from pathlib import Path
import numpy as np

DICE = tuple(itertools.combinations_with_replacement(range(1,7),5))
DINDEX = {d:i for i,d in enumerate(DICE)}
LEARNERS = ("q-learning","sarsa","expected-sarsa","double-q","first-visit-mc","dyna-q","ucb-q","optimistic-q")

def mix(seed):
    x=seed&0xffffffff
    x^=x>>16;x=x*0x85ebca6b&0xffffffff
    x^=x>>13;x=x*0xc2b2ae35&0xffffffff
    return x^(x>>16)

def valid(left):
    return range(33) if left else (32,)

def roll(dice,left,action,rng):
    if action==32 or left==0:return dice,0,True,int(sum(dice)>=25)
    kept=[face for i,face in enumerate(dice) if action&(1<<i)]
    return tuple(sorted(kept+[rng.randrange(1,7) for _ in range(5-len(kept))])),left-1,False,0

def best(q,left,state,rng=None):
    ids=valid(left)
    high=max(float(q[left,state,a]) for a in ids)
    ties=[a for a in ids if abs(float(q[left,state,a])-high)<1e-7]
    return ties[0] if rng is None else rng.choice(ties)

def choose(q,left,state,epsilon,rng,method,qa=None,qb=None,counts=None):
    if rng.random()<epsilon:return rng.choice(list(valid(left)))
    if method=="double-q":
        return best(qa+qb,left,state,rng)
    if method=="ucb-q" and counts is not None:
        visits=max(1,int(counts[left,state,:].sum()))
        vals=[float(q[left,state,a])+0.15*math.sqrt(math.log(2+visits)/(1+counts[left,state,a])) for a in valid(left)]
        return list(valid(left))[int(np.argmax(vals))]
    return best(q,left,state,rng)

def target_max(q,left,state):
    return max(float(q[left,state,a]) for a in valid(left))

def train(method,episodes,seed):
    rng=random.Random(seed)
    q=np.full((3,252,33),0.4 if method=="optimistic-q" else 0,dtype=np.float32)
    qa=np.zeros_like(q) if method=="double-q" else None
    qb=np.zeros_like(q) if method=="double-q" else None
    counts=np.zeros_like(q,dtype=np.int32) if method=="ucb-q" else None
    memory=deque(maxlen=20000)
    history=[]
    for episode in range(episodes):
        dice=tuple(sorted(rng.randrange(1,7) for _ in range(5)))
        left=2;state=DINDEX[dice]
        epsilon=max(.025,.28*(1-episode/episodes))
        trace=[]
        prechosen=None
        for step in range(3):
            action=prechosen if prechosen is not None else choose(q,left,state,epsilon,rng,method,qa,qb,counts)
            next_dice,nleft,done,reward=roll(dice,left,action,rng)
            ns=DINDEX[next_dice]
            next_action=None
            if not done and method=="sarsa":next_action=choose(q,nleft,ns,epsilon,rng,method)
            trace.append((left,state,action,nleft,ns,done,reward))
            if method=="double-q":
                if rng.random()<.5:
                    a=best(qa,nleft,ns) if not done else 32
                    value=float(qb[nleft,ns,a]) if not done else 0
                    qa[left,state,action]+=.16*(reward+value-float(qa[left,state,action]))
                else:
                    a=best(qb,nleft,ns) if not done else 32
                    value=float(qa[nleft,ns,a]) if not done else 0
                    qb[left,state,action]+=.16*(reward+value-float(qb[left,state,action]))
            elif method=="first-visit-mc":
                pass
            else:
                if method=="sarsa":
                    future=float(q[nleft,ns,next_action]) if not done else 0
                elif method=="expected-sarsa":
                    future=(1-epsilon)*target_max(q,nleft,ns)+epsilon*np.mean([q[nleft,ns,a] for a in valid(nleft)]) if not done else 0
                else:
                    future=target_max(q,nleft,ns) if not done else 0
                q[left,state,action]+=.16*(reward+future-float(q[left,state,action]))
                if counts is not None:counts[left,state,action]+=1
                if method=="dyna-q":
                    memory.append((left,state,action,nleft,ns,done,reward))
                    for _ in range(3):
                        a,b,c,d,e,f,g=rng.choice(memory)
                        tgt=g+(target_max(q,d,e) if not f else 0)
                        q[a,b,c]+=.10*(tgt-float(q[a,b,c]))
            if done:break
            dice,left,state=next_dice,nleft,ns
            prechosen=next_action
        if method=="first-visit-mc":
            visited=set()
            for a,b,c,_d,_e,_f,_g in trace:
                if (a,b,c) in visited:continue
                visited.add((a,b,c))
                q[a,b,c]+=.12*(reward-float(q[a,b,c]))
        if (episode+1)%max(1000,episodes//5)==0:
            rate=evaluate(method,q,500,seed+100000+episode,qa,qb)["targetProbability"]
            history.append({"episodes":episode+1,"heldout500":rate})
            print("TABULAR_PROGRESS "+json.dumps({"algorithm":method,"episodes":episode+1,"heldout500":rate}),flush=True)
    policy=qa+qb if method=="double-q" else q
    return policy,history

def wilson(w,n):
    p=w/n;z=1.96;d=1+z*z/n;mid=(p+z*z/(2*n))/d
    half=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d
    return [mid-half,mid+half]

def evaluate(method,q,games,seed,qa=None,qb=None):
    wins=0
    for i in range(games):
        rng=random.Random(mix(seed+i))
        dice=tuple(sorted(rng.randrange(1,7) for _ in range(5)));left=2
        for _ in range(3):
            if method=="keep-high":
                action=sum((1<<j) for j,v in enumerate(dice) if v>=5) if left else 32
            elif method=="keep-4plus":
                action=sum((1<<j) for j,v in enumerate(dice) if v>=4) if left else 32
            elif method=="random":action=rng.choice(list(valid(left)))
            else:action=best(q,left,DINDEX[dice])
            dice,left,done,reward=roll(dice,left,action,rng)
            if done:wins+=reward;break
        else:raise RuntimeError("A legal episode must terminate in at most 3 steps")
    return {"algorithm":method,"wins":wins,"games":games,"targetProbability":wins/games,"ci95Wilson":wilson(wins,games)}

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--episodes",type=int,default=250000)
    p.add_argument("--eval",type=int,default=10000)
    p.add_argument("--seed",type=int,default=28111)
    p.add_argument("--smoke",action="store_true")
    args=p.parse_args()
    if args.smoke:args.episodes=60;args.eval=100
    assert args.episodes>=30 and args.eval>=100
    saved=Path("training/checkpoints/tabular-choice-zoo")
    saved.mkdir(parents=True,exist_ok=True)
    results=[]
    for j,name in enumerate(LEARNERS):
        q,history=train(name,args.episodes,args.seed+j*987)
        data=evaluate(name,q,args.eval,args.seed+2300000)
        data["training"]={"episodes":args.episodes,"seed":args.seed+j*987,"progress":history}
        results.append(data)
        np.savez_compressed(saved/(name+".npz"),q=q)
        print("TABULAR_POLICY_SUMMARY "+json.dumps({k:v for k,v in data.items() if k!="training"}),flush=True)
    for name in ("keep-high","keep-4plus","random"):
        results.append(evaluate(name,None,args.eval,args.seed+2300000))
    out={"task":"Choice last-turn >=25, fair 5d6, max three rolls","notFullGame":True,
      "algorithmFamilies":list(LEARNERS),"trainingEpisodes":args.episodes,"evaluationGames":args.eval,
      "evaluationSeedBase":args.seed+2300000,"exactTargetDPReferenceAt25":0.41671,
      "limitations":["Tabular methods optimize a single last category, not 12-round match win rate","Search state is 252 sorted 5-die outcomes × remaining rerolls","Method configuration/hyperparameters are exploratory; no hyperparameter or multiple-comparison adjustment for these results","All policies use only the public dice and reroll count"],"results":results}
    Path("training/results").mkdir(parents=True,exist_ok=True)
    Path("training/results/tabular-choice-zoo.json").write_text(json.dumps(out,indent=2)+"\n",encoding="utf8")
    print("TABULAR_ZOO_SUMMARY "+json.dumps({"trainingEpisodes":args.episodes,"evaluationGames":args.eval,"results":[{k:v for k,v in x.items() if k!="training"} for x in results]}),flush=True)

if __name__=="__main__":main()
