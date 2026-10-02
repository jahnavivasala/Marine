/* MARINE SENTINEL UI controller. Analysis maths lives in engine.js; sample data in data.js. */
const $ = s => document.querySelector(s);
const fileInput = $("#fileInput"), dropzone = $("#dropzone");
const canvas = $("#sceneCanvas"), ctx = canvas.getContext("2d", { willReadFrequently: true });
const MAX_MB = 25, MAX_AIS_MB = 5, SHOW_VESSELS = 8, CW = 1200, CH = 600;
let customAIS = null, base = null, R = null, sourceName = DEMO_DATA.sceneName, sourceLoaded = false, isDemo = true, analysed = false, busy = false;
let fingerprint = "", scene = { k: 1, rect: { x: 0, y: 0, w: CW, h: CH } }, runId = 0, loadId = 0, lastAcq = "2026-10-01T21:10:00Z";
const reviewEvents = [], timeline = [];
const esc = x => String(x ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const num = (v, dp = 2) => Number.isFinite(v) ? +v.toFixed(dp) : null; // JSON-safe number (never NaN)
const sleep = ms => new Promise(r => setTimeout(r, ms));
const caseId = () => isDemo ? DEMO_DATA.caseId : `MS-${(fingerprint || "LOCAL").slice(0, 8).toUpperCase()}`;
const aisLabel = () => customAIS ? "uploaded AIS CSV" : "sample AIS";

/* ---------- small UI helpers ---------- */
function notify(msg, kind = "error") {
  let box = $("#toasts");
  if (!box) { box = document.createElement("div"); box.id = "toasts"; box.setAttribute("role", "status"); box.setAttribute("aria-live", "polite"); document.body.appendChild(box); }
  const t = document.createElement("div"); t.className = "toast " + kind; t.textContent = msg; box.appendChild(t);
  setTimeout(() => t.remove(), kind === "error" ? 6500 : 3500);
}
function logEvent(type, detail) { timeline.unshift({ at: new Date().toISOString(), type, detail }); renderTimeline(); }
function renderTimeline() {
  const el = $("#eventTimeline");
  el.innerHTML = timeline.slice(0, 50).map(x => `<div class="ledger-row"><i></i><div><strong>${esc(x.type)}</strong><span>${esc(x.detail)} · ${esc(new Date(x.at).toLocaleString())}</span></div><em>SESSION</em></div>`).join("") || "Timeline entries appear as actions are performed.";
}
const clock = () => { $("#clock").textContent = new Date().toLocaleTimeString("en-GB"); };
setInterval(clock, 1000); clock();

const DRIFT_NOTE_DEFAULT = $("#driftNote").textContent, MAP_SVG = $(".map svg"), MAP_INIT = MAP_SVG.innerHTML;
const OVERLAY_TAG_DEFAULT = $("#sceneOverlay .tag").textContent;
function setStep(n) { document.querySelectorAll(".step").forEach((x, i) => x.classList.toggle("active", i === n)); }
function setBusy(on) { const b = $("#analyseBtn"); b.disabled = on; if (on) { b.textContent = "Analysing…"; $("#caseStatus").textContent = "ANALYSING"; } }

/* ---------- parameters & validation ---------- */
const P = () => { const o = {}; document.querySelectorAll("[data-p]").forEach(i => o[i.dataset.p] = parseFloat(i.value)); return o; };
const acqMs = () => { const t = Engine.parseUTC($("#acq").value); return Number.isFinite(t) ? t : Engine.parseUTC(lastAcq); };
function sanitise(i) { // clamp to the field's min/max; restore the previous value if empty/non-numeric
  const k = i.dataset.p, min = i.min !== "" ? +i.min : -Infinity, max = i.max !== "" ? +i.max : Infinity, label = i.parentElement.childNodes[0].textContent.trim();
  let v = parseFloat(i.value);
  if (!Number.isFinite(v)) { v = i.dataset.good !== undefined ? +i.dataset.good : DEMO_DATA.params[k]; notify(`${label}: enter a number. Previous value restored.`); }
  else if (v < min || v > max) { const c = Math.min(max, Math.max(min, v)); notify(`${label} must be between ${min} and ${max}. Set to ${c}.`); v = c; }
  i.value = v; i.dataset.good = v;
}
function onParamChange() { if (analysed) compute(); }
document.querySelectorAll("[data-p]").forEach(i => { i.value = DEMO_DATA.params[i.dataset.p]; i.dataset.good = i.value; i.onchange = () => { sanitise(i); onParamChange(); }; });
$("#acq").onchange = () => {
  const t = Engine.parseUTC($("#acq").value);
  if (!Number.isFinite(t)) { notify("Capture time must be a UTC timestamp, e.g. 2026-10-01T21:10:00Z. Previous value restored."); $("#acq").value = lastAcq; return; }
  lastAcq = $("#acq").value.trim(); onParamChange();
};

/* ---------- source loading ---------- */
$("#chooseBtn").onclick = e => { e.stopPropagation(); fileInput.click(); };
$("#demoBtn").onclick = e => { e.stopPropagation(); loadDemo(); };
fileInput.onchange = e => { const f = e.target.files[0]; if (f) loadImage(f); fileInput.value = ""; };
dropzone.addEventListener("click", e => { if (e.target === dropzone) fileInput.click(); });
["dragenter", "dragover"].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add("drag"); }));
["dragleave", "drop"].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.remove("drag"); }));
dropzone.addEventListener("drop", e => { const f = e.dataTransfer.files[0]; if (f) loadImage(f); });
// a file dropped outside the drop zone would otherwise navigate away and lose the session
["dragover", "drop"].forEach(ev => window.addEventListener(ev, e => e.preventDefault()));

