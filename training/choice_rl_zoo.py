"""YachtLab research-only policy-gradient / value-based RL comparison.

All algorithms are trained only for the final CHOICE category, target 25.
This is not a full-game competitive AI. It provides a controlled pilot of
distinct learning algorithms with identical observations and separate seeds.
"""
import argparse
import json
import math
import random
from collections import deque
from pathlib import Path
import numpy as np
import torch
from torch import nn
from torch.distributions import Categorical

THRESHOLD = 25
ACTIONS = 33
INPUTS = 31

def mix(seed):
    x = seed & 0xffffffff
    x ^= x >> 16; x = x * 0x85ebca6b & 0xffffffff
    x ^= x >> 13; x = x * 0xc2b2ae35 & 0xffffffff
    return x ^ (x >> 16)

def encode(dice, left):
    x = np.zeros(INPUTS, dtype=np.float32)
    for i, value in enumerate(sorted(dice)):
        x[i * 6 + value - 1] = 1
    x[30] = left / 2
    return x

def allowed(left):
    return list(range(32)) + [32] if left > 0 else [32]

def transition(dice, left, action, rng):
    if action == 32 or left == 0:
        return sorted(dice), 0, True, float(sum(dice) >= THRESHOLD)
    held = [value for i, value in enumerate(sorted(dice)) if action & (1 << i)]
    return sorted(held + [rng.randrange(1, 7) for _ in range(5 - len(held))]), left - 1, False, 0.0

class QNet(nn.Module):
    def __init__(self):
        super().__init__()
        self.layers = nn.Sequential(nn.Linear(INPUTS, 64), nn.ReLU(), nn.Linear(64, 64), nn.ReLU(), nn.Linear(64, ACTIONS))
    def forward(self, x): return self.layers(x)

class ActorCritic(nn.Module):
    def __init__(self):
        super().__init__()
        self.layers = nn.Sequential(nn.Linear(INPUTS, 64), nn.ReLU(), nn.Linear(64, 64), nn.ReLU())
        self.policy = nn.Linear(64, ACTIONS)
        self.value = nn.Linear(64, 1)
    def forward(self, x):
        hidden = self.layers(x)
        return self.policy(hidden), self.value(hidden).squeeze(-1)

def mask_logits(logits, left):
    if left == 0:
        logits = logits.clone()
        logits[..., :32] = -1e9
    return logits

def score_ci(wins, trials):
    p = wins / trials
    z = 1.96
    den = 1 + z*z/trials
    center = (p + z*z/(2*trials)) / den
    radius = z * math.sqrt(p*(1-p)/trials + z*z/(4*trials*trials)) / den
    return [max(0, center-radius), min(1, center+radius)]

def greedy_action(model, dice, left, kind, device):
    with torch.no_grad():
        x = torch.from_numpy(encode(dice, left)).to(device).unsqueeze(0)
        v = model(x)[0] if kind in ("reinforce", "a2c") else model(x)
        return int(mask_logits(v, left).argmax().item())

def evaluate(name, model, count, seed, device):
    wins = 0
    records = []
    for episode in range(count):
        rng = random.Random(mix(seed + episode))
        dice = sorted(rng.randrange(1, 7) for _ in range(5))
        left = 2
        for _ in range(3):
            if name == "random":
                action = rng.choice(allowed(left))
            elif name == "keep-high":
                action = sum((1 << i) for i,v in enumerate(dice) if v >= 5) if left else 32
            elif name == "keep-4plus":
                action = sum((1 << i) for i,v in enumerate(dice) if v >= 4) if left else 32
            elif name == "stop-now":
                action = 32
            else:
                action = greedy_action(model, dice, left, name, device)
            dice, left, done, reward = transition(dice, left, action, rng)
            if done:
                wins += int(reward)
                records.append(int(reward))
                break
        else:
            raise RuntimeError("Game did not stop after at most 3 decisions")
    return {"policy": name, "games":count, "targetProbability":wins/count,"ci95Wilson":score_ci(wins,count), "wins":wins, "bitsetSuccesses": [i for i,v in enumerate(records) if v]}

