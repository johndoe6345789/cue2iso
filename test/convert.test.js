// Run: node convert.test.js <reference.iso>   (the reference is a real ISO 9660 image made by xorriso)
const fs = require("fs"), assert = require("assert"), crypto = require("crypto");
const C = require("../site/convert.js");
const iso = fs.readFileSync(process.argv[2]);
assert.strictEqual(iso.length % 2048, 0);
const sectors = iso.length / 2048;
const SYNC = Buffer.from([0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0]);

// Blob-like wrapper over a Buffer (what File gives the browser).
const blob = (buf) => ({ size: buf.length, slice: (a, b) => ({ arrayBuffer: async () => { const s = buf.subarray(a, b); return s.buffer.slice(s.byteOffset, s.byteOffset + s.length); } }) });
const junk = (n) => crypto.randomBytes(n);

function raw(mode) { // wrap the ISO into raw sectors with random junk around the user data
  const out = [];
  for (let i = 0; i < sectors; i++) {
    const data = iso.subarray(i * 2048, (i + 1) * 2048);
    if (mode === "MODE1/2352") out.push(SYNC, Buffer.from([0, 2, i % 75, 1]), data, junk(288));
    else if (mode === "MODE2/2352") out.push(SYNC, Buffer.from([0, 2, i % 75, 2]), junk(8), data, junk(280));
    else if (mode === "MODE2/2336") out.push(junk(8), data, junk(280));
  }
  return Buffer.concat(out);
}
async function convert(file, plan) {
  const parts = [];
  await C.convertTrack(blob(file), plan, async (b) => parts.push(Buffer.from(b)), null);
  return Buffer.concat(parts);
}
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

for (const mode of ["MODE1/2352", "MODE2/2352", "MODE2/2336"]) {
  test(`${mode} round-trips byte for byte`, async () => {
    const bin = raw(mode);
    const files = C.parseCue(`FILE "disc.bin" BINARY\n  TRACK 01 ${mode}\n    INDEX 01 00:00:00\n`);
    const plans = C.planTracks(files, { "disc.bin": bin.length });
    assert.strictEqual(plans.length, 1);
    assert.strictEqual(plans[0].sectors, sectors);
    const out = await convert(bin, plans[0]);
    assert.ok(out.equals(iso), "output differs from the reference ISO");
    assert.strictEqual(C.isoLabel(new Uint8Array(out.subarray(16 * 2048, 17 * 2048))), C.isoLabel(new Uint8Array(iso.subarray(16 * 2048, 17 * 2048))));
  });
}
test("multi-chunk read, last chunk partial (chunk of 100 sectors over 1649)", async () => {
  for (const mode of ["MODE1/2352", "MODE2/2352"]) {
    const bin = raw(mode), parts = [], calls = [];
    const plan = C.planTracks(C.parseCue(`FILE "a.bin" BINARY\nTRACK 1 ${mode}\nINDEX 01 00:00:00`), { "a.bin": bin.length })[0];
    await C.convertTrack(blob(bin), plan, async (b) => parts.push(Buffer.from(b)), (d, t) => calls.push([d, t]), 100);
    assert.ok(Buffer.concat(parts).equals(iso));
    assert.strictEqual(parts.length, Math.ceil(sectors / 100));
    assert.deepStrictEqual(calls[calls.length - 1], [sectors, sectors]);
  }
});
test("cooked MODE1/2048 is copied unchanged", async () => {
  const plan = C.planTracks(C.parseCue('FILE "a.iso" BINARY\nTRACK 01 MODE1/2048\nINDEX 01 00:00:00'), { "a.iso": iso.length })[0];
  assert.ok((await convert(iso, plan)).equals(iso));
});
test("mixed mode: audio track skipped, data track bounded by the next track's pregap", async () => {
  const data = raw("MODE1/2352"), audio = junk(2352 * 150);
  const bin = Buffer.concat([data, audio]);
  const msf = (s) => `${String(Math.floor(s / 4500)).padStart(2, "0")}:${String(Math.floor(s / 75) % 60).padStart(2, "0")}:${String(s % 75).padStart(2, "0")}`;
  const cue = `﻿FILE "disc.bin" BINARY\r\n  TRACK 01 MODE1/2352\r\n    INDEX 01 00:00:00\r\n  TRACK 02 AUDIO\r\n    INDEX 00 ${msf(sectors)}\r\n    INDEX 01 ${msf(sectors + 150)}\r\n`;
  const plans = C.planTracks(C.parseCue(cue), { "disc.bin": bin.length });
  assert.strictEqual(plans.length, 1);
  assert.strictEqual(plans[0].sectors, sectors);
  assert.ok((await convert(bin, plans[0])).equals(iso));
});
test("two bin files, data track not first, unquoted names", async () => {
  const cue = `FILE a.bin BINARY\nTRACK 01 AUDIO\nINDEX 01 00:00:00\nFILE b.bin BINARY\nTRACK 02 MODE1/2352\nINDEX 01 00:00:00\n`;
  const bin = raw("MODE1/2352");
  const plans = C.planTracks(C.parseCue(cue), { "a.bin": 2352 * 300, "b.bin": bin.length });
  assert.deepStrictEqual(plans.map((p) => [p.track, p.file]), [[2, "b.bin"]]);
  assert.ok((await convert(bin, plans[0])).equals(iso));
});
test("detectLayout recognises sync/mode bytes and cooked images", () => {
  assert.strictEqual(C.detectLayout(raw("MODE1/2352").subarray(0, 16), sectors * 2352), "MODE1/2352");
  assert.strictEqual(C.detectLayout(raw("MODE2/2352").subarray(0, 16), sectors * 2352), "MODE2/2352");
  assert.strictEqual(C.detectLayout(iso.subarray(0, 16), iso.length), "MODE1/2048");
  assert.strictEqual(C.detectLayout(Buffer.alloc(16, 7), 12345), null);
});
test("errors: truncated bin, wrong sector size, missing file, bad cue, bad INDEX", () => {
  const f = C.parseCue('FILE "a.bin" BINARY\nTRACK 01 MODE1/2352\nINDEX 01 00:00:00');
  assert.throws(() => C.planTracks(f, { "a.bin": 0 }), /empty/);
  assert.throws(() => C.planTracks(C.parseCue('FILE "a.bin" BINARY\nTRACK 01 MODE1/2352\nINDEX 01 00:10:00'), { "a.bin": 2352 * 100 }), /empty|past the end/);
  assert.throws(() => C.planTracks(f, {}), /Missing file/);
  assert.throws(() => C.planTracks(C.parseCue('FILE "a.bin" BINARY\nTRACK 01 CDG\nINDEX 01 00:00:00'), { "a.bin": 99999 }), /unsupported/);
  assert.throws(() => C.parseCue("hello world"), /No FILE/);
  assert.throws(() => C.parseCue('FILE "a" BINARY\nTRACK 1 AUDIO\nINDEX 01 0:0:0'), /Bad INDEX/);
  assert.throws(() => C.parseCue('FILE "a" BINARY\nTRACK 1 AUDIO'), /no INDEX 01/);
});
test("a file that shrinks mid-read fails instead of writing a short ISO", async () => {
  const plan = { layout: C.LAYOUTS["MODE1/2352"], startSector: 0, sectors: 10 };
  await assert.rejects(C.convertTrack(blob(Buffer.alloc(2352 * 5)), plan, async () => {}, null), /Short read/);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log("ok   " + name); } catch (e) { failed++; console.log("FAIL " + name + "\n     " + e.message); }
  }
  console.log(failed ? `${failed} FAILED` : `all ${tests.length} passed (${sectors} sectors, ${(iso.length / 1048576).toFixed(1)} MB reference ISO)`);
  process.exit(failed ? 1 : 0);
})();