async function fingerprintOf(file) {
  try { if (!window.crypto || !crypto.subtle) throw 0; const h = await crypto.subtle.digest("SHA-256", await file.arrayBuffer()); return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join(""); }
  catch { return ""; }
}

/* Draw onto an off-screen canvas first: if the browser refuses pixel access the current scene is left untouched. */
function applyScene(src, { name, demo }) {
  const w = src.naturalWidth || src.width || CW, h = src.naturalHeight || src.height || CH;
  const k = Math.min(CW / w, CH / h), dw = w * k, dh = h * k, dx = (CW - dw) / 2, dy = (CH - dh) / 2;
  const off = document.createElement("canvas"); off.width = CW; off.height = CH;
  const o = off.getContext("2d", { willReadFrequently: true });
  o.fillStyle = "#07141b"; o.fillRect(0, 0, CW, CH); o.drawImage(src, dx, dy, dw, dh);
  let data; try { data = o.getImageData(0, 0, CW, CH); } catch { return false; }
  canvas.width = CW; canvas.height = CH; ctx.putImageData(data, 0, 0);
  base = data; scene = { k, rect: { x: dx, y: dy, w: dw, h: dh } };
  isDemo = demo; sourceName = name; sourceLoaded = true; busy = false; runId++;
  $("#caseMeta").textContent = demo ? `${DEMO_DATA.caseId} · demonstration data` : `${name} · local source`;
  $(".scene-placeholder").hidden = true; $("#sceneOverlay").hidden = false;
  $("#analyseBtn").disabled = false;
  resetAnalysis();
  $("#confidenceBadge").textContent = "READY TO ANALYSE"; $("#caseStatus").textContent = "SOURCE LOADED";
  logEvent("Source loaded", name);
  return true;
}

async function loadImage(file) {
  if (!file.type.startsWith("image/")) { notify("Please choose an image file (JPG, PNG or WebP)."); return; }
  if (file.size > MAX_MB * 1048576) { notify(`Image is larger than ${MAX_MB} MB. Please choose a smaller file.`); return; }
  const id = ++loadId, url = URL.createObjectURL(file), img = new Image(), hashP = fingerprintOf(file);
  img.onerror = () => { URL.revokeObjectURL(url); if (id === loadId) notify("Could not read this image. Try a JPG or PNG."); };
  img.onload = async () => {
    URL.revokeObjectURL(url);
    if (id !== loadId) return; // a newer file or the demo was chosen meanwhile
    fingerprint = "";
    if (!applyScene(img, { name: file.name, demo: false })) { notify("The browser blocked pixel access to this image. Try a JPG or PNG."); return; }
    $("#hash").textContent = "Calculating…";
    const h = await hashP;
    if (id !== loadId) return;
    fingerprint = h; $("#hash").textContent = h || "Fingerprint unavailable in this browser (needs a secure context)"; renderLedger();
  };
  img.src = url;
}

