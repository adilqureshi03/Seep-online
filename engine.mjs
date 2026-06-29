const RANKS=["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
const SUITS=["S","H","D","C"];
const RED_SUITS=new Set(["H","D"]);
const POWER=new Set(["AS","AH","AD","AC","2S","9S","10D"]);
const HOUSE_VALUES=new Set([9,10,11,12,13]);

function cid(rank,suit){return rank+suit;}
function rankOf(id){return id.length===3?id.slice(0,2):id[0];}
function suitOf(id){return id[id.length-1];}
function valueOf(id){const r=rankOf(id);
  if(r==="A")return 1; if(r==="J")return 11; if(r==="Q")return 12; if(r==="K")return 13;
  return parseInt(r,10);}
function teamOf(seat){return seat%2===0?"A":"B";}    // seats 0,2 = A ; 1,3 = B
function partnerOf(seat){return (seat+2)%4;}
function isPower(id){return POWER.has(id);}

function makeDeck(){const d=[];for(const s of SUITS)for(const r of RANKS)d.push(cid(r,s));return d;}
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);
  t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};}
function shuffle(arr,rnd){const a=arr.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}

function newGame(players, seed){
  const rnd=mulberry32(seed>>>0);
  const deck=shuffle(makeDeck(),rnd);
  const hands={0:[],1:[],2:[],3:[]};
  for(let i=0;i<52;i++)hands[i%4].push(deck[i]);
  for(const k in hands)hands[k].sort((a,b)=>valueOf(a)-valueOf(b)||suitOf(a).localeCompare(suitOf(b)));
  let firstSeat=0; // opener; could be randomized
  return {
    phase:"IN_PROGRESS",
    players, seed,
    hands,
    floor:{loose:[],houses:[]},
    turn:firstSeat, turnNumber:0,
    scoring:{A:[],B:[]},
    lastCapturerTeam:null,
    lastMove:null, log:[],
    result:{status:"NONE",winner:null},
    houseSeq:1, shown9:false, shown10:false
  };
}

/* ---- helpers on state ---- */
function looseOfValue(st,v){return st.floor.loose.find(c=>valueOf(c)===v);}
function houseOfValue(st,v){return st.floor.houses.find(h=>h.value===v);}
function teamHouseOfValue(st,v,team){const h=houseOfValue(st,v);return (h&&ownsHouse(h,team))?h:null;}
function ownsHouse(h,team){return (h.owners||[]).includes(team);}
function houseSets(h){const s=h.cards.reduce((a,c)=>a+valueOf(c),0);return Math.round(s/h.value);} // complete sets of the value
function recement(h){h.cemented=houseSets(h)>=2;} // a house is locked once it holds 2+ sets of its value
function addOwner(h,team){if(!h.owners)h.owners=[];if(!h.owners.includes(team))h.owners.push(team);}
function ownersLabel(h){return (h.owners||[]).join(" & ");}
function countValueInHand(hand,v){return hand.filter(c=>valueOf(c)===v).length;}
function handHas(hand,id){return hand.includes(id);}
function handsEmpty(st){return [0,1,2,3].every(s=>st.hands[s].length===0);}

/* subset sums of loose card ids that total `target` (each used once) */
function subsetsSum(ids,target){
  const res=[]; const n=ids.length;
  for(let mask=1;mask<(1<<n);mask++){let s=0;const pick=[];
    for(let i=0;i<n;i++)if(mask&(1<<i)){s+=valueOf(ids[i]);pick.push(ids[i]);}
    if(s===target)res.push(pick);}
  return res;
}

/* Can `ids` be split into groups each summing to V? (cards are unique) */
function canPartition(ids,V){
  if(ids.length===0)return true;
  const first=ids[0], rest=ids.slice(1), need=V-valueOf(first);
  if(need<0)return false;
  if(need===0)return canPartition(rest,V);
  for(const s of subsetsSum(rest,need)){
    const remaining=rest.filter(x=>!s.includes(x));
    if(canPartition(remaining,V))return true;
  }
  return false;
}
/* Greedily take as many disjoint V-sum groups out of loose `ids` as possible */
function maximalCapture(ids,V){
  let remaining=ids.slice(); const taken=[]; let go=true;
  while(go){ go=false; const sub=subsetsSum(remaining,V)[0];
    if(sub){ taken.push(...sub); remaining=remaining.filter(x=>!sub.includes(x)); go=true; } }
  return taken;
}
/* Non-empty loose subsets S such that [card,...S] partitions into groups each summing to V.
   Covers single builds (4 on a loose 7 -> 11) and multiple builds (J on a loose J -> 11). */
