"""Inference bridge for a real trained YahtzeeRL 13-box checkpoint under a 12-box zero-shot transfer.
Upstream original model code is imported UNMODIFIED from a pinned upstream checkout.
We transform the 12-box public YachtLab state into its expected 13-box input by
marking Three-of-a-Kind as previously scored 0 in BOTH players' scorecards.
Scoring is exclusively carried out by YachtLab, NOT upstream 13-box environment.
This is NOT a native-rule game, retrained model, or legitimate 12-box SOTA proof.
"""
from __future__ import annotations
import argparse
import json
import sys

import jax
import jax.numpy as jnp
import numpy as np
from yahtzee_rl.env import EnvState, legal_action_mask, observation
from yahtzee_rl.evaluate import load_policy

INDEX = {"aces":0,"deuces":1,"threes":2,"fours":3,"fives":4,"sixes":5,"four":7,"full":8,"small":9,"large":10,"yacht":11,"choice":12}
CAT = {v:k for k,v in INDEX.items()}

def cards13(cards):
    values=[-1]*13
    values[6]=0
    for cat,value in cards.items():
        if cat not in INDEX:raise ValueError(f"Invalid YachtLab category {cat}")
        if not isinstance(value,int) or value<0:raise ValueError("Invalid score")
        values[INDEX[cat]]=value
    return values

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--checkpoint",required=True)
    args=parser.parse_args()
    policy=load_policy("greedy",args.checkpoint,0)
    if policy.step != 11800:raise RuntimeError(f"Refusing unverified checkpoint step {policy.step}")
    @jax.jit
    def infer(sc, dice, rolls_left, current):
        st=EnvState(scorecards=sc[None,:,:],dice=dice[None,:],rolls_left=jnp.array([rolls_left],dtype=jnp.int32),active_player=jnp.array([current],dtype=jnp.int32),done=jnp.array([False]))
        logits,_=policy.model.apply({"params":policy.params},observation(st))
        logits=jnp.where(legal_action_mask(st),logits,-1e9)
        return jnp.argmax(logits[0]).astype(jnp.int32)
    fake=jnp.array([[0]*13,[0]*13],dtype=jnp.int32)
    infer(fake,jnp.array([1,2,3,4,5],dtype=jnp.int32),jnp.int32(2),jnp.int32(0)).block_until_ready()
    print("READY:"+json.dumps({"model":"YahtzeeRL original pretrained competitive policy head","checkpoint_step":policy.step,"game_adapter":"13-cat network/12-cat YachtLab environment; ThreeKind marked filled 0; out-of-distribution zero-shot transfer","checkpoint":args.checkpoint}),flush=True)
    for line in sys.stdin:
        if not line.strip():continue
        try:
            req=json.loads(line)
            if not isinstance(req.get("cards"),list) or len(req["cards"])!=2:raise ValueError("Must provide both publicly visible scorecards")
            current=int(req["player"]); rolls=int(req["rolls"]);dice=req["dice"]
            if current not in [0,1] or rolls not in [1,2,3] or len(dice)!=5 or not all(isinstance(v,int) and 1<=v<=6 for v in dice):raise ValueError("Invalid public state")
            card_array=jnp.array([cards13(x) for x in req["cards"]],dtype=jnp.int32)
            order=sorted(range(5),key=lambda i:(dice[i],i)); sorted_dice=jnp.array([dice[i] for i in order],dtype=jnp.int32)
            action=int(infer(card_array,sorted_dice,jnp.int32(3-rolls),jnp.int32(current)))
            if action<32:
                if rolls>=3:raise ValueError("Source policy attempted illegal reroll")
                ids=[order[i] for i in range(5) if action&(1<<i)]
                result={"type":"reroll","ids":ids,"source_action":action}
            else:
                external_category=action-32
                if external_category==6 or external_category not in CAT:raise ValueError("Source selected missing 3-of-kind category")
                result={"type":"score","category":CAT[external_category],"source_action":action}
            print(json.dumps(result,separators=(",",":")),flush=True)
        except Exception as exc:
            print(json.dumps({"error":str(exc)},separators=(",",":")),flush=True)
if __name__=="__main__":main()