function demoFallback() { // procedural copy of assets/demo-ocean.svg, used when the SVG cannot be read (e.g. some file:// setups)
  const c = document.createElement("canvas"); c.width = CW; c.height = CH; const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, 0, CH); g.addColorStop(0, "#163b43"); g.addColorStop(1, "#07151d"); x.fillStyle = g; x.fillRect(0, 0, CW, CH);
  x.fillStyle = "#1e4244"; x.beginPath(); x.moveTo(0, 0); x.lineTo(CW, 0); x.lineTo(CW, 90); x.bezierCurveTo(1060, 125, 930, 72, 790, 115); x.bezierCurveTo(660, 155, 560, 155, 410, 104); x.bezierCurveTo(300, 70, 190, 126, 0, 82); x.fill();
  x.strokeStyle = "rgba(139,193,192,.22)"; x.lineWidth = 1; for (let i = 150; i < CH; i += 100) { x.beginPath(); x.moveTo(0, i); x.lineTo(CW, i); x.stroke(); } for (let i = 150; i < CW; i += 150) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, CH); x.stroke(); }
  x.save(); x.translate(850, 410); x.rotate(-20 * Math.PI / 180);
  x.filter = "blur(18px)"; x.fillStyle = "rgba(2,10,14,.95)"; x.beginPath(); x.ellipse(0, 0, 170, 70, 0, 0, 7); x.fill(); x.filter = "none";
  x.fillStyle = "#03090c"; x.beginPath(); x.ellipse(0, 0, 125, 48, 0, 0, 7); x.fill(); x.restore();
  x.fillStyle = "#8fa3aa"; x.font = "16px monospace"; x.fillText("DEMONSTRATION SATELLITE SCENE · SYNTHETIC VISUAL", 32, 560);
  return c;
}
function loadDemo() {
  const id = ++loadId; fingerprint = "";
  return new Promise(resolve => {
    const done = src => { if (id !== loadId) return resolve(false); let ok = applyScene(src, { name: DEMO_DATA.sceneName, demo: true }); if (!ok) ok = applyScene(demoFallback(), { name: DEMO_DATA.sceneName, demo: true }); if (ok) $("#hash").textContent = "DEMO-SOURCE-NO-UPLOAD"; resolve(ok); };
    const img = new Image(); img.onload = () => done(img); img.onerror = () => done(demoFallback()); img.src = "assets/demo-ocean.svg";
  });
}

/* ---------- result state ---------- */
function renderImpactStats(ex) {
  const tot = t => DEMO_DATA.zones.filter(z => z.type === t).length, hit = t => ex ? ex.filter(e => e.type === t && e.hit).length : "—";
  $("#statProtected").textContent = `${hit("protected")}/${tot("protected")}`; $("#statFishing").textContent = `${hit("fishing")}/${tot("fishing")}`; $("#statCoast").textContent = `${hit("coast")}/${tot("coast")}`;
  const map = { protected: ".zone.protected", fishing: ".zone.fishing", coast: ".zone.coast-zone" };
  Object.entries(map).forEach(([t, sel]) => $(sel).classList.toggle("hit", !!ex && ex.some(e => e.type === t && e.hit)));
}
function clearResults() { // wipe everything derived from a previous analysis so no stale numbers stay on screen
  R = null;
  ["#detScore", "#areaScore", "#timeScore"].forEach(s => $(s).textContent = "—");
  $("#candidateCount").textContent = "—"; $("#vesselList").innerHTML = ""; $("#exposeList").innerHTML = "";
  $("#driftNote").textContent = DRIFT_NOTE_DEFAULT; MAP_SVG.innerHTML = MAP_INIT;
  $("#sceneOverlay .tag").textContent = OVERLAY_TAG_DEFAULT;
  renderImpactStats(null); renderLedger(); renderAdvanced();
}
function resetAnalysis() {
  analysed = false; $("#analyseBtn").innerHTML = "Run analysis <span>↗</span>";
  clearResults(); setStep(0);
}
function fail(status, badge, msg) {
  clearResults(); $("#caseStatus").textContent = status; $("#confidenceBadge").textContent = badge;
  $("#vesselList").innerHTML = `<div class="vessel-meta" style="padding:14px 0">${esc(msg)}</div>`; renderLedger();
}