function buildSubsets(loose, card, V){
  const v=valueOf(card), n=Math.min(loose.length,12), res=[], seen=new Set();
  for(let mask=1; mask<(1<<n); mask++){
    const S=[]; let s=0;
    for(let i=0;i<n;i++) if(mask&(1<<i)){ S.push(loose[i]); s+=valueOf(loose[i]); }
    const total=v+s;
    if(total%V!==0) continue;
    if(!canPartition([card,...S],V)) continue;
    const key=S.slice().sort().join(","); if(seen.has(key))continue; seen.add(key);
    res.push(S); if(res.length>=16)break;
  }
  return res;
}

/* Consolidation: after a throw/build, absorb any loose cards summing to a value of
   one of `team`'s houses into that house (auto-merge). Returns absorption events. */
function consolidate(st,team){
  const events=[]; let changed=true;
  while(changed){ changed=false;
    for(const h of st.floor.houses){
      if(!ownsHouse(h,team))continue;
      const sub=subsetsSum(st.floor.loose,h.value)[0];
      if(sub && sub.length){
        for(const id of sub){const i=st.floor.loose.indexOf(id);if(i>=0)st.floor.loose.splice(i,1);}
        h.cards.push(...sub); h.cemented=true;
        events.push({houseId:h.id,value:h.value,cards:sub.slice()});
        changed=true;
      }
    }
  }
  return events;
}

