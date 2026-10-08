// CUE/BIN -> ISO conversion core. Runs in the browser (File objects) and in Node (tests, Blob-like objects).
// A raw CD sector is 2352 bytes; the ISO keeps only the 2048-byte user data of each data sector.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Cue2Iso = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Sector layouts: bytes per sector in the image, and where the 2048 user bytes start inside one.
  // MODE1/2352: 12 sync + 4 header, data at 16. MODE2/2352 (CD-ROM XA form 1): +8 subheader, data at 24.
  // MODE2/2336 has no sync/header (8 subheader), data at 8. */2048 is already cooked.
  const LAYOUTS = {
    "MODE1/2352": { size: 2352, offset: 16 },
    "MODE1/2048": { size: 2048, offset: 0 },
    "MODE2/2352": { size: 2352, offset: 24 },
    "MODE2/2336": { size: 2336, offset: 8 },
    "MODE2/2048": { size: 2048, offset: 0 },
  };
  const SYNC = [0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00];
  const USER = 2048;
  const CHUNK_SECTORS = 4096; // ~9.6 MB read at a time

  function msfToSector(msf) {
    const m = /^(\d+):(\d{2}):(\d{2})$/.exec(msf);
    if (!m) throw new Error("Bad INDEX time: " + msf);
    return (+m[1] * 60 + +m[2]) * 75 + +m[3];
  }

  // Returns [{file, tracks:[{number, type, start}]}] (start = sector of INDEX 01 within that file).
  function parseCue(text) {
    const files = [];
    let file = null, track = null;
    for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
      const line = raw.trim();
      let m;
      if ((m = /^FILE\s+(?:"([^"]*)"|(\S+))\s+(\S+)/i.exec(line))) {
        file = { name: m[1] !== undefined ? m[1] : m[2], kind: m[3].toUpperCase(), tracks: [] };
        files.push(file); track = null;
      } else if ((m = /^TRACK\s+(\d+)\s+(\S+)/i.exec(line))) {
        if (!file) throw new Error("TRACK before FILE in the cue sheet");
        track = { number: +m[1], type: m[2].toUpperCase(), start: null };
        file.tracks.push(track);
      } else if ((m = /^INDEX\s+(\d+)\s+(\S+)/i.exec(line))) {
        if (!track) throw new Error("INDEX before TRACK in the cue sheet");
        if (+m[1] === 1) track.start = msfToSector(m[2]);
        else if (+m[1] === 0 && track.pregap === undefined) track.pregap = msfToSector(m[2]);
      }
    }
    if (!files.length) throw new Error("No FILE entries found: is this a .cue file?");
    for (const f of files) for (const t of f.tracks) if (t.start === null) throw new Error("Track " + t.number + " has no INDEX 01");
    return files;
  }

  // Guess the layout of a headerless .bin from its first sector(s).
  function detectLayout(head, fileSize) {
    const hasSync = SYNC.every((b, i) => head[i] === b);
    if (hasSync && fileSize % 2352 === 0) {
      const mode = head[15];
      if (mode === 1) return "MODE1/2352";
      if (mode === 2) return "MODE2/2352";
    }
    if (fileSize % 2048 === 0) return "MODE1/2048";
    return null;
  }

  // Plan the ISOs for a parsed cue: one entry per data track, with its byte range in its file.
  // `sizes` maps FILE name -> byte length.
  function planTracks(files, sizes) {
    const plans = [];
    for (const f of files) {
      const size = sizes[f.name];
      if (size === undefined) throw new Error("Missing file: " + f.name);
      f.tracks.forEach((t, i) => {
        if (t.type === "AUDIO") return;
        const layout = LAYOUTS[t.type];
        if (!layout) throw new Error("Track " + t.number + ": unsupported type " + t.type);
        const next = f.tracks[i + 1];
        const endSector = next ? (next.pregap !== undefined ? next.pregap : next.start) : Math.floor(size / layout.size);
        const sectors = endSector - t.start;
        if (sectors <= 0) throw new Error("Track " + t.number + " is empty");
        if ((t.start + sectors) * layout.size > size) throw new Error("Track " + t.number + " runs past the end of " + f.name + " (wrong sector size or truncated file)");
        plans.push({ track: t.number, file: f.name, type: t.type, layout, startSector: t.start, sectors });
      });
    }
    return plans;
  }

  // Copy the user data of `plan.sectors` sectors from `file` to write(Uint8Array). Calls progress(done, total).
  async function convertTrack(file, plan, write, progress, chunkSectors) {
    const chunk = chunkSectors || CHUNK_SECTORS;
    const { size, offset } = plan.layout;
    let done = 0;
    while (done < plan.sectors) {
      const n = Math.min(chunk, plan.sectors - done);
      const from = (plan.startSector + done) * size;
      const buf = new Uint8Array(await file.slice(from, from + n * size).arrayBuffer());
      if (buf.length !== n * size) throw new Error("Short read: the file changed or is truncated");
      let out;
      if (size === USER) out = buf;
      else {
        out = new Uint8Array(n * USER);
        for (let i = 0; i < n; i++) out.set(buf.subarray(i * size + offset, i * size + offset + USER), i * USER);
      }
      await write(out);
      done += n;
      if (progress) progress(done, plan.sectors);
    }
  }

  // ISO 9660: sector 16 holds a volume descriptor "\x01CD001". Returns the volume label or null.
  function isoLabel(sector16) {
    const s = String.fromCharCode.apply(null, sector16.subarray(1, 6));
    if (s !== "CD001") return null;
    return String.fromCharCode.apply(null, sector16.subarray(40, 72)).trim();
  }

  return { LAYOUTS, CHUNK_SECTORS, parseCue, detectLayout, planTracks, convertTrack, isoLabel, msfToSector };
});
