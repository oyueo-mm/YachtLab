"""Research-only QR-DQN for YachtLab's one-category Choice endgame, threshold 25.
Not a full-game policy. No future dice RNG or game seed is passed to the model.
Run: python training/qr_dqn_choice.py --episodes 6000 --eval 3000 --seed 26020
"""
import argparse
import json
import random
from pathlib import Path
import numpy as np
import torch
from torch import nn

class Network(nn.Module):
    def __init__(self, quantiles=16):
        super().__init__()
        self.quantiles=quantiles
        self.net=nn.Sequential(nn.Linear(31,64),nn.ReLU(),nn.Linear(64,64),nn.ReLU(),nn.Linear(64,33*quantiles))
    def forward(self,x):
        return self.net(x).reshape(-1,33,self.quantiles)

def encode(dice,left):
    output=np.zeros(31,dtype=np.float32)
    for i,v in enumerate(sorted(dice)):
        output[i*6+v-1]=1
    output[30]=left/2
    return output

def legal_mask(left):
    mask=np.ones(33,dtype=np.bool_)
    if left==0:mask[:32]=False
    return mask

def step(dice,left,action,rng,threshold):
    if action==32 or left==0:return sorted(dice),0,True,float(sum(dice)>=threshold)
    held=[d for i,d in enumerate(sorted(dice)) if action&(1<<i)]
    next_dice=sorted(held+[rng.randrange(1,7) for _ in range(5-len(held))])
    return next_dice,left-1,False,0.0

def choose(network,dice,left,epsilon,rng,device):
    if rng.random()<epsilon:return rng.choice([i for i,ok in enumerate(legal_mask(left)) if ok])
    with torch.no_grad():
        x=torch.tensor(encode(dice,left),device=device).unsqueeze(0)
        values=network(x).mean(-1)[0].cpu().numpy()
        values[~legal_mask(left)]=-1e9
        return int(values.argmax())

def evaluate(network,episodes,seed,threshold,device):
    rng=random.Random(seed)
    wins=0
    for _ in range(episodes):
        dice=sorted([rng.randrange(1,7) for _ in range(5)]); left=2
        while True:
            action=choose(network,dice,left,0,rng,device)
            dice,left,done,reward=step(dice,left,action,rng,threshold)
            if done:
                wins+=reward
                break
    return wins/episodes

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--episodes",type=int,default=6000)
    p.add_argument("--eval",type=int,default=3000)
    p.add_argument("--seed",type=int,default=26020)
    p.add_argument("--threshold",type=int,default=25)
    args=p.parse_args()
    assert 2<=args.episodes<=100000 and 5<=args.threshold<=30
    torch.set_num_threads(2)
    torch.manual_seed(args.seed);np.random.seed(args.seed);rng=random.Random(args.seed)
    device=torch.device("cpu")
    online=Network().to(device);target=Network().to(device)
    target.load_state_dict(online.state_dict())
    optimizer=torch.optim.Adam(online.parameters(),lr=0.0004)
    replay=[]
    batch_size=96
    updates=0
    tau=torch.tensor([(i+0.5)/online.quantiles for i in range(online.quantiles)],device=device).view(1,-1,1)
    history=[]
    for episode in range(args.episodes):
        dice=sorted([rng.randrange(1,7) for _ in range(5)]);left=2
        epsilon=max(.05,.40*(1-episode/max(1,args.episodes)))
        while True:
            action=choose(online,dice,left,epsilon,rng,device)
            next_dice,next_left,done,reward=step(dice,left,action,rng,args.threshold)
            item=(encode(dice,left),action,reward,encode(next_dice,next_left),next_left,float(done))
            if len(replay)<30000:replay.append(item)
            else:replay[rng.randrange(len(replay))]=item
            dice,left=next_dice,next_left
            if len(replay)>=batch_size*2:
                rows=rng.sample(replay,batch_size)
                states=torch.tensor(np.stack([r[0] for r in rows]),device=device)
                actions=torch.tensor([r[1] for r in rows],dtype=torch.long,device=device)
                rewards=torch.tensor([r[2] for r in rows],dtype=torch.float32,device=device)
                next_states=torch.tensor(np.stack([r[3] for r in rows]),device=device)
                next_left=[r[4] for r in rows]
                dones=torch.tensor([r[5] for r in rows],dtype=torch.float32,device=device)
                prediction=online(states)[torch.arange(batch_size),actions,:]
                with torch.no_grad():
                    next_values=online(next_states).mean(-1)
                    for i,left_value in enumerate(next_left):
                        if left_value==0:next_values[i,:32]=-1e9
                    best=next_values.argmax(dim=1)
                    target_quantiles=target(next_states)[torch.arange(batch_size),best,:]
                    y=rewards[:,None]+(1-dones[:,None])*target_quantiles
                delta=y[:,None,:]-prediction[:,:,None]
                huber=torch.where(delta.abs()<=1,.5*delta.square(),delta.abs()-.5)
                loss=((tau-(delta.detach()<0).float()).abs()*huber).mean()
                optimizer.zero_grad();loss.backward()
                torch.nn.utils.clip_grad_norm_(online.parameters(),5.0)
                optimizer.step();updates+=1
                if updates%300==0:target.load_state_dict(online.state_dict())
            if done:break
        if (episode+1)%max(1000,args.episodes//5)==0:
            rate=evaluate(online,500,args.seed+900000+episode,args.threshold,device)
            history.append({"episodes":episode+1,"heldout500Rate":rate,"updates":updates})
            print(f"PROGRESS {episode+1} / {args.episodes}, heldout500={rate:.4f}",flush=True)
    result=evaluate(online,args.eval,args.seed+1900000,args.threshold,device)
    output={"scope":"5 dice, Choice only, up to three rolls, score threshold","threshold":args.threshold,"seed":args.seed,"episodes":args.episodes,"evaluationGames":args.eval,"heldoutWinRate":result,"referenceExactOptimalWinRateAt25":0.41671 if args.threshold==25 else None,"optimizer":"QR-DQN, 16 quantiles, quantile Huber, target network","history":history,"updates":updates,"notFullYachtLab":True,"modelIsNotDeployed":True}
    directory=Path("training/results");directory.mkdir(parents=True,exist_ok=True)
    (directory/"qr-dqn-choice.json").write_text(json.dumps(output,indent=2)+"\n",encoding="utf8")
    directory=Path("training/checkpoints");directory.mkdir(parents=True,exist_ok=True)
    torch.save({"model":online.state_dict(),"result":output},directory/"qr-dqn-choice.pt")
    print("QR_DQN_SUMMARY "+json.dumps({k:v for k,v in output.items() if k!="history"}),flush=True)

if __name__=="__main__":main()