/* ---------- analysis ---------- */
function compute() {
  if (!base) return;
  ctx.putImageData(base, 0, 0);
  const p = P(), acq = acqMs(), pe = { ...p, res: p.res / scene.k }; // pe.res = metres per CANVAS pixel (the source image may have been rescaled to fit)
  let d;
  try { d = Engine.detect(canvas, p.sens, scene.rect); } catch (err) { console.error(err); fail("ANALYSIS ERROR", "ERROR", "Detection failed unexpectedly: " + err.message); return; }
  if (d && d.invalid) { fail("UNSUITABLE IMAGE", "NOT A SEA SCENE", d.invalid); return; }
  if (!d) { fail("NO SLICK DETECTED", "NO ANOMALY", "No dark-patch anomaly above threshold. Try a SAR or high-contrast scene, or raise the detection sensitivity."); return; }
  const tracks = customAIS ? Engine.toTracks(customAIS, { lat: p.lat, lon: p.lon, res: pe.res, acq }, d) : DEMO_DATA.vessels;
  const dr = Engine.drift(d, pe), ves = Engine.correlate(tracks, dr, pe, d), ex = Engine.exposure(DEMO_DATA.zones, dr, d, pe);
  const km2 = d.px * pe.res * pe.res / 1e6, rel = new Date(acq - p.age * 36e5);
  R = { d, dr, ves, ex, p, pe, km2, rel, acq, ais: aisLabel(), scenarios: Engine.scenarios(d, pe) };

  // annotate the canvas
  const S = d.S, o = dr.origin, f = dr.fc(12);
  ctx.fillStyle = "rgba(255,123,114,.38)"; d.cells.forEach(([x, y]) => ctx.fillRect(x * S, y * S, S, S));
  ctx.lineWidth = 3; ctx.strokeStyle = "#6ee7e0"; ctx.setLineDash([12, 9]); ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(d.cx, d.cy); ctx.stroke(); ctx.setLineDash([]);
  ctx.strokeStyle = "#f0c674"; ctx.beginPath(); ctx.arc(o.x, o.y, dr.sigmaPx, 0, 7); ctx.stroke();
  ctx.strokeStyle = "rgba(240,198,116,.5)"; ctx.beginPath(); ctx.moveTo(d.cx, d.cy); ctx.lineTo(f.x, f.y); ctx.stroke();
  ctx.fillStyle = "#f0c674"; ctx.beginPath(); ctx.arc(o.x, o.y, 5, 0, 7); ctx.fill(); ctx.fillStyle = "#ff7b72"; ctx.beginPath(); ctx.arc(d.cx, d.cy, 5, 0, 7); ctx.fill();
  ctx.font = "600 15px monospace"; ctx.fillStyle = "#f0c674"; ctx.fillText("EST. ORIGIN", Math.min(CW - 110, Math.max(6, o.x + 10)), Math.min(CH - 8, Math.max(18, o.y - 10)));
  ctx.fillStyle = "#ffaaa4"; ctx.fillText("DETECTED", Math.min(CW - 90, Math.max(6, d.cx + 10)), Math.min(CH - 8, Math.max(18, d.cy + 22)));

  $("#confidenceBadge").textContent = `${d.conf}% CONFIDENCE · ${d.cls.toUpperCase()}`;
  $("#detScore").textContent = `${d.conf}%`; $("#areaScore").textContent = km2.toFixed(1) + " km²";
  $("#timeScore").textContent = `${new Date(+rel - 72e5).toISOString().slice(11, 16)}–${new Date(+rel + 72e5).toISOString().slice(11, 16)} UTC`;
  $("#sceneOverlay .tag").textContent = d.cls.toUpperCase();

  // stylised drift map (scene coordinates scaled to the 700x330 SVG)
  const cl = (v, a, b) => Math.min(b, Math.max(a, v)), mx = x => (x / d.W * 700), my = y => (y / d.H * 330);
  const r = scene.rect, outside = o.x < r.x || o.x > r.x + r.w || o.y < r.y || o.y > r.y + r.h;
  const ox = cl(mx(o.x), 0, 700), oy = cl(my(o.y), 0, 330), sx = mx(d.cx), sy = my(d.cy);
  $(".route").setAttribute("d", `M${sx.toFixed(1)} ${sy.toFixed(1)} L${ox.toFixed(1)} ${oy.toFixed(1)}`);
  $(".origin").setAttribute("cx", ox.toFixed(1)); $(".origin").setAttribute("cy", oy.toFixed(1)); $(".spill").setAttribute("cx", sx.toFixed(1)); $(".spill").setAttribute("cy", sy.toFixed(1));
  const lo = $("#originLbl"), ls = $("#spillLbl");
  lo.setAttribute("x", cl(ox - 15, 4, 610).toFixed(0)); lo.setAttribute("y", cl(oy - 21, 12, 322).toFixed(0)); ls.setAttribute("x", cl(sx - 45, 4, 600).toFixed(0)); ls.setAttribute("y", cl(sy + 27, 12, 322).toFixed(0));
  document.querySelectorAll(".arrow").forEach(a => a.remove());
  $("#dyn").innerHTML = `<circle cx="${ox.toFixed(1)}" cy="${oy.toFixed(1)}" r="${(dr.sigmaPx / d.W * 700).toFixed(1)}" fill="#f0c67422" stroke="#f0c674" stroke-dasharray="3 4"/>` +
    ves.slice(0, 6).map((v, i) => `<polyline fill="none" stroke="${i ? "#80bfff" : "#f0c674"}" stroke-opacity=".7" stroke-width="1.5" points="${v.track.map(t => `${(t[1] * 700).toFixed(0)},${(t[2] * 330).toFixed(0)}`).join(" ")}"/><text x="${cl(v.track[0][1] * 700, 4, 640).toFixed(0)}" y="${cl(v.track[0][2] * 330 - 5, 12, 322).toFixed(0)}">${esc(v.name)}</text>`).join("");
  $("#driftNote").textContent = `Drift ${(dr.speed * 1.944).toFixed(2)} kn toward ${dr.bearing.toFixed(0)}° (current + 3% windage) over ${p.age} h. Origin uncertainty ±${(dr.sigmaPx * pe.res / 1000).toFixed(1)} km.${outside ? " The estimated origin lies outside the scene footprint (marker pinned to the edge)." : ""} Model estimate: an investigative lead, not a measured source.`;

  $("#candidateCount").textContent = ves.filter(v => v.score >= 25).length;
  renderVessels(); renderLedger(); renderAdvanced(); renderImpactStats(ex);
  $("#exposeList").innerHTML = ex.filter(e => e.hit).map(e => `<div class="vessel-meta">▸ ${esc(e.name)}: ${e.hours === 0 ? "already within reach at detection" : `reached in ~${e.hours} h`}</div>`).join("") || '<div class="vessel-meta">No zone reached within 12 h forecast.</div>';
}