/* ----------------------------------------------------------------------------
   LEGAL MOVES for a specific held card -> array of move objects (with .label)
---------------------------------------------------------------------------- */
function legalMovesForCard(st,seat,card){
  if(st.phase!=="IN_PROGRESS"||st.turn!==seat)return [];
  if(!handHas(st.hands[seat],card))return [];
  const hand=st.hands[seat], team=teamOf(seat), v=valueOf(card), out=[];
  const others=hand.filter(c=>c!==card);
  const isShowCard=(card==="9S"||card==="10D");
  // 9♠/10♦ are locked only until shown (their house has been made once) OR the hand drops to 3 — whichever first
  const showLocked = (card==="9S" && !st.shown9 && hand.length>3) ||
                     (card==="10D" && !st.shown10 && hand.length>3);

  // ---- opening move restriction ----
  if(st.turnNumber===0){
    if(card==="9S"||card==="10D")return [];        // forbidden openers
    if(looseOfValue(st,v))return [];               // (floor empty at open anyway)
    return [{type:"THROW_LOOSE",card,label:`Throw ${pretty(card)}`}];
  }

  // ---- capture loose cards whose values SUM to this card's value (one or more cards) ----
  if(!showLocked){
    const seenG=new Set(); const groups=[];
    for(const g of subsetsSum(st.floor.loose,v).sort((a,b)=>a.length-b.length)){
      const key=g.slice().sort().join(","); if(seenG.has(key))continue; seenG.add(key); groups.push(g);
    }
    for(const g of groups.slice(0,8)){
      const label=g.length===1?`Capture loose ${pretty(g[0])}`:`Capture ${g.map(pretty).join(" + ")} (=${v})`;
      out.push({type:"CAPTURE_LOOSE",card,targets:g,label});
    }
    const all=maximalCapture(st.floor.loose,v);
    const biggest=groups.reduce((m,g)=>Math.max(m,g.length),0);
    if(all.length>biggest)
      out.push({type:"CAPTURE_LOOSE",card,targets:all,label:`Capture all ${all.length} cards (${all.map(pretty).join(" + ")})`});
  }

  // ---- capture a house of same value (allowed even if cemented) ----
  for(const h of st.floor.houses) if(h.value===v)
    out.push({type:"CAPTURE_HOUSE",card,houseId:h.id,label:`Capture House of ${h.value}`});

  if(showLocked){ // only the matching-house capture is permitted for a locked 9S/10D
    return out.filter(m=>m.type==="CAPTURE_HOUSE" && valueOf(card)===v);
  }

  // ---- throw loose / auto-absorb ----
  // RULE: once a House of value v exists, a loose v can't be thrown — stack onto it or capture it.
  const lm=looseOfValue(st,v);   // a loose card of exactly this value forces a capture (no loose throw)
  if(!lm){
    const ownHouse=teamHouseOfValue(st,v,team);
    const anyHouse=houseOfValue(st,v);
    if(ownHouse){
      // auto-absorb onto our own house UNLESS suppressed (builder's last matching card -> must capture)
      const suppress = (seat===ownHouse.builderSeat) && countValueInHand(hand,v)===1;
      if(!suppress){
        const willMerge=subsetsSum(st.floor.loose,v).length>0;
        out.push({type:"STACK_HOUSE",card,houseId:ownHouse.id,floorCards:[],auto:true,
                  label:`Stack ${pretty(card)} on the House of ${v}${willMerge?" (merges loose cards)":" (locks it)"}`});
      }
      // suppressed: no loose throw — capture the house instead (offered above)
    } else if(anyHouse){
      // opponents' House of v: capture it, or ADD ON (dual ownership) if you keep another v to capture
      if(countValueInHand(hand,v)>=2)
        out.push({type:"STACK_HOUSE",card,houseId:anyHouse.id,floorCards:[],
                  label:`Add ${pretty(card)} onto the House of ${v} (shared, locks it)`});
    } else {
      // would throwing this complete a combo summing to one of our houses? (auto-absorb)
      let absorb=null;
      for(const h of st.floor.houses){
        if(!ownsHouse(h,team))continue;
        const sub=subsetsSum(st.floor.loose, h.value - v)[0];
        if(h.value-v>0 && sub && sub.length){ absorb={value:h.value}; break; }
      }
      out.push({type:"THROW_LOOSE",card,
        label: absorb?`Throw ${pretty(card)} → absorbs into House of ${absorb.value}`:`Throw ${pretty(card)} loose`});
    }
  }

  // ---- builds & stacks: played card + loose cards partitioning into groups of V ----
  for(const V of HOUSE_VALUES){
    const subs=buildSubsets(st.floor.loose, card, V);
    if(!subs.length)continue;
    const existing=houseOfValue(st,V);
    for(const S of subs){
      const groups=Math.round((v+S.reduce((a,c)=>a+valueOf(c),0))/V);
      if(existing){
        const mine=ownsHouse(existing,team);
        const canAdd = mine || countValueInHand(others,V)>=1; // adding to opponents' needs a reserve V
        if(canAdd)
          out.push({type:"STACK_HOUSE",card,houseId:existing.id,floorCards:S,
                    label:`Stack onto House of ${V}${mine?" (locks it)":" (shared, locks it)"}`});
      } else {
        // brand-new house. 9/10 have a one-time SHOW gate (only the 9♠/10♦ holder, no loose 9/10)
        let reserveOk, showing=false;
        if(V===9){
          if(!st.shown9){ if(looseOfValue(st,9))continue; reserveOk=others.includes("9S"); showing=true; }
          else reserveOk=others.some(c=>valueOf(c)===9);
        } else if(V===10){
          if(!st.shown10){ if(looseOfValue(st,10))continue; reserveOk=others.includes("10D"); showing=true; }
          else reserveOk=others.some(c=>valueOf(c)===10);
        } else reserveOk=others.some(c=>valueOf(c)===V);
        if(!reserveOk)continue;
        const lbl=(showing&&V===9?"Show 9♠ — ":showing&&V===10?"Show 10♦ — ":"")+`Build House of ${V}`+(groups>1?` (×${groups})`:"");
        out.push({type:"BUILD_HOUSE",card,floorCards:S,value:V,label:lbl});
      }
    }
  }

  // ---- break a house your team does NOT own, up to a higher value ----
  for(const h of st.floor.houses){
    if(ownsHouse(h,team))continue;        // never break a house your team owns (incl. shared)
    if(h.cemented||h.value===13)continue; // locked / max
    for(const nv of HOUSE_VALUES){
      if(nv<=h.value)continue;
      const need=nv-h.value-v;            // value added by played card + loose combo
      if(need<0)continue;
      const combos = need===0 ? [[]] : subsetsSum(st.floor.loose,need);
      for(const combo of combos){
        if(need>0&&combo.length===0)continue;
        const existing = st.floor.houses.find(x=>x.value===nv && x.id!==h.id);
        const teamHasNv = existing && ownsHouse(existing,team);       // merge w/o reserve
        const hasReserve = others.some(c=>valueOf(c)===nv) ||
                           (nv===9&&others.includes("9S")) || (nv===10&&others.includes("10D"));
        if(!hasReserve && !teamHasNv)continue;                       // need the value in hand, or a team house
        out.push({type:"BREAK_HOUSE",card,houseId:h.id,floorCards:combo,newValue:nv,
          label:`Break House of ${h.value} → ${nv}`+(existing?" (merge)":"")});
      }
    }
  }

  // de-dupe identical labels (different combos producing same effect summary)
  const seen=new Set(); return out.filter(m=>{const k=m.type+"|"+m.label;if(seen.has(k))return false;seen.add(k);return true;});
}

