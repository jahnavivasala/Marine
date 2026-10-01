/* MARINE SENTINEL analysis engine: real in-browser heuristics (no cloud). */
const Engine = (() => {
  const S = 4; // analysis downscale

  // 1. Dark-patch slick detection (SAR-style): local-contrast threshold + connected components
  function detect(canvas, sens = 1) {
    const W = canvas.width / S | 0, H = canvas.height / S | 0;
    const t = document.createElement("canvas"); t.width = W; t.height = H;
    const c = t.getContext("2d"); c.imageSmoothingQuality = "high"; c.drawImage(canvas, 0, 0, W, H);
    const px = c.getImageData(0, 0, W, H).data, g = new Float32Array(W * H);
    { const b = Float32Array.from(g); for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { let s = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += b[(y + j) * W + x + i]; g[y * W + x] = s / 9; } } // speckle suppression
    let hc = 0, hs = 0, hn = 0; // hue spread: a rainbow (interferogram) has no dominant hue; a sea scene does
    for (let i = 0; i < g.length; i += 3) { const r = px[4 * i], gg = px[4 * i + 1], bl = px[4 * i + 2], mx = Math.max(r, gg, bl), mn = Math.min(r, gg, bl);
      if (mx < 40 || (mx - mn) / mx < .3) continue; const h = Math.atan2(Math.sqrt(3) * (gg - bl), 2 * r - gg - bl); hc += Math.cos(h); hs += Math.sin(h); hn++; }
    if (hn > g.length / 12 && Math.hypot(hc, hs) / hn < .6) return { invalid: "Colour image (looks like an interferogram or false-colour product). Oil detection needs greyscale SAR backscatter or an optical sea scene." };
    for (let i = 0; i < g.length; i++) g[i] = .299 * px[4 * i] + .587 * px[4 * i + 1] + .114 * px[4 * i + 2];
    const srt = Float32Array.from(g).sort(), med = srt[srt.length >> 1], sea = new Uint8Array(W * H); // land = much brighter than the scene median
    for (let i = 0; i < g.length; i++) sea[i] = g[i] < med * 1.4 ? 1 : 0;
    const I = new Float64Array((W + 1) * (H + 1)), Q = new Float64Array((W + 1) * (H + 1)), C = new Float64Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const sm = sea[y * W + x], v = sm * g[y * W + x], k = (y + 1) * (W + 1) + x + 1;
      C[k] = sm + C[k - 1] + C[k - W - 1] - C[k - W - 2];
      I[k] = v + I[k - 1] + I[k - W - 1] - I[k - W - 2]; Q[k] = v * v + Q[k - 1] + Q[k - W - 1] - Q[k - W - 2];
    }
    const R = 45, box = (A, x0, y0, x1, y1) => A[y1 * (W + 1) + x1] - A[y0 * (W + 1) + x1] - A[y1 * (W + 1) + x0] + A[y0 * (W + 1) + x0];
    const dark = new Uint8Array(W * H), bg = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - R), x1 = Math.min(W, x + R + 1), y0 = Math.max(0, y - R), y1 = Math.min(H, y + R + 1), n = box(C, x0, y0, x1, y1); if (n < 20) continue;
      const m = box(I, x0, y0, x1, y1) / n, sd = Math.sqrt(Math.max(0, box(Q, x0, y0, x1, y1) / n - m * m));
      bg[y * W + x] = m; if (sea[y * W + x] && g[y * W + x] < m - Math.max(sens * sd, 4) && g[y * W + x] < m * .75 && g[y * W + x] > 5) dark // >5 excludes no-data / radar shadow
      [y * W + x] = 1;
    }
    // connected components (4-neighbour)
    const lab = new Int32Array(W * H), comps = []; let id = 0;
    for (let s = 0; s < W * H; s++) {
      if (!dark[s] || lab[s]) continue; id++; const st = [s]; lab[s] = id; const p = [];
      while (st.length) { const k = st.pop(); p.push(k); const x = k % W, y = k / W | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const j = ny * W + nx; if (dark[j] && !lab[j]) { lab[j] = id; st.push(j); } } }
      if (p.length > W * H * .0008 && p.length < W * H * .25) comps.push(p); // >25% of frame = water body / no-data, not a slick
    }
    if (!comps.length) return null;
    const near = k => { const x = k % W, y = k / W | 0; for (let j = -4; j <= 4; j += 2) for (let i = -4; i <= 4; i += 2) { const a = x + i, b = y + j; if (a >= 0 && b >= 0 && a < W && b < H && !sea[b * W + a]) return 1; } return 0; };
    comps.forEach(p => { p.coastal = p.reduce((s, k) => s + near(k), 0) / p.length > .35; }); // touching land: radar shadow / wind shelter look-alike
    comps.sort((a, b) => (b.length * (b.coastal ? .25 : 1)) - (a.length * (a.coastal ? .25 : 1))); const p = comps[0], all = comps.slice(0, 8).flat();
    let sx = 0, sy = 0, gm = 0, bm = 0; p.forEach(k => { sx += k % W; sy += k / W | 0; gm += g[k]; bm += bg[k]; });
    const n = p.length, cx = sx / n, cy = sy / n; let mxx = 0, myy = 0, mxy = 0;
    p.forEach(k => { const dx = k % W - cx, dy = (k / W | 0) - cy; mxx += dx * dx; myy += dy * dy; mxy += dx * dy; });
    mxx /= n; myy /= n; mxy /= n; const tr = mxx + myy, dt = Math.sqrt(Math.max(0, (mxx - myy) ** 2 / 4 + mxy * mxy));
    const l1 = tr / 2 + dt, l2 = Math.max(tr / 2 - dt, 1e-6), elong = Math.sqrt(l1 / l2), contrast = 1 - (gm / n) / (bm / n);
    const cls = p.coastal ? ["Coastal look-alike (radar shadow / wind shelter)", "dark patch adjacent to land"] : elong > 2.2 && contrast > .2 ? ["Likely mineral oil", "elongated, high-contrast patch"] : elong < 1.5 ? ["Possible look-alike (low-wind / algal)", "compact, rounded patch"] : ["Ambiguous slick", "moderate shape and contrast"];
    const conf = Math.round(Math.min(88, 38 + contrast * 110 + Math.min(elong, 3) * 6 + Math.min(n / (W * H) * 300, 8)));
    return { cells: all.map(k => [k % W, k / W | 0]), count: Math.min(comps.length, 8), cx: cx * S, cy: cy * S, px: all.length * S * S, elong, contrast, cls: cls[0], clsWhy: cls[1], conf, W: canvas.width, H: canvas.height };
  }

  // 2. Drift backtrace: current + 3% wind (standard windage), uncertainty grows with age
  function drift(d, P) {
    const rad = a => a * Math.PI / 180, ws = P.wind * .03;
    const e = P.cur * Math.sin(rad(P.curDir)) + ws * Math.sin(rad(P.windDir + 180)), n = P.cur * Math.cos(rad(P.curDir)) + ws * Math.cos(rad(P.windDir + 180));
    const sec = P.age * 3600, m = P.res, vx = e / m, vy = -n / m; // px per second (y down)
    const origin = { x: d.cx - vx * sec, y: d.cy - vy * sec }, speed = Math.hypot(e, n);
    return { vx, vy, speed, origin, sigmaPx: (0.2 * speed * sec + 1000) / m, fc: h => ({ x: d.cx + vx * h * 3600, y: d.cy + vy * h * 3600 }) };
  }

  // 3. AIS correlation: interpolate each track to the release time, compare with origin; flag AIS gaps
  function pos(tr, t) { // tr sorted by hours-before-capture desc
    for (let i = 0; i < tr.length - 1; i++) if (t <= tr[i][0] && t >= tr[i + 1][0]) { const f = (tr[i][0] - t) / (tr[i][0] - tr[i + 1][0]); return [tr[i][1] + f * (tr[i + 1][1] - tr[i][1]), tr[i][2] + f * (tr[i + 1][2] - tr[i][2])]; }
    const e = t > tr[0][0] ? tr[0] : tr[tr.length - 1]; return [e[1], e[2]];
  }
  function correlate(vessels, dr, P, d) {
    return vessels.map(v => {
      const [x, y] = pos(v.track, P.age), dist = Math.hypot(x * d.W - dr.origin.x, y * d.H - dr.origin.y);
      let s = Math.exp(-.5 * (dist / dr.sigmaPx) ** 2), gap = v.gap && P.age <= v.gap[0] && P.age >= v.gap[1];
      if (gap) s *= .85;
      if (P.age > v.track[0][0] || P.age < v.track[v.track.length - 1][0]) s *= .4; // track does not cover release time
      const km = dist * P.res / 1000;
      return { ...v, score: Math.round(s * 100), km, gapHit: gap, detail: `${km.toFixed(1)} km from est. origin at release${gap ? " · ⚠ AIS dark period overlaps release (possible switch-off)" : ""}` };
    }).sort((a, b) => b.score - a.score);
  }

  // 4. Exposure: does the 12 h forecast path (+uncertainty) touch each GIS zone?
  function exposure(zones, dr, d, P) {
    const rPx = Math.max(15, Math.sqrt(d.px) / 2), pts = []; for (let h = 0; h <= 12; h += .5) pts.push(dr.fc(h));
    return zones.map(z => { const [x0, y0, x1, y1] = [z.r[0] * d.W, z.r[1] * d.H, z.r[2] * d.W, z.r[3] * d.H];
      const dm = Math.min(...pts.map(p => Math.hypot(Math.max(x0 - p.x, 0, p.x - x1), Math.max(y0 - p.y, 0, p.y - y1))));
      const hit = pts.find(p => Math.hypot(Math.max(x0 - p.x, 0, p.x - x1), Math.max(y0 - p.y, 0, p.y - y1)) <= rPx);
      return { ...z, hit: !!hit, hours: hit ? pts.indexOf(hit) / 2 : null, km: dm * P.res / 1000 }; });
  }
  // Real AIS CSV: name,mmsi,type,time_utc,lat,lon -> normalised scene tracks via scene georeference
  function parseCSV(txt) {
    const rows = txt.trim().split(/\r?\n/).map(r => r.split(",").map(x => x.trim())), h = rows.shift().map(x => x.toLowerCase()), ix = k => h.indexOf(k), m = {};
    if (["mmsi", "time_utc", "lat", "lon"].some(k => ix(k) < 0)) throw new Error("CSV needs columns: name,mmsi,type,time_utc,lat,lon");
    rows.forEach(r => { const t = Date.parse(r[ix("time_utc")]), la = +r[ix("lat")], lo = +r[ix("lon")]; if (isNaN(t) || isNaN(la) || isNaN(lo)) return;
      (m[r[ix("mmsi")]] ||= { name: r[ix("name")] || r[ix("mmsi")], type: r[ix("type")] || "Vessel", mmsi: r[ix("mmsi")], pts: [] }).pts.push({ t, la, lo }); });
    return Object.values(m).filter(v => v.pts.length > 1);
  }
  function toTracks(list, G, d) { // G: {lat, lon, acq(ms), res}
    return list.map(v => { const pts = v.pts.sort((a, b) => a.t - b.t).map(p => [(G.acq - p.t) / 36e5,
        (d.W / 2 + (p.lo - G.lon) * 111320 * Math.cos(G.lat * Math.PI / 180) / G.res) / d.W, (d.H / 2 - (p.la - G.lat) * 110574 / G.res) / d.H]);
      let gap = null; for (let i = 0; i < pts.length - 1; i++) if (pts[i][0] - pts[i + 1][0] > 1.5) gap = [pts[i][0], pts[i + 1][0]]; // >1.5 h silence
      return { name: v.name, type: v.type, mmsi: v.mmsi, track: pts, gap }; });
  }
  return { detect, drift, correlate, exposure, parseCSV, toTracks };
})();