async function runAnalysis() {
  if (busy) return;
  busy = true; setBusy(true);
  if (!sourceLoaded) { const ok = await loadDemo(); if (!ok) { busy = false; $("#analyseBtn").disabled = false; $("#analyseBtn").innerHTML = "Run analysis <span>↗</span>"; $("#caseStatus").textContent = "READY FOR ANALYSIS"; if (!sourceLoaded) notify("The demonstration scene could not be loaded."); return; } busy = true; setBusy(true); }
  const id = runId;
  for (let i = 0; i < 5; i++) { setStep(i); await sleep(350); if (id !== runId) return; } // a new source replaced this one: abandon quietly
  busy = false; analysed = true; $("#analyseBtn").disabled = false;
  try { compute(); } catch (err) { console.error(err); fail("ANALYSIS ERROR", "ERROR", "Analysis failed: " + err.message); }
  logEvent("Analysis completed", R ? `${R.d.count} detected region(s); heuristic assessment` : "No valid detection result");
  if (R) $("#caseStatus").textContent = "ANALYSIS COMPLETE";
  $("#analyseBtn").innerHTML = R ? "Re-run analysis ✓" : "Re-run analysis <span>↗</span>";
}
$("#analyseBtn").onclick = runAnalysis;

/* ---------- panels ---------- */
function renderVessels() {
  if (!R) { $("#vesselList").innerHTML = ""; return; }
  const shown = R.ves.slice(0, SHOW_VESSELS), more = R.ves.length - shown.length;
  $("#vesselList").innerHTML = (shown.map(v => `
    <div class="vessel"><div class="vessel-top"><div><div class="vessel-name">${esc(v.name)}${v.gapHit ? " ⚠" : ""}</div><div class="vessel-meta">${esc(v.type)} · ${esc(v.mmsi)}</div></div><div class="score">${v.score}%</div></div>
    <div class="bar"><i style="width:${v.score}%"></i></div><div class="vessel-meta">${esc(v.detail)}</div></div>`).join("") || '<div class="vessel-meta" style="padding:14px 0">No vessel tracks available.</div>')
    + (more > 0 ? `<div class="vessel-meta" style="padding:10px 0">+ ${more} lower-ranked track(s) not shown (all are included in the JSON export).</div>` : "");
}
function fingerprintText() { return fingerprint ? `SHA-256 ${fingerprint.slice(0, 16)}…` : isDemo ? "Not applicable (built-in demonstration scene)" : "Unavailable in this browser"; }
function renderLedger() {
  let L;
  if (R) L = [["Source image", sourceName, isDemo ? "SYNTHETIC DEMO" : "OBSERVED"], ["Image fingerprint", fingerprintText(), fingerprint ? "TRACEABLE" : "N/A"],
    ["Pollution mask", `Dark-patch detection · contrast ${(R.d.contrast * 100).toFixed(0)}% · ${R.km2.toFixed(1)} km²`, "ALGORITHM OUTPUT"],
    ["Slick classification", `${R.d.cls} (${R.d.clsWhy}, elongation ${R.d.elong.toFixed(1)})`, "HEURISTIC"],
    ["Drift corridor", `Wind ${R.p.wind} m/s from ${R.p.windDir}°, current ${R.p.cur} m/s to ${R.p.curDir}°, age ${R.p.age} h`, "MODEL ESTIMATE"],
    ["AIS candidates", `${R.ves.length} track(s) from ${R.ais} scored vs origin at release time`, "CORRELATION"],
    ["GIS exposure", "12 h forecast vs sample protected / fishing / coastal zones (scene-relative demo layers)", "SPATIAL ANALYSIS"]];
  else if (sourceLoaded) L = [["Source image", sourceName, isDemo ? "SYNTHETIC DEMO" : "OBSERVED"], ["Image fingerprint", fingerprintText(), fingerprint ? "TRACEABLE" : "N/A"],
    ["Analysis", analysed ? "No valid detection for the current settings" : "Not run yet", "PENDING"]];
  else L = DEMO_DATA.ledger;
  $("#ledger").innerHTML = L.map(x => `<div class="ledger-row"><i></i><div><strong>${esc(x[0])}</strong><span>${esc(x[1])}</span></div><em>${esc(x[2])}</em></div>`).join("");
}
function renderAdvanced() {
  const sc = R?.scenarios || [];
  $("#scenarioList").innerHTML = sc.map(s => `<div class="ledger-row"><i></i><div><strong>${esc(s.name)}</strong><span>12 h drift ${s.km12.toFixed(1)} km toward ${s.bearing.toFixed(0)}° · ${(s.speed * 1.944).toFixed(2)} kn · origin uncertainty ±${(s.sigmaPx * R.pe.res / 1000).toFixed(2)} km</span></div><em>SCENARIO</em></div>`).join("") || "Run analysis to compare scenarios.";
  const checks = [["Image source", sourceLoaded], ["Detection run", !!R], ["Capture time", Number.isFinite(Engine.parseUTC($("#acq").value))], ["Spatial reference", Number.isFinite(R?.p.lat) && Number.isFinite(R?.p.lon)], ["Environmental inputs", !!R], ["AIS observations", !!customAIS], ["Independent corroboration", false], ["Analyst verification", $("#reviewStatus").value === "Analyst verified"]];
  $("#qualityList").innerHTML = checks.map(([n, ok]) => `<div><b>${ok ? "✓" : "○"}</b><strong>${n}</strong><p>${ok ? "Available in this session" : "Missing or not independently verified"}</p></div>`).join("");
}
$("#saveReview").onclick = () => {
  const status = $("#reviewStatus").value, notes = $("#reviewNotes").value.trim();
  reviewEvents.unshift({ at: new Date().toISOString(), status, notes });
  $("#reviewLog").innerHTML = reviewEvents.map(x => `<div class="ledger-row"><i></i><div><strong>${esc(x.status)}</strong><span>${esc(x.notes || "No notes entered")}</span></div><em>${esc(new Date(x.at).toLocaleTimeString())}</em></div>`).join("");
  logEvent("Analyst review", status + (notes ? ": " + notes : "")); renderAdvanced();
};
$("#reviewStatus").onchange = renderAdvanced;

