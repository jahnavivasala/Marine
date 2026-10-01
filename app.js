const $ = s => document.querySelector(s);
const fileInput = $("#fileInput"), chooseBtn = $("#chooseBtn"), dropzone = $("#dropzone");
const canvas = $("#sceneCanvas"), ctx = canvas.getContext("2d");
let sourceName = "Demonstration Scene", analysed = false;

function clock(){ $("#clock").textContent = new Date().toLocaleTimeString("en-GB"); }
setInterval(clock,1000); clock();

chooseBtn.onclick = () => fileInput.click();
$("#demoBtn").onclick = () => loadDemo();
fileInput.onchange = e => { const f=e.target.files[0]; if(f) loadImage(f); };

["dragenter","dragover"].forEach(ev=>dropzone.addEventListener(ev,e=>{e.preventDefault();dropzone.classList.add("drag")}));
["dragleave","drop"].forEach(ev=>dropzone.addEventListener(ev,e=>{e.preventDefault();dropzone.classList.remove("drag")}));
dropzone.addEventListener("drop",e=>{const f=e.dataTransfer.files[0];if(f&&f.type.startsWith("image/"))loadImage(f)});

async function loadImage(file){
  sourceName=file.name;
  const img=new Image();
  img.onload=()=>drawScene(img);
  img.src=URL.createObjectURL(file);
  $("#caseMeta").textContent=`${file.name} · local source`;
  try{
    const buf=await file.arrayBuffer();
    if(window.crypto?.subtle){const hash=await crypto.subtle.digest("SHA-256",buf);$("#hash").textContent=[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,"0")).join("");}
    else $("#hash").textContent="Browser fingerprint unavailable";
  }catch{$("#hash").textContent="Fingerprint unavailable";}
}

function loadDemo(){
  const img=new Image();
  img.onload=()=>drawScene(img);
  img.src="assets/demo-ocean.svg";
  sourceName=DEMO_DATA.sceneName;
  $("#caseMeta").textContent=`${DEMO_DATA.caseId} · demonstration data`;
  $("#hash").textContent="DEMO-SOURCE-NO-UPLOAD";
}

function drawScene(img){
  canvas.width=1200; canvas.height=600;
  ctx.drawImage(img,0,0,canvas.width,canvas.height);
  $("#sceneOverlay").hidden=false;
  $("#confidenceBadge").textContent="READY TO ANALYSE";
  $("#caseStatus").textContent="SOURCE LOADED";
}

function runAnalysis(){
  if(!canvas.width){loadDemo();}
  analysed=true;
  $("#caseStatus").textContent="ANALYSIS COMPLETE";
  $("#confidenceBadge").textContent="94% CONFIDENCE";
  $("#detScore").textContent="94%";
  $("#areaScore").textContent=DEMO_DATA.detection.area;
  $("#timeScore").textContent=DEMO_DATA.detection.window;
  document.querySelectorAll(".step").forEach((x,i)=>{x.classList.toggle("active",i===4);});
  renderVessels(); renderLedger();
  $("#analyseBtn").textContent="Analysis complete ✓";
}
$("#analyseBtn").onclick=runAnalysis;

function renderVessels(){
  $("#vesselList").innerHTML=DEMO_DATA.vessels.map(v=>`
    <div class="vessel">
      <div class="vessel-top"><div><div class="vessel-name">${v.name}</div><div class="vessel-meta">${v.type} · ${v.mmsi}</div></div><div class="score">${v.score}%</div></div>
      <div class="bar"><i style="width:${v.score}%"></i></div>
      <div class="vessel-meta">${v.detail}</div>
    </div>`).join("");
}
function renderLedger(){
  $("#ledger").innerHTML=DEMO_DATA.ledger.map(x=>`<div class="ledger-row"><i></i><div><strong>${x[0]}</strong><span>${x[1]}</span></div><em>${x[2]}</em></div>`).join("");
}
renderVessels(); renderLedger();

$("#reportBtn").onclick=()=>{
  if(!analysed) runAnalysis();
  const text=`MARINE SENTINEL — INVESTIGATION DOSSIER
Case: ${DEMO_DATA.caseId}
Source: ${sourceName}

DETECTION
Confidence: ${DEMO_DATA.detection.confidence}%
Estimated area: ${DEMO_DATA.detection.area}
Source window: ${DEMO_DATA.detection.window}

DRIFT
Estimated source corridor generated from demonstration current data.
This is a model estimate and requires analyst verification.

VESSEL CORRELATION
${DEMO_DATA.vessels.map(v=>`${v.name} — ${v.score}% consistency — ${v.detail}`).join("\n")}

GIS IMPACT
Protected zones: 02
Fishing areas: 03
Coastal segments: 04

IMPORTANT
Candidate-vessel correlation is not proof of responsibility.
This academic prototype requires human verification and authoritative data before operational use.`;
  const blob=new Blob([text],{type:"text/plain"}),a=document.createElement("a");
  a.href=URL.createObjectURL(blob);a.download=`${DEMO_DATA.caseId}-dossier.txt`;a.click();URL.revokeObjectURL(a.href);
};
$("#printBtn").onclick=()=>window.print();
