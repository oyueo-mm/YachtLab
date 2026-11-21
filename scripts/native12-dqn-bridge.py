"""Execute original pretrained Korean 12-category Yacht DQN as an external opponent.
Original trained weights/architecture/training source: https://github.com/The7Even/Yacht_AI
Pinned upstream git: 984ba6644644700a9f3465f84f3a39b8b447947b
DO NOT treat this source's different five-of-a-kind/full-house eligibility as exact
YachtLab rules: YachtLab applies its authoritative scoring at all times.
The model was trained to pick category after two scripted rerolls, NOT to choose
among the rerolls. The original scripted smart_reroll_turn is followed below on
each publicly visible dice state. No retraining is performed.
"""
import argparse
import collections
import hashlib
import json
import sys
import torch

CATS=("aces","deuces","threes","fours","fives","sixes","choice","four","full","small","large","yacht")

class YachtDQN(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.net=torch.nn.Sequential(torch.nn.Linear(30,256),torch.nn.ReLU(),torch.nn.Linear(256,256),torch.nn.ReLU(),torch.nn.Linear(256,128),torch.nn.ReLU(),torch.nn.Linear(128,12))
    def forward(self,x):
        return self.net(x)

def smart_holds(dice,used,upper):
    """Derived directly from AILearning.py::smart_reroll_turn, without its RNG."""
    counts=collections.Counter(dice);most_num,most_cnt=counts.most_common(1)[0];uniq=sorted(set(dice))
    if not used[11] and most_cnt>=3:
        return [i for i,v in enumerate(dice) if v==most_num]
    if upper<63:
        min_req=1 if upper>=48 else 2
        opts=[face for face in [6,5,4,3,2,1] if not used[face-1] and counts.get(face,0)>=min_req]
        if opts:
            return [i for i,v in enumerate(dice) if v==opts[0]]
    if not used[10] or not used[9]:
        possible=[set(s) for s in [(1,2,3,4),(2,3,4,5),(3,4,5,6)]]
        matched=[s for s in possible if len(s.intersection(uniq))>=4]
        if matched:
            pool=matched[0].intersection(uniq)
            return [i for i,v in enumerate(dice) if v in pool]
    if not used[8] and sorted(counts.values())==[1,2,2]:
        return [i for i,v in enumerate(dice) if counts[v]==2]
    return [i for i,v in enumerate(dice) if v==most_num]

def infer(model,req):
    cards=req["cards"];player=req["player"];rolls=req["rolls"];dice=req["dice"]
    if player not in (0,1) or rolls not in (1,2,3) or len(cards)!=2 or len(dice)!=5 or any(type(v)!=int or not 1<=v<=6 for v in dice):
        raise ValueError("Invalid publicly observable YachtLab game state")
    card=cards[player];unrecognized=set(card)-set(CATS)
    if unrecognized:raise ValueError("Unknown score categories")
    used=[c in card for c in CATS];scores=[card.get(c,0) for c in CATS]
    if any(type(v)!=int or v<0 for v in scores):raise ValueError("Invalid visible score")
    upper=sum(scores[:6])
    if rolls<3:
        return {"type":"reroll","ids":smart_holds(dice,used,upper),"method":"original scripted smart_reroll_turn; DQN not used for rerolls"}
    inp=[v/6.0 for v in sorted(dice)]+[float(x) for x in used]+[s/50.0 for s in scores]+[min(1.0,upper/63.0)]
    if len(inp)!=30:raise ValueError("Bad model feature count")
    with torch.inference_mode():
        q=model(torch.tensor(inp,dtype=torch.float32).reshape(1,30))[0].tolist()
    for i,filled in enumerate(used):
        if filled:q[i]=-1e9
    idx=max(range(12),key=lambda i:q[i])
    return {"type":"score","category":CATS[idx],"model_q":q[idx],"method":"REAL original 40k-episode pretrained DQN category head"}

def main():
    p=argparse.ArgumentParser();p.add_argument("--weights",required=True);args=p.parse_args()
    torch.set_num_threads(1)
    raw=open(args.weights,"rb").read();digest=hashlib.sha256(raw).hexdigest()
    model=YachtDQN().cpu()
    state=torch.load(args.weights,map_location="cpu",weights_only=True)
    model.load_state_dict(state,strict=True)
    model.eval()
    print("READY:"+json.dumps({"source":"The7Even/Yacht_AI","source_commit":"984ba6644644700a9f3465f84f3a39b8b447947b","weights_sha256":digest,"weights_bytes":len(raw),"trained":"12-category Yacht DQN, 40000-game scripted reroll and DQN category-selection pipeline","architecture":"30-256-256-128-12","known_rule_mismatch":"upstream considers 5-kind a full house; YachtLab does not"}),flush=True)
    for raw_line in sys.stdin:
        if not raw_line.strip():continue
        try:
            result=infer(model,json.loads(raw_line))
            print(json.dumps(result,separators=(",",":")),flush=True)
        except Exception as e:
            print(json.dumps({"error":str(e)},separators=(",",":")),flush=True)
if __name__=="__main__":main()
