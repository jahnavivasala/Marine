const $ = s => document.querySelector(s);
const fileInput = $("#fileInput"), dropzone = $("#dropzone");
const canvas = $("#sceneCanvas"), ctx = canvas.getContext("2d");
const MAX_MB = 25;
let customAIS = null, base = null, R = null, sourceName = DEMO_DATA.sceneName, sourceLoaded = false, isDemo = true, analysed = false, busy = false, objectUrl = null;

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
  sourceLoaded = true; busy = false; base = ctx.getImageData(0, 0, 1200, 600);
  $(".scene-placeholder").hidden = true;
  $("#sceneOverlay").hidden = false;
  $("#confidenceBadge").textContent = "READY TO ANALYSE";
  $("#caseStatus").textContent = "SOURCE LOADED";
  resetAnalysis();
}


const P = () => { const o = {}; document.querySelectorAll("[data-p]").forEach(i => o[i.dataset.p] = parseFloat(i.value)); return o; };
$("#acq").onchange = () => { if (analysed) compute(); };
document.querySelectorAll("[data-p]").forEach(i => { i.value = DEMO_DATA.params[i.dataset.p]; i.onchange = () => { if (analysed) compute(); }; });

function compute() {
  ctx.putImageData(base, 0, 0);
  const p = P(), d = Engine.detect(canvas, p.sens);
  if (d && d.invalid) { R = null; $("#caseStatus").textContent = "UNSUITABLE IMAGE"; $("#confidenceBadge").textContent = "NOT A SEA SCENE"; $("#vesselList").innerHTML = `<div class="vessel-meta" style="padding:14px 0">${d.invalid}</div>`; renderLedger(); return; }
  if (!d) { R = null; $("#caseStatus").textContent = "NO SLICK DETECTED"; $("#confidenceBadge").textContent = "NO ANOMALY"; ["#detScore", "#areaScore"].forEach(s => $(s).textContent = "—"); $("#vesselList").innerHTML = '<div class="vessel-meta" style="padding:14px 0">No dark-patch anomaly above threshold. Try a SAR or high-contrast scene.</div>'; renderLedger(); return; }
  const dr = Engine.drift(d, p), ves = Engine.correlate(customAIS ? Engine.toTracks(customAIS, { lat: p.lat, lon: p.lon, res: p.res, acq: Date.parse($("#acq").value) || Date.now() }, d) : DEMO_DATA.vessels, dr, p, d), ex = Engine.exposure(DEMO_DATA.zones, dr, d, p);
  const km2 = d.px * p.res * p.res / 1e6, rel = new Date((Date.parse($("#acq").value) || Date.now()) - p.age * 36e5);
  R = { d, dr, ves, ex, p, km2, rel };
  ctx.fillStyle = "rgba(255,123,114,.38)"; d.cells.forEach(([x, y]) => ctx.fillRect(x * 4, y * 4, 4, 4));
  ctx.strokeStyle = "#6ee7e0"; ctx.lineWidth = 3; ctx.setLineDash([12, 9]); ctx.beginPath(); ctx.moveTo(dr.origin.x, dr.origin.y); ctx.lineTo(d.cx, d.cy); ctx.stroke(); ctx.setLineDash([]);
  ctx.strokeStyle = "#f0c674"; ctx.beginPath(); ctx.arc(dr.origin.x, dr.origin.y, dr.sigmaPx, 0, 7); ctx.stroke();
  ctx.strokeStyle = "rgba(240,198,116,.5)"; ctx.beginPath(); ctx.moveTo(d.cx, d.cy); const f = dr.fc(12); ctx.lineTo(f.x, f.y); ctx.stroke();
  $("#confidenceBadge").textContent = `${d.conf}% CONFIDENCE · ${d.cls.toUpperCase()}`;
  $("#detScore").textContent = `${d.conf}%`; $("#areaScore").textContent = km2.toFixed(1) + " km²";
  $("#timeScore").textContent = `${new Date(rel - 72e5).toISOString().slice(11, 16)}–${new Date(+rel + 72e5).toISOString().slice(11, 16)} UTC`;
  $("#sceneOverlay .tag").textContent = d.cls.toUpperCase();
  const mx = x => (x / d.W * 700).toFixed(1), my = y => (y / d.H * 330).toFixed(1), o = dr.origin;
  $(".route").setAttribute("d", `M${mx(d.cx)} ${my(d.cy)} L${mx(o.x)} ${my(o.y)}`);
  $(".origin").setAttribute("cx", mx(o.x)); $(".origin").setAttribute("cy", my(o.y)); $(".spill").setAttribute("cx", mx(d.cx)); $(".spill").setAttribute("cy", my(d.cy));
  document.querySelectorAll(".arrow").forEach(a => a.remove());
  $("#dyn").innerHTML = `<circle cx="${mx(o.x)}" cy="${my(o.y)}" r="${(dr.sigmaPx / d.W * 700).toFixed(1)}" fill="#f0c67422" stroke="#f0c674" stroke-dasharray="3 4"/>` + ves.map((v, i) => `<polyline fill="none" stroke="${i ? "#80bfff" : "#f0c674"}" stroke-opacity=".7" stroke-width="1.5" points="${v.track.map(t => `${(t[1] * 700).toFixed(0)},${(t[2] * 330).toFixed(0)}`).join(" ")}"/><text x="${(v.track[0][1] * 700).toFixed(0)}" y="${(v.track[0][2] * 330 - 5).toFixed(0)}">${v.name}</text>`).join("");
  $("#driftNote").textContent = `Drift ${(dr.speed * 1.944).toFixed(2)} kn (current + 3% windage) over ${p.age} h. Origin uncertainty ±${(dr.sigmaPx * p.res / 1000).toFixed(1)} km. Model estimate: an investigative lead, not a measured source.`;
  $("#candidateCount").textContent = ves.filter(v => v.score >= 25).length;
  renderVessels(); renderLedger();
  const cnt = t => { const z = ex.filter(e => e.type === t); return `${z.filter(e => e.hit).length}/${z.length}`; };
  ["protected", "fishing"].forEach(t => $(".zone." + t).classList.toggle("hit", ex.some(e => e.type === t && e.hit)));
  const st = document.querySelectorAll(".impact-stats strong"); st[0].textContent = cnt("protected"); st[1].textContent = cnt("fishing"); st[2].textContent = cnt("coast");
  $("#exposeList").innerHTML = ex.filter(e => e.hit).map(e => `<div class="vessel-meta">▸ ${e.name}: reached in ~${e.hours} h</div>`).join("") || '<div class="vessel-meta">No zone reached within 12 h forecast.</div>';
}