/* ---------- exports ---------- */
const save = (name, blob) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
$("#reportBtn").onclick = () => {
  if (!analysed || !R) { notify("Run the analysis first (a slick must be detected)."); return; }
  const { d, ves, ex, p, km2, rel, acq } = R;
  logEvent("Dossier exported", "Human-readable report");
  const lines = ["MARINE SENTINEL — INVESTIGATION DOSSIER", `Case: ${caseId()}`, `Source: ${sourceName}${isDemo ? " (synthetic demonstration scene)" : ""}`,
    `Image fingerprint: ${fingerprint || (isDemo ? "n/a (built-in demonstration scene)" : "unavailable")}`, `Generated: ${new Date().toISOString()}`, "",
    "DETECTION (in-browser dark-patch algorithm)", `Classification: ${d.cls} — ${d.clsWhy}`, `Confidence: ${d.conf}% (heuristic: contrast ${(d.contrast * 100).toFixed(0)}%, elongation ${d.elong.toFixed(2)})`,
    `Estimated area: ${km2.toFixed(1)} km² at ${p.res} m/px (source image)`, `Capture time: ${new Date(acq).toISOString()}`, `Estimated release: ${rel.toISOString()}`, `Source window: ${$("#timeScore").textContent}`, "",
    "DRIFT BACKTRACE", `Wind ${p.wind} m/s from ${p.windDir}°, current ${p.cur} m/s to ${p.curDir}°, windage 3%, age ${p.age} h`, $("#driftNote").textContent, "",
    `VESSEL CORRELATION (${R.ais}; top ${Math.min(10, ves.length)} of ${ves.length})`, ...ves.slice(0, 10).map(v => `${v.name} — ${v.score}% — ${v.detail}`), "",
    "GIS IMPACT (12 h forecast vs sample zones, scene-relative)", ...ex.map(e => `${e.hit ? "EXPOSED" : "clear  "}  ${e.name}${e.hit ? ` (~${e.hours} h)` : ` (${e.km.toFixed(1)} km away)`}`), "",
    "IMPORTANT", "Candidate-vessel correlation is not proof of responsibility.", "Drift inputs are user-set; detection is a heuristic. Verify with authoritative SAR, AIS and met-ocean data before operational use."];
  save(`${caseId()}-dossier.txt`, new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" }));
};
$("#jsonBtn").onclick = () => {
  if (!R) { notify("Run the analysis first (a slick must be detected)."); return; }
  logEvent("JSON exported", "Machine-readable investigation record");
  const { d, dr, ves, ex, p, pe, km2, rel, acq } = R;
  const out = {
    schema: "marine-sentinel/export-v2", generatedAt: new Date().toISOString(), case: caseId(), source: sourceName, sourceType: isDemo ? "synthetic demonstration scene" : "user-supplied image",
    fingerprint: fingerprint || null, captureTimeUtc: new Date(acq).toISOString(), estimatedReleaseUtc: rel.toISOString(),
    detection: { class: d.cls, reason: d.clsWhy, confidence: d.conf, areaKm2: num(km2), contrast: num(d.contrast, 3), elongation: num(d.elong), compactness: num(d.compactness, 3), regions: d.count, boundingBoxCanvasPx: d.bbox },
    georeference: { centreLat: p.lat, centreLon: p.lon, metresPerSourcePixel: p.res, canvasScale: num(scene.k, 4), metresPerCanvasPixel: num(pe.res, 3) },
    params: p,
    drift: { speedKn: num(dr.speed * 1.944), bearingDeg: num(dr.bearing, 0), originUncertaintyKm: num(dr.sigmaPx * pe.res / 1000), originCanvasPx: { x: num(dr.origin.x, 1), y: num(dr.origin.y, 1) }, detectedCentroidCanvasPx: { x: num(d.cx, 1), y: num(d.cy, 1) } },
    aisSource: R.ais,
    vessels: ves.map(v => ({ name: v.name, mmsi: v.mmsi, score: v.score, km: num(v.km), aisGap: !!v.gapHit })),
    exposure: ex.map(e => ({ zone: e.name, type: e.type, hit: e.hit, hours: e.hours, distanceKm: num(e.km) })),
    scenarios: R.scenarios.map(s => ({ name: s.name, driftKm12h: num(s.km12), bearingDeg: num(s.bearing, 0), speedKn: num(s.speed * 1.944), originUncertaintyKm: num(s.sigmaPx * pe.res / 1000) })),
    review: { status: $("#reviewStatus").value, notes: $("#reviewNotes").value, events: reviewEvents }, timeline,
    limitations: ["Heuristic image analysis; not a trained classifier", "Simplified drift assumptions", "AIS/GIS sample data are illustrative unless user supplied", "Correlation is not attribution"]
  };
  save(`${caseId()}.json`, new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }));
};
$("#pngBtn").onclick = () => {
  if (!R) { notify("Run the analysis first so there is something to annotate."); return; }
  const c = document.createElement("canvas"); c.width = CW; c.height = CH; const x = c.getContext("2d"); x.drawImage(canvas, 0, 0);
  x.fillStyle = "rgba(7,17,24,.82)"; x.fillRect(0, CH - 26, CW, 26); x.fillStyle = "#cfe3e6"; x.font = "13px monospace";
  const src = sourceName.length > 28 ? sourceName.slice(0, 27) + "…" : sourceName;
  x.fillText(`MARINE SENTINEL · ${caseId()} · ${src} · ${R.d.cls} ${R.d.conf}% · MODEL ESTIMATE, NOT PROOF OF RESPONSIBILITY`, 10, CH - 9);
  c.toBlob(b => { if (b) { logEvent("PNG exported", "Annotated scene"); save(`${caseId()}-annotated.png`, b); } else notify("Could not create the PNG."); });
};
$("#printBtn").onclick = () => window.print();

