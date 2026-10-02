/* Run with:  node tests/engine.test.js   (no dependencies; uses a tiny canvas mock) */
const assert = require("assert");
const Engine = require("../engine.js");
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log("  ok  " + name); } catch (e) { console.error("FAIL  " + name + "\n      " + e.message); process.exitCode = 1; } };

/* ---- minimal canvas mock: engine only needs createElement('canvas'), drawImage (down-scale) and getImageData ---- */
function makeCanvas(W, H, fn) { // fn(x,y) -> grey value 0-255
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = fn(x, y), i = 4 * (y * W + x); data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255; }
  return { width: W, height: H, data };
}
global.document = { createElement: () => { const c = { width: 0, height: 0, getContext: () => ({ imageSmoothingQuality: "", drawImage(src, _x, _y, w, h) { // box-average src into this canvas
  const out = new Uint8ClampedArray(w * h * 4), fx = src.width / w, fy = src.height / h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, n = 0; for (let j = 0; j < fy; j++) for (let i = 0; i < fx; i++) { s += src.data[4 * (((y * fy + j) | 0) * src.width + ((x * fx + i) | 0))]; n++; } const o = 4 * (y * w + x); out[o] = out[o + 1] = out[o + 2] = s / n; out[o + 3] = 255; }
  c.data = out; }, getImageData: () => ({ data: c.data }) }) }; return c; } };

// noisy mid-grey "sea" with an elongated dark slick centred at (600,300), plus optional letterbox bars
const rng = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
const sea = (x, y, bars) => { if (bars && (x < bars || x >= 1200 - bars)) return 18; const dx = (x - 600) / 140, dy = (y - 300) / 30; return dx * dx + dy * dy < 1 ? 38 : 110 + (rng() - .5) * 14; };
const R = { x: 0, y: 0, w: 1200, h: 600 };

console.log("detect()");
test("finds the dark slick near its true centre and calls it an elongated oil-like patch", () => {
  const d = Engine.detect(makeCanvas(1200, 600, (x, y) => sea(x, y, 0)), 1, R);
  assert(d && !d.invalid, "no detection"); assert(Math.abs(d.cx - 600) < 20 && Math.abs(d.cy - 300) < 20, `centroid ${d.cx},${d.cy}`);
  assert(d.elong > 2.2, "elongation " + d.elong); assert(d.cls === "Likely mineral oil", d.cls);
});
test("letterbox bars outside the image rectangle are NOT reported as slicks", () => {
  const bars = 230, rect = { x: bars, y: 0, w: 1200 - 2 * bars, h: 600 };
  const d = Engine.detect(makeCanvas(1200, 600, (x, y) => sea(x, y, bars)), 1, rect);
  assert(d && !d.invalid); assert(d.cx > bars && d.cx < 1200 - bars, "centroid inside image"); assert(d.count === 1, "regions: " + d.count);
});
test("higher sensitivity never detects fewer pixels than lower sensitivity", () => {
  const c = makeCanvas(1200, 600, (x, y) => sea(x, y, 0));
  const lo = Engine.detect(c, .5, R), hi = Engine.detect(c, 2, R); assert(lo && hi && hi.px >= lo.px, `low ${lo.px} vs high ${hi.px}`);
});
test("uniform scene reports no slick", () => assert.strictEqual(Engine.detect(makeCanvas(1200, 600, () => 100), 1, R), null));

console.log("drift()");
const D = { cx: 600, cy: 300, px: 20000, W: 1200, H: 600 };
test("current-only drift to the east backtraces the origin to the west", () => {
  const dr = Engine.drift(D, { wind: 0, windDir: 0, cur: .5, curDir: 90, age: 2, res: 40 });
  assert(Math.abs(dr.bearing - 90) < 1e-6); assert(dr.origin.x < D.cx && Math.abs(dr.origin.y - D.cy) < 1e-6);
  assert(Math.abs((D.cx - dr.origin.x) * 40 - .5 * 2 * 3600) < 1e-6, "distance = speed x time");
});
test("wind 'from' north pushes oil south (3% windage)", () => {
  const dr = Engine.drift(D, { wind: 10, windDir: 0, cur: 0, curDir: 0, age: 1, res: 40 });
  assert(Math.abs(dr.bearing - 180) < 1e-6); assert(Math.abs(dr.speed - .3) < 1e-9);
});
test("forecast path moves the way the backtrace came from", () => {
  const dr = Engine.drift(D, { wind: 5, windDir: 300, cur: .4, curDir: 120, age: 3, res: 40 }), f = dr.fc(3);
  assert(Math.abs((f.x - D.cx) + (dr.origin.x - D.cx)) < 1e-6 && Math.abs((f.y - D.cy) + (dr.origin.y - D.cy)) < 1e-6);
});