function runAnalysis() {
  if (busy) return;
  if (!sourceLoaded) { loadDemo(); setTimeout(runAnalysis, 400); return; }
  busy = true; $("#analyseBtn").textContent = "Analysing…"; $("#caseStatus").textContent = "ANALYSING";
  let i = 0;
  (function tick() {
    setStep(i); if (i++ < 4) return setTimeout(tick, 350);
    analysed = true; busy = false; compute();
    if (R) $("#caseStatus").textContent = "ANALYSIS COMPLETE"; $("#analyseBtn").textContent = "Re-run analysis ✓";
  })();
}
$("#analyseBtn").onclick = runAnalysis;

function renderVessels() {
  $("#vesselList").innerHTML = R ? R.ves.map(v => `
    <div class="vessel"><div class="vessel-top"><div><div class="vessel-name">${v.name}${v.gapHit ? " ⚠" : ""}</div><div class="vessel-meta">${v.type} · ${v.mmsi}</div></div><div class="score">${v.score}%</div></div>
    <div class="bar"><i style="width:${v.score}%"></i></div><div class="vessel-meta">${v.detail}</div></div>`).join("") : "";
}
function renderLedger() {
  const L = R ? [["Source image", sourceName, "OBSERVED"], ["Image fingerprint", "SHA-256 generated in browser", "TRACEABLE"],
    ["Pollution mask", `Dark-patch detection · contrast ${(R.d.contrast * 100).toFixed(0)}% · ${R.km2.toFixed(1)} km²`, "ALGORITHM OUTPUT"],
    ["Slick classification", `${R.d.cls} (${R.d.clsWhy}, elongation ${R.d.elong.toFixed(1)})`, "HEURISTIC"],
    ["Drift corridor", `Wind ${R.p.wind} m/s from ${R.p.windDir}°, current ${R.p.cur} m/s to ${R.p.curDir}°, age ${R.p.age} h`, "MODEL ESTIMATE"],
    ["AIS candidates", `${R.ves.length} tracks scored vs origin at release time`, "CORRELATION"],
    ["GIS exposure", "12 h forecast vs protected / fishing / coastal zones", "SPATIAL ANALYSIS"]] : DEMO_DATA.ledger;
  $("#ledger").innerHTML = L.map(x => `<div class="ledger-row"><i></i><div><strong>${x[0]}</strong><span>${x[1]}</span></div><em>${x[2]}</em></div>`).join("");
}
renderLedger();