/* ---------- presets, AIS CSV upload, accessibility ---------- */
const ENV_KEYS = ["age", "wind", "windDir", "cur", "curDir"];
$("#presets").innerHTML = Object.keys(DEMO_DATA.presets).map(k => `<button type="button" class="btn secondary">${esc(k)}</button>`).join("");
$("#presets").querySelectorAll("button").forEach((b, i) => b.onclick = () => {
  const o = { ...Object.fromEntries(ENV_KEYS.map(k => [k, DEMO_DATA.params[k]])), ...Object.values(DEMO_DATA.presets)[i] }; // every preset starts from the default environment, so presets never leak into each other
  Object.entries(o).forEach(([k, v]) => { const el = $(`[data-p=${k}]`); el.value = v; el.dataset.good = v; });
  if (!sourceLoaded) runAnalysis(); else if (analysed) compute();
});
$("#aisBtn").onclick = () => $("#aisFile").click();
$("#aisFile").onchange = async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  if (f.size > MAX_AIS_MB * 1048576) { notify(`AIS file is larger than ${MAX_AIS_MB} MB.`); return; }
  try {
    const v = Engine.parseCSV(await f.text()); if (!v.length) throw new Error("No usable vessel tracks (need 2+ valid rows per MMSI, with numeric lat/lon and a UTC time).");
    customAIS = v; $("#aisChip").textContent = `AIS: ${f.name.length > 22 ? f.name.slice(0, 21) + "…" : f.name}`;
    logEvent("AIS imported", `${v.length} vessel track(s) parsed from ${f.name}`); notify(`Loaded ${v.length} vessel track(s) from ${f.name}.`, "ok"); if (analysed) compute(); else renderAdvanced();
  } catch (er) { notify("AIS CSV problem: " + er.message); }
};
$("#aisReset").onclick = () => { if (!customAIS) return; customAIS = null; $("#aisChip").textContent = "AIS SAMPLE"; logEvent("AIS source changed", "Using demonstration tracks"); if (analysed) compute(); else renderAdvanced(); };
$("#aisTpl").onclick = () => save("ais-template.csv", new Blob(["name,mmsi,type,time_utc,lat,lon\nMV Example,419000001,Tanker,2026-10-01T13:10:00Z,15.40,67.80\nMV Example,419000001,Tanker,2026-10-01T17:40:00Z,15.46,67.95\nMV Example,419000001,Tanker,2026-10-01T21:10:00Z,15.55,68.10\n"], { type: "text/csv" }));
dropzone.tabIndex = 0; dropzone.setAttribute("role", "button"); dropzone.setAttribute("aria-label", "Upload satellite image");
dropzone.addEventListener("keydown", e => { if (e.target === dropzone && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); fileInput.click(); } }); // only for the zone itself, so the buttons inside keep their own keyboard behaviour

renderTimeline(); renderImpactStats(null); renderLedger(); renderAdvanced();