/* ----------------------------------------------------------------------------
   APPLY MOVE  -> {ok, state, error}
---------------------------------------------------------------------------- */
function applyMove(state,seat,move){
  if(state.phase!=="IN_PROGRESS")return err("Game is not in progress");
  if(state.turn!==seat)return err("Not your turn");
  const st=structuredClone(state);
  const hand=st.hands[seat], team=teamOf(seat), card=move.card;
  if(!handHas(hand,card))return err("You don't hold that card");
  const v=valueOf(card);
  let captured=false, desc="", fx=null;

  const removeFromHand=()=>{hand.splice(hand.indexOf(card),1);};
  const removeLoose=ids=>{for(const id of ids){const i=st.floor.loose.indexOf(id);if(i<0)return false;st.floor.loose.splice(i,1);}return true;};

  switch(move.type){
    case "THROW_LOOSE":{
      if(st.turnNumber===0&&(card==="9S"||card==="10D"))return err("Cannot open with a power 9♠/10♦");
      if(card==="9S" && !st.shown9 && hand.length>3)return err("9♠ must be shown via its house first");
      if(card==="10D" && !st.shown10 && hand.length>3)return err("10♦ must be shown via its house first");
      if(looseOfValue(st,v))return err("A loose card of that value exists — you must capture it");
      if(houseOfValue(st,v))return err(`A House of ${v} is out — stack onto it or capture it`);
      removeFromHand(); st.floor.loose.push(card);
      { const events=consolidate(st,team);
        const ev=events.find(e=>e.cards.includes(card));
        if(ev){
          desc=`${name(st,seat)} threw ${pretty(card)} — absorbed into the House of ${ev.value}`;
          fx={kind:"stack",withIds:ev.cards.filter(c=>c!==card),value:ev.value,houseId:ev.houseId};
        } else {
          desc=`${name(st,seat)} threw ${pretty(card)}`;
          fx={kind:"throw"};
        } }
      break;}

    case "CAPTURE_LOOSE":{
      const targets = (move.targets && move.targets.length) ? move.targets : (move.target?[move.target]:[]);
      if(!targets.length)return err("Nothing to capture");
      if(card==="9S" && !st.shown9 && hand.length>3)return err("9♠ is locked until it's shown or you hold 3 cards");
      if(card==="10D" && !st.shown10 && hand.length>3)return err("10♦ is locked until it's shown or you hold 3 cards");
      for(const id of targets) if(!st.floor.loose.includes(id))return err("Those cards aren't on the floor");
      const total=targets.reduce((a,c)=>a+valueOf(c),0);
      if(total===0 || total%v!==0)return err(`Captured cards must total a multiple of ${v}`);
      if(!canPartition(targets,v))return err(`Captured cards must group into sums of ${v}`);
      removeFromHand(); removeLoose(targets);
      st.scoring[team].push(card,...targets); captured=true;
      desc=`${name(st,seat)} captured ${targets.map(pretty).join(" + ")} with ${pretty(card)}`;
      fx={kind:"capture",withIds:targets.slice()};
      break;}

    case "CAPTURE_HOUSE":{
      const h=st.floor.houses.find(x=>x.id===move.houseId); if(!h)return err("House not found");
      if(h.value!==v)return err("Card value doesn't match the house");
      const houseCards=h.cards.slice();
      removeFromHand();
      st.scoring[team].push(card,...h.cards);
      st.floor.houses=st.floor.houses.filter(x=>x.id!==h.id);
      captured=true;
      desc=`${name(st,seat)} captured the House of ${h.value} with ${pretty(card)}`;
      fx={kind:"capture",withIds:houseCards};
      break;}

    case "BUILD_HOUSE":{
      const V=move.value; if(!HOUSE_VALUES.has(V))return err("Illegal house value");
      if(houseOfValue(st,V))return err("A house of that value already exists");
      const combo=move.floorCards||[];
      if(combo.length===0)return err("A house needs at least one floor card");
      { const total=v+combo.reduce((a,c)=>a+valueOf(c),0);
        if(total===0||total%V!==0||!canPartition([card,...combo],V))return err(`Cards must group into sums of ${V}`); }
      const others=hand.filter(c=>c!==card);
      let reserveOk, showing=false;
      if(V===9){
        if(!st.shown9){
          if(looseOfValue(st,9))return err("Can't show the House of 9 while a loose 9 is on the floor");
          reserveOk=others.includes("9S"); showing=true;
          if(!reserveOk)return err("The first House of 9 must be shown by the 9♠ holder");
        } else { reserveOk=others.some(c=>valueOf(c)===9); if(!reserveOk)return err("You must hold a 9 to build the House of 9"); }
      } else if(V===10){
        if(!st.shown10){
          if(looseOfValue(st,10))return err("Can't show the House of 10 while a loose 10 is on the floor");
          reserveOk=others.includes("10D"); showing=true;
          if(!reserveOk)return err("The first House of 10 must be shown by the 10♦ holder");
        } else { reserveOk=others.some(c=>valueOf(c)===10); if(!reserveOk)return err("You must hold a 10 to build the House of 10"); }
      } else { reserveOk=others.some(c=>valueOf(c)===V); if(!reserveOk)return err("You must hold the house value to build"); }
      if(!removeLoose(combo))return err("Floor cards unavailable");
      removeFromHand();
      const newId="H"+(st.houseSeq++);
      st.floor.houses.push({id:newId,value:V,cards:[card,...combo],
        owners:[team],builderSeat:seat,cemented:false});
      if(V===9)st.shown9=true; if(V===10)st.shown10=true;
      const show=showing?` and showed ${V===9?"9♠":"10♦"}`:"";
      const absorbed=consolidate(st,team).flatMap(e=>e.cards);
      desc=`${name(st,seat)} built a House of ${V}${show}`
            +(absorbed.length?` (absorbed ${absorbed.map(pretty).join(" ")})`:"");
      fx={kind:"build",withIds:[...combo,...absorbed],value:V,houseId:newId};
      break;}

    case "STACK_HOUSE":{
      const h=st.floor.houses.find(x=>x.id===move.houseId); if(!h)return err("House not found");
      const combo=move.floorCards||[];
      { const total=v+combo.reduce((a,c)=>a+valueOf(c),0);
        if(total===0||total%h.value!==0||!canPartition([card,...combo],h.value))return err(`Stack must group into sums of ${h.value}`); }
      const mine=ownsHouse(h,team);
      if(!mine){
        // adding on to an opponents' house — must keep a reserve of the value to capture later
        const needReserve = valueOf(card)===h.value ? 2 : 1;
        if(countValueInHand(hand,h.value) < needReserve)
          return err(`You need another ${h.value} in hand to add to that house`);
      } else if(seat===h.builderSeat && combo.length===0 && v===h.value && countValueInHand(hand,h.value)===1){
        return err("Keep your last matching card to capture this house");
      }
      if(!removeLoose(combo))return err("Floor cards unavailable");
      removeFromHand(); h.cards.push(card,...combo); h.cemented=true;
      addOwner(h,team);                       // contributing team becomes a (co-)owner
      let merged=0; const mergedIds=[];
      { let sub; while((sub=subsetsSum(st.floor.loose,h.value)[0])){ removeLoose(sub); h.cards.push(...sub); mergedIds.push(...sub); merged+=sub.length; } }
      desc=`${name(st,seat)} ${mine?"stacked":"added to"} the House of ${h.value} — now locked`
            +(merged?` (merged ${merged} loose card${merged>1?"s":""})`:"");
      fx={kind:"stack",withIds:[...combo,...mergedIds],value:h.value,houseId:h.id};
      break;}

    case "BREAK_HOUSE":{
      const h=st.floor.houses.find(x=>x.id===move.houseId); if(!h)return err("House not found");
      if(ownsHouse(h,team))return err("You cannot break a house your team owns");
      if(h.cemented)return err("That house is locked and cannot be broken");
      if(h.value===13)return err("A House of 13 cannot be broken");
      const nv=move.newValue, combo=move.floorCards||[];
      if(nv<=h.value||!HOUSE_VALUES.has(nv))return err("Illegal new value");
      if(v+combo.reduce((a,c)=>a+valueOf(c),0)!==nv-h.value)return err("Cards don't raise to the new value");
      const others=hand.filter(c=>c!==card);
      const existing=st.floor.houses.find(x=>x.value===nv && x.id!==h.id);
      const teamHasNv=existing && ownsHouse(existing,team);
      const hasReserve=others.some(c=>valueOf(c)===nv)||(nv===9&&others.includes("9S"))||(nv===10&&others.includes("10D"));
      if(!hasReserve&&!teamHasNv)return err("You need the new value in hand (or a partner house to merge)");
      if(!removeLoose(combo))return err("Floor cards unavailable");
      removeFromHand();
      if(existing){
        // merge the broken house into the existing house of nv (one house per value)
        existing.cards.push(card,...combo,...h.cards);
        addOwner(existing,team);             // breaker's team now co-owns the merged house
        st.floor.houses=st.floor.houses.filter(x=>x.id!==h.id);
        desc=`${name(st,seat)} broke the House of ${h.value} into ${nv} (merged)`;
        fx={kind:"break",withIds:combo.slice(),value:nv,houseId:existing.id};
      } else {
        h.value=nv; h.cards.push(card,...combo); h.owners=[team]; h.builderSeat=seat;
        desc=`${name(st,seat)} broke a house up to ${nv}`;
        fx={kind:"break",withIds:combo.slice(),value:nv,houseId:h.id};
      }
      { // absorb any loose cards that now sum to a value of this team's houses (e.g. a loose K into the new 13)
        const absorbed=consolidate(st,team).flatMap(e=>e.cards);
        if(absorbed.length){
          desc+=` (absorbed ${absorbed.map(pretty).join(" ")})`;
          fx.withIds=[...(fx.withIds||[]),...absorbed];
        }
      }
      break;}

    default: return err("Unknown move");
  }

  if(captured)st.lastCapturerTeam=team;
  // safety net: enforce one house per value (collapse accidental duplicates)
  { const seenV={};
    for(const hh of st.floor.houses){
      if(seenV[hh.value]){ const keep=seenV[hh.value]; keep.cards.push(...hh.cards); keep.cemented=keep.cemented||hh.cemented; keep.owners=Array.from(new Set([...(keep.owners||[]),...(hh.owners||[])])); hh._dup=true; }
      else seenV[hh.value]=hh;
    }
    st.floor.houses=st.floor.houses.filter(hh=>!hh._dup);
  }
  for(const hh of st.floor.houses) recement(hh); // lock any house that now holds 2+ sets of its value
  st.lastMove=Object.assign({seat,text:desc,card},fx||{});
  st.moveSeq=(st.moveSeq||0)+1;
  st.log.unshift(desc);
  if(st.log.length>40)st.log.pop();

  evaluate(st);
  if(st.result.status==="NONE"){ st.turnNumber++; st.turn=(seat+1)%4; }
  return {ok:true,state:st};
}
function err(m){return {ok:false,error:m};}