def train_policy(name, episodes, seed, device):
    torch.manual_seed(seed)
    rng = random.Random(seed)
    model = ActorCritic().to(device)
    opt = torch.optim.Adam(model.parameters(), lr=0.00045 if name == "a2c" else 0.00035)
    moving = 0.4
    checkpoints = []
    for ep in range(episodes):
        dice = sorted(rng.randrange(1, 7) for _ in range(5))
        left = 2
        log_probs, entropies, values = [], [], []
        for _ in range(3):
            x = torch.from_numpy(encode(dice, left)).to(device).unsqueeze(0)
            logits, value = model(x)
            distribution = Categorical(logits=mask_logits(logits[0], left))
            action = distribution.sample()
            log_probs.append(distribution.log_prob(action))
            entropies.append(distribution.entropy())
            values.append(value[0])
            dice,left,done,reward = transition(dice,left,int(action.item()),rng)
            if done: break
        goal = torch.tensor(float(reward), dtype=torch.float32, device=device)
        if name == "reinforce":
            advantage = goal - moving
            loss = -torch.stack(log_probs).sum()*advantage - 0.001*torch.stack(entropies).sum()
            moving = 0.995*moving + 0.005*float(reward)
        else:
            vals = torch.stack(values)
            advantage = goal - vals
            loss = -(torch.stack(log_probs)*advantage.detach()).sum() + 0.4*advantage.square().mean() - 0.001*torch.stack(entropies).sum()
        opt.zero_grad();loss.backward()
        nn.utils.clip_grad_norm_(model.parameters(),5.0)
        opt.step()
        if (ep+1)%max(1000,episodes//4)==0:
            small = evaluate(name,model,500,seed+200000+ep,device)
            checkpoints.append({"episodes":ep+1,"heldout500":small["targetProbability"]})
            print("RL_PROGRESS "+json.dumps({"policy":name,"episodes":ep+1,"heldout500":small["targetProbability"]}),flush=True)
    return model,{"updates":episodes,"checkpoints":checkpoints}

def train_dqn(name, episodes, seed, device):
    torch.manual_seed(seed)
    rng = random.Random(seed)
    model = QNet().to(device)
    target = QNet().to(device)
    target.load_state_dict(model.state_dict())
    opt = torch.optim.Adam(model.parameters(),lr=0.0005)
    memory = deque(maxlen=20000)
    updates = 0
    history = []
    for ep in range(episodes):
        dice = sorted(rng.randrange(1, 7) for _ in range(5))
        left = 2
        epsilon = max(.05,.4*(1-ep/episodes))
        for _ in range(3):
            state=encode(dice,left)
            if rng.random()<epsilon:
                action=rng.choice(allowed(left))
            else:
                action=greedy_action(model,dice,left,name,device)
            next_dice,next_left,done,reward=transition(dice,left,action,rng)
            memory.append((state,action,reward,encode(next_dice,next_left),next_left,float(done)))
            if len(memory)>=128:
                samples=rng.sample(memory,64)
                states=torch.tensor(np.stack([r[0] for r in samples]),device=device)
                actions=torch.tensor([r[1] for r in samples],dtype=torch.long,device=device)
                rewards=torch.tensor([r[2] for r in samples],device=device)
                next_states=torch.tensor(np.stack([r[3] for r in samples]),device=device)
                dones=torch.tensor([r[5] for r in samples],device=device)
                pred=model(states).gather(1,actions[:,None]).squeeze(1)
                with torch.no_grad():
                    if name=="double-dqn": next_q=model(next_states)
                    else: next_q=target(next_states)
                    invalid=torch.tensor([r[4]==0 for r in samples],dtype=torch.bool,device=device)
                    next_q[invalid,:32]=-1e9
                    best_action=next_q.argmax(dim=1)
                    next_target=target(next_states).gather(1,best_action[:,None]).squeeze(1)
                    y=rewards+(1-dones)*next_target
                loss=nn.functional.smooth_l1_loss(pred,y)
                opt.zero_grad();loss.backward()
                nn.utils.clip_grad_norm_(model.parameters(),5.0)
                opt.step();updates+=1
                if updates%250==0:target.load_state_dict(model.state_dict())
            dice,left=next_dice,next_left
            if done:break
        if (ep+1)%max(1000,episodes//4)==0:
            small=evaluate(name,model,500,seed+200000+ep,device)
            history.append({"episodes":ep+1,"heldout500":small["targetProbability"]})
            print("RL_PROGRESS "+json.dumps({"policy":name,"episodes":ep+1,"heldout500":small["targetProbability"]}),flush=True)
    return model,{"updates":updates,"checkpoints":history}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--episodes",type=int,default=9000)
    parser.add_argument("--eval",type=int,default=5000)
    parser.add_argument("--seed",type=int,default=27111)
    parser.add_argument("--smoke",action="store_true")
    args=parser.parse_args()
    if args.smoke:args.episodes=48;args.eval=120
    assert args.episodes>=20 and args.eval>=100
    torch.set_num_threads(2)
    device=torch.device("cpu")
    experiments=[]
    model_root=Path("training/checkpoints/choice-rl-zoo")
    model_root.mkdir(parents=True,exist_ok=True)
    for index,name in enumerate(["reinforce","a2c","dqn","double-dqn"]):
        if name in ("reinforce","a2c"):model,history=train_policy(name,args.episodes,args.seed+index*911,device)
        else:model,history=train_dqn(name,args.episodes,args.seed+index*911,device)
        result=evaluate(name,model,args.eval,args.seed+2100000,device)
        result["training"]=history
        experiments.append(result)
        torch.save({"algorithm":name,"state_dict":model.state_dict(),"train":history},model_root/(name+".pt"))
        print("RL_POLICY_SUMMARY "+json.dumps({k:v for k,v in result.items() if k!="bitsetSuccesses"}),flush=True)
    for name in ["stop-now","random","keep-high","keep-4plus"]:
        experiments.append(evaluate(name,None,args.eval,args.seed+2100000,device))
    summary={"task":"Choice-only 5 dice, <= 3 rolls, target >=25","notFullYachtLab":True,"episodes":args.episodes,"evalGames":args.eval,
      "evaluationSeeds":"independent per-episode mixed seeds starting "+str(args.seed+2100000),
      "referenceExactDPProbabilityAt25":0.41671,"reference":"past independently enumerated optimal threshold DP; not retrained or reevaluated here",
      "trainingAlgorithms":["REINFORCE with moving-average baseline","A2C","DQN","Double DQN"],
      "controls":["no reroll","random hold","keep dice >=5","keep dice >=4"],
      "limitations":["Single final Choice category, not 12-turn competitive AI","No model selection on evaluation set","Different action-dependent random streams, same independent episode seeds","Normality/multiple comparison not assumed; Wilson interval per policy"],
      "results":experiments}
    Path("training/results").mkdir(parents=True,exist_ok=True)
    Path("training/results/choice-rl-zoo.json").write_text(json.dumps(summary,indent=2)+"\n",encoding="utf8")
    print("RL_ZOO_SUMMARY "+json.dumps({k:v for k,v in summary.items() if k!="results"}|{"results":[{k:v for k,v in x.items() if k!="bitsetSuccesses"} for x in experiments]}),flush=True)

if __name__=="__main__":main()