const save = (name, blob) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
$("#reportBtn").onclick = () => {
  if (!analysed || !R) { alert("Run the analysis first (a slick must be detected)."); return; }
  const { d, ves, ex, p, km2 } = R;
  save(`${DEMO_DATA.caseId}-dossier.txt`, new Blob([`MARINE SENTINEL — INVESTIGATION DOSSIER
Case: ${DEMO_DATA.caseId}
Source: ${sourceName}${isDemo ? " (synthetic demonstration scene)" : ""}
Image fingerprint: ${$("#hash").textContent}
Generated: ${new Date().toISOString()}

DETECTION (in-browser dark-patch algorithm)
Classification: ${d.cls} — ${d.clsWhy}
Confidence: ${d.conf}% (heuristic: contrast ${(d.contrast * 100).toFixed(0)}%, elongation ${d.elong.toFixed(2)})
Estimated area: ${km2.toFixed(1)} km² at ${p.res} m/px
Source window: ${$("#timeScore").textContent}

DRIFT BACKTRACE
Wind ${p.wind} m/s from ${p.windDir}°, current ${p.cur} m/s to ${p.curDir}°, windage 3%, age ${p.age} h
${$("#driftNote").textContent}

VESSEL CORRELATION (sample AIS)
${ves.map(v => `${v.name} — ${v.score}% — ${v.detail}`).join("\n")}

GIS IMPACT (12 h forecast)
${ex.map(e => `${e.hit ? "EXPOSED" : "clear  "}  ${e.name}${e.hit ? ` (~${e.hours} h)` : ` (${e.km.toFixed(1)} km away)`}`).join("\n")}

IMPORTANT
Candidate-vessel correlation is not proof of responsibility.
Drift inputs are user-set; detection is a heuristic. Verify with authoritative SAR, AIS and met-ocean data before operational use.`], { type: "text/plain" }));
};
$("#jsonBtn").onclick = () => { if (!R) { alert("Run the analysis first."); return; } const { d, ves, ex, p, km2 } = R;
  save(`${DEMO_DATA.caseId}.json`, new Blob([JSON.stringify({ case: DEMO_DATA.caseId, source: sourceName, fingerprint: $("#hash").textContent, detection: { class: d.cls, confidence: d.conf, areaKm2: +km2.toFixed(2), contrast: +d.contrast.toFixed(3), elongation: +d.elong.toFixed(2) }, params: p, vessels: ves.map(v => ({ name: v.name, mmsi: v.mmsi, score: v.score, km: +v.km.toFixed(2), aisGap: v.gapHit })), exposure: ex.map(e => ({ zone: e.name, hit: e.hit, hours: e.hours })) }, null, 2)], { type: "application/json" })); };
$("#pngBtn").onclick = () => canvas.toBlob(b => save(`${DEMO_DATA.caseId}-annotated.png`, b));
$("#printBtn").onclick = () => window.print();

// presets, AIS CSV upload, accessibility
$("#presets").innerHTML = Object.keys(DEMO_DATA.presets).map(k => `<button type="button" class="btn secondary">${k}</button>`).join("");
$("#presets").querySelectorAll("button").forEach((b, i) => b.onclick = () => { const o = Object.values(DEMO_DATA.presets)[i]; Object.entries(o).forEach(([k, v]) => $(`[data-p=${k}]`).value = v); if (!sourceLoaded) runAnalysis(); else if (analysed) compute(); });
$("#aisBtn").onclick = () => $("#aisFile").click();
$("#aisFile").onchange = async e => { const f = e.target.files[0]; if (!f) return; try { const v = Engine.parseCSV(await f.text()); if (!v.length) throw new Error("No usable vessel tracks (need 2+ points per MMSI)."); customAIS = v; $("#aisChip").textContent = `AIS: ${f.name}`; if (analysed) compute(); } catch (er) { alert("AIS CSV problem: " + er.message); } e.target.value = ""; };
$("#aisReset").onclick = () => { customAIS = null; $("#aisChip").textContent = "AIS SAMPLE"; if (analysed) compute(); };
$("#aisTpl").onclick = () => save("ais-template.csv", new Blob(["name,mmsi,type,time_utc,lat,lon\nMV Example,419000001,Tanker,2026-10-01T13:10:00Z,15.40,67.80\nMV Example,419000001,Tanker,2026-10-01T17:40:00Z,15.46,67.95\nMV Example,419000001,Tanker,2026-10-01T21:10:00Z,15.55,68.10\n"], { type: "text/csv" }));
dropzone.tabIndex = 0; dropzone.setAttribute("role", "button"); dropzone.setAttribute("aria-label", "Upload satellite image");
dropzone.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } });
