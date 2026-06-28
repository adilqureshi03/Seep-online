import http from "http";
import { spawn } from "child_process";

const PORT = 4321;
const srv = spawn("node", ["server.js"], { env: { ...process.env, PORT }, stdio: ["ignore","pipe","pipe"] });
srv.stdout.on("data", d=>process.stdout.write("[srv] "+d));
srv.stderr.on("data", d=>process.stderr.write("[srv-err] "+d));
await new Promise(r=>setTimeout(r,500));

function api(body){
  return new Promise((resolve,reject)=>{
    const data=JSON.stringify(body);
    const req=http.request({host:"127.0.0.1",port:PORT,path:"/api",method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(data)}},res=>{
      let b="";res.on("data",c=>b+=c);res.on("end",()=>resolve({status:res.statusCode,body:JSON.parse(b||"{}")}));
    });
    req.on("error",reject);req.write(data);req.end();
  });
}
function sse(code,token,onState){
  const req=http.get({host:"127.0.0.1",port:PORT,path:`/sse?code=${code}&token=${token}`},res=>{
    let buf="";res.on("data",c=>{buf+=c;let i;while((i=buf.indexOf("\n\n"))>=0){const chunk=buf.slice(0,i);buf=buf.slice(i+2);
      for(const line of chunk.split("\n")) if(line.startsWith("data: ")){ try{onState(JSON.parse(line.slice(6)));}catch(e){} }
    }});
  });
  return req;
}

const latest={}; // seat -> last state payload
function track(seat){ return (s)=>{ latest[seat]=s; }; }

// create + joins
const c = await api({type:"create",name:"Ayesha"});
const code=c.body.code; const tok=[c.body.token];
console.log("created room",code,"seat",c.body.seat);
for(const n of ["Bilal","Chen","Diya"]){ const j=await api({type:"join",code,name:n}); tok.push(j.body.token); console.log("joined",n,"seat",j.body.seat); }

// open SSE for all
for(let s=0;s<4;s++) sse(code,tok[s],track(s));
await new Promise(r=>setTimeout(r,300));
console.log("lobby players:", latest[0].room.players.map(p=>p.name+"#"+p.seat+(p.connected?"*":"")).join(", "));

// start
await api({type:"start",code,token:tok[0]});
await new Promise(r=>setTimeout(r,300));

// redaction check
for(let s=0;s<4;s++){
  const g=latest[s].game;
  const own=g.hands[s].filter(x=>x!==null).length;
  const others=[0,1,2,3].filter(x=>x!==s).map(x=>g.hands[x].filter(y=>y!==null).length);
  console.log(`seat ${s}: own visible=${own}, others visible=${others.join("/")}, turn=${g.turn}`);
}

// seat 0 makes the opening move: throw a non-power loose card
const g0=latest[0].game;
const hand0=g0.hands[0].filter(Boolean);
const power=new Set(["AS","AH","AD","AC","2S","9S","10D"]);
const opener=hand0.find(c=>!power.has(c));
console.log("seat0 opens by throwing", opener);
const mv=await api({type:"move",code,token:tok[0],move:{type:"THROW_LOOSE",card:opener}});
console.log("move result:", mv.status, JSON.stringify(mv.body));
await new Promise(r=>setTimeout(r,300));
console.log("after move: floor loose =", latest[1].game.floor.loose, "| turn =", latest[1].game.turn, "| lastMove =", latest[2].game.lastMove&&latest[2].game.lastMove.text);

// wrong-turn rejection
const bad=await api({type:"move",code,token:tok[2],move:{type:"THROW_LOOSE",card:latest[2].game.hands[2].filter(Boolean)[0]}});
console.log("out-of-turn move rejected:", bad.status, bad.body.error);

srv.kill(); process.exit(0);
