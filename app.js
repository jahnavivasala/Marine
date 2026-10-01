const $ = s => document.querySelector(s);
const fileInput = $("#fileInput"), dropzone = $("#dropzone");
const canvas = $("#sceneCanvas"), ctx = canvas.getContext("2d");
const MAX_MB = 25;
let sourceName = DEMO_DATA.sceneName, sourceLoaded = false, isDemo = true, analysed = false, busy = false, objectUrl = null;

const clock = () => { $("#clock").textContent = new Date().toLocaleTimeString("en-GB"); };
setInterval(clock, 1000); clock();

$("#chooseBtn").onclick = e => { e.stopPropagation(); fileInput.click(); };
$("#demoBtn").onclick = e => { e.stopPropagation(); loadDemo(); };
fileInput.onchange = e => { const f = e.target.files[0]; if (f) loadImage(f); fileInput.value = ""; };
dropzone.addEventListener("click", e => { if (e.target === dropzone) fileInput.click(); });
["dragenter", "dragover"].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add("drag"); }));
["dragleave", "drop"].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.remove("drag"); }));
dropzone.addEventListener("drop", e => { const f = e.dataTransfer.files[0]; if (f) loadImage(f); });

function resetAnalysis() {
  analysed = false;
  ["#detScore", "#areaScore", "#timeScore"].forEach(s => $(s).textContent = "—");
  $("#analyseBtn").innerHTML = "Run analysis <span>↗</span>";
  setStep(0);
}
function setStep(n) { document.querySelectorAll(".step").forEach((x, i) => x.classList.toggle("active", i === n)); }

async function loadImage(file) {
  if (!file.type.startsWith("image/")) { alert("Please choose an image file (JPG, PNG or WebP)."); return; }
  if (file.size > MAX_MB * 1048576) { alert(`Image is larger than ${MAX_MB} MB. Please choose a smaller file.`); return; }
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => { isDemo = false; sourceName = file.name; $("#caseMeta").textContent = `${file.name} · local source`; drawScene(img); };
  img.onerror = () => alert("Could not read this image. Try a JPG or PNG.");
  img.src = objectUrl;
  $("#hash").textContent = "Calculating…";
  try {
    if (!window.crypto || !crypto.subtle) throw 0;
    const h = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    $("#hash").textContent = [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("");
  } catch { $("#hash").textContent = "Fingerprint unavailable in this browser"; }
}

function loadDemo() {
  const img = new Image();
  img.onload = () => {
    isDemo = true; sourceName = DEMO_DATA.sceneName;
    $("#caseMeta").textContent = `${DEMO_DATA.caseId} · demonstration data`;
    $("#hash").textContent = "DEMO-SOURCE-NO-UPLOAD";
    drawScene(img);
  };
  img.src = "assets/demo-ocean.svg";
}

function drawScene(img) {
  canvas.width = 1200; canvas.height = 600;
  ctx.fillStyle = "#07141b"; ctx.fillRect(0, 0, 1200, 600);
  const w = img.naturalWidth || 1200, h = img.naturalHeight || 600;
  const k = Math.min(1200 / w, 600 / h), dw = w * k, dh = h * k;
  ctx.drawImage(img, (1200 - dw) / 2, (600 - dh) / 2, dw, dh);
  sourceLoaded = true; busy = false;
  $(".scene-placeholder").hidden = true;
  $("#sceneOverlay").hidden = false;
  $("#confidenceBadge").textContent = "READY TO ANALYSE";
  $("#caseStatus").textContent = "SOURCE LOADED";
  resetAnalysis();
}

function runAnalysis() {
  if (busy) return;
  if (!sourceLoaded) { loadDemo(); setTimeout(runAnalysis, 400); return; }
  busy = true;
  $("#analyseBtn").textContent = "Analysing…";
  $("#caseStatus").textContent = "ANALYSING";
  let i = 0;
  (function tick() {
    setStep(i);
    if (i++ < 4) return setTimeout(tick, 350);
    const d = DEMO_DATA.detection;
    analysed = true; busy = false;
    $("#caseStatus").textContent = "ANALYSIS COMPLETE";
    $("#confidenceBadge").textContent = `${d.confidence}% CONFIDENCE${isDemo ? "" : " (DEMO)"}`;
    $("#detScore").textContent = `${d.confidence}%`;
    $("#areaScore").textContent = d.area;
    $("#timeScore").textContent = d.window;
    renderVessels(); renderLedger();
    $("#analyseBtn").textContent = "Analysis complete ✓";
  })();
}
$("#analyseBtn").onclick = runAnalysis;

function renderVessels() {
  $("#vesselList").innerHTML = DEMO_DATA.vessels.map(v => `
    <div class="vessel">
      <div class="vessel-top"><div><div class="vessel-name">${v.name}</div><div class="vessel-meta">${v.type} · ${v.mmsi}</div></div><div class="score">${v.score}%</div></div>
      <div class="bar"><i style="width:${v.score}%"></i></div>
      <div class="vessel-meta">${v.detail}</div>
    </div>`).join("");
}
function renderLedger() {
  $("#ledger").innerHTML = DEMO_DATA.ledger.map(x => `<div class="ledger-row"><i></i><div><strong>${x[0]}</strong><span>${x[1]}</span></div><em>${x[2]}</em></div>`).join("");
}
renderVessels(); renderLedger();

$("#reportBtn").onclick = () => {
  if (!analysed) { alert("Run the analysis first, then generate the report."); return; }
  const d = DEMO_DATA.detection;
  const text = `MARINE SENTINEL — INVESTIGATION DOSSIER
Case: ${DEMO_DATA.caseId}
Source: ${sourceName}
Image fingerprint: ${$("#hash").textContent}
Generated: ${new Date().toISOString()}
${isDemo ? "" : "\nNOTE: results below are simulated demonstration values; no model was run on the uploaded image.\n"}
DETECTION
Confidence: ${d.confidence}%
Estimated area: ${d.area}
Source window: ${d.window}

DRIFT
Estimated source corridor generated from demonstration current data.
This is a model estimate and requires analyst verification.

VESSEL CORRELATION
${DEMO_DATA.vessels.map(v => `${v.name} — ${v.score}% consistency — ${v.detail}`).join("\n")}

GIS IMPACT
Protected zones: 02
Fishing areas: 03
Coastal segments: 04

IMPORTANT
Candidate-vessel correlation is not proof of responsibility.
This academic prototype requires human verification and authoritative data before operational use.`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  a.download = `${DEMO_DATA.caseId}-dossier.txt`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$("#printBtn").onclick = () => window.print();