console.log("AIS correlation / exposure");
test("pos() interpolates and clamps to the track ends; zero-length segments do not give NaN", () => {
  const tr = [[4, .2, .2], [2, .4, .6], [0, .6, .2]];
  assert.deepStrictEqual(Engine.pos(tr, 3).map(v => +v.toFixed(3)), [.3, .4]); assert.deepStrictEqual(Engine.pos(tr, 9), [.2, .2]); assert.deepStrictEqual(Engine.pos(tr, -1), [.6, .2]);
  assert(Engine.pos([[2, .1, .1], [2, .5, .5], [0, .9, .9]], 2).every(Number.isFinite));
});
test("vessel sitting on the origin outranks a distant one; dark period overlapping release is flagged", () => {
  const P = { wind: 0, windDir: 0, cur: .5, curDir: 90, age: 2, res: 40 }, dr = Engine.drift(D, P), ox = dr.origin.x / D.W, oy = dr.origin.y / D.H;
  const out = Engine.correlate([{ name: "far", mmsi: "1", track: [[4, .05, .9], [0, .05, .9]] }, { name: "near", mmsi: "2", track: [[4, ox, oy], [0, ox, oy]], gap: [3, 1] }], dr, P, D);
  assert.strictEqual(out[0].name, "near"); assert(out[0].score >= 80 && out[1].score < 5); assert(out[0].gapHit === true);
});
test("exposure: zone on the forecast path is hit with a sensible lead time, a far zone is not", () => {
  const P = { wind: 0, windDir: 0, cur: .5, curDir: 90, age: 2, res: 40 }, dr = Engine.drift(D, P);
  const ex = Engine.exposure([{ name: "ahead", type: "protected", r: [.7, .4, .8, .6] }, { name: "behind", type: "fishing", r: [0, 0, .1, .1] }], dr, D, P);
  assert(ex[0].hit && ex[0].hours > 0 && ex[0].hours < 12); assert(!ex[1].hit && ex[1].hours === null);
});

console.log("AIS CSV parsing");
test("parseUTC treats zone-less timestamps as UTC and rejects junk", () => {
  assert.strictEqual(Engine.parseUTC("2026-10-01 13:10:00"), Date.UTC(2026, 9, 1, 13, 10, 0)); assert.strictEqual(Engine.parseUTC("2026-10-01T13:10Z"), Date.UTC(2026, 9, 1, 13, 10, 0)); assert(Number.isNaN(Engine.parseUTC("not a date")));
});
test("parseCSV handles BOM, quoted commas, blank lat/lon (must not become 0) and duplicate rows", () => {
  const csv = "\uFEFFname,mmsi,type,time_utc,lat,lon\r\n\"MV Foo, Bar\",111,Tanker,2026-10-01 10:00:00,15.4,67.8\r\n\"MV Foo, Bar\",111,Tanker,2026-10-01 12:00:00,15.5,67.9\r\n\"MV Foo, Bar\",111,Tanker,2026-10-01 12:00:00,15.5,67.9\r\nBad,222,Tanker,2026-10-01 10:00:00,,67.8\r\nBad,222,Tanker,2026-10-01 11:00:00,15.1,\r\nOut,333,Tanker,2026-10-01 10:00:00,95,10\r\n";
  const v = Engine.parseCSV(csv); assert.strictEqual(v.length, 1); assert.strictEqual(v[0].name, "MV Foo, Bar"); assert.strictEqual(v[0].pts.length, 2);
});
test("parseCSV rejects files missing required columns", () => assert.throws(() => Engine.parseCSV("a,b\n1,2"), /needs columns/));
test("toTracks places the scene centre at 0.5/0.5 and keeps every >1.5 h silence", () => {
  const acq = Date.UTC(2026, 9, 1, 21, 0), pts = [0, 3, 3.5, 7].map((h, i) => ({ t: acq - (7 - h) * 36e5 - 0, la: 15.5, lo: 68 }));
  const tr = Engine.toTracks([{ name: "n", type: "t", mmsi: "1", pts: [{ t: acq - 8 * 36e5, la: 15.5, lo: 68 }, { t: acq - 5 * 36e5, la: 15.5, lo: 68 }, { t: acq - 4.5 * 36e5, la: 15.5, lo: 68 }, { t: acq - 1 * 36e5, la: 15.5, lo: 68 }] }], { lat: 15.5, lon: 68, res: 40, acq }, D)[0];
  assert(Math.abs(tr.track[0][1] - .5) < 1e-9 && Math.abs(tr.track[0][2] - .5) < 1e-9); assert.strictEqual(tr.gaps.length, 2);
});

console.log(`\n${passed} tests passed` + (process.exitCode ? " — WITH FAILURES" : ""));