/* ----------------------------------------------------------------------------
   EVALUATE result (instant draw / win / end-of-hand sweep)
---------------------------------------------------------------------------- */
function powerHeld(st){
  const h={A:[],B:[]};
  for(const t of ["A","B"])h[t]=st.scoring[t].filter(isPower);
  return h;
}
function evaluate(st){
  let h=powerHeld(st);
  if(h.A.length===7){st.result={status:"WIN",winner:"A"};return;}
  if(h.B.length===7){st.result={status:"WIN",winner:"B"};return;}
  if(h.A.length>=1&&h.B.length>=1){st.result={status:"DRAW",winner:null};return;}
  if(handsEmpty(st)){
    // final sweep: leftover loose + any uncaptured houses go to last team that captured
    const t=st.lastCapturerTeam;
    if(t){
      st.scoring[t].push(...st.floor.loose);
      for(const ho of st.floor.houses)st.scoring[t].push(...ho.cards);
      st.floor.loose=[]; st.floor.houses=[];
    }
    h=powerHeld(st);
    if(h.A.length===7)st.result={status:"WIN",winner:"A"};
    else if(h.B.length===7)st.result={status:"WIN",winner:"B"};
    else if(h.A.length>=1&&h.B.length>=1)st.result={status:"DRAW",winner:null};
    else if(h.A.length!==h.B.length)st.result={status:"WIN",winner:h.A.length>h.B.length?"A":"B"};
    else st.result={status:"DRAW",winner:null};
    return;
  }
  st.result={status:"NONE",winner:null};
}

/* pretty names */
function pretty(id){const r=rankOf(id),s=suitOf(id);const sym={S:"♠",H:"♥",D:"♦",C:"♣"}[s];return r+sym;}
function name(st,seat){return st.players[seat]?.name||("Player "+(seat+1));}


export {newGame,applyMove,evaluate,legalMovesForCard,valueOf,teamOf,partnerOf,powerHeld,pretty,POWER,cid};
