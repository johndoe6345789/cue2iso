(function () {
  "use strict";
  const C = window.Cue2Iso;
  const $ = (id) => document.getElementById(id);
  const input = $("files"), drop = $("drop"), msg = $("message"), list = $("tracks");
  const canStream = typeof window.showSaveFilePicker === "function";
  let busy = false;

  function say(text, err) { msg.textContent = text; msg.className = err ? "err" : ""; }
  const base = (n) => n.replace(/^.*[\\/]/, "");
  const stem = (n) => base(n).replace(/\.[^.]*$/, "");
  const mb = (n) => (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + " MB";

  async function handle(fileList) {
    list.textContent = "";
    const files = Array.from(fileList);
    if (!files.length) return say("");
    try {
      const cue = files.find((f) => /\.cue$/i.test(f.name));
      const byName = new Map(files.filter((f) => f !== cue).map((f) => [base(f.name).toLowerCase(), f]));
      let plans = [], title;
      if (cue) {
        title = stem(cue.name);
        const parsed = C.parseCue(await cue.text());
        const sizes = {}, missing = [];
        for (const pf of parsed) {
          const f = byName.get(base(pf.name).toLowerCase());
          if (f) { sizes[pf.name] = f.size; pf.blob = f; } else missing.push(base(pf.name));
        }
        if (missing.length) return say("The cue names files you haven't selected: " + missing.join(", ") + ". Select them together with the .cue.", true);
        plans = C.planTracks(parsed, sizes).map((p) => Object.assign(p, { blob: parsed.find((x) => x.name === p.file).blob }));
        if (!plans.length) return say("This cue has no data tracks (audio only), so there is nothing to put in an ISO.", true);
      } else {
        const bin = files.find((f) => /\.(bin|img)$/i.test(f.name)) || files[0];
        title = stem(bin.name);
        const head = new Uint8Array(await bin.slice(0, 16).arrayBuffer());
        const type = C.detectLayout(head, bin.size);
        if (!type) return say("Can't tell the sector format of " + bin.name + ". Add its .cue file.", true);
        const layout = C.LAYOUTS[type];
        plans = [{ track: 1, file: bin.name, type, layout, startSector: 0, sectors: Math.floor(bin.size / layout.size), blob: bin }];
      }
      say(plans.length + " data track" + (plans.length > 1 ? "s" : "") + " found. Press Convert.");
      plans.forEach((p) => list.appendChild(card(p, plans.length > 1 ? title + "-track" + String(p.track).padStart(2, "0") : title)));
    } catch (e) { say(e.message, true); }
  }

  function card(plan, name) {
    const li = document.createElement("li"); li.className = "track";
    const h = document.createElement("h2"); h.textContent = name + ".iso";
    const meta = document.createElement("p"); meta.className = "meta";
    meta.textContent = "Track " + plan.track + ", " + plan.type + ", from " + base(plan.file) + ", " + mb(plan.sectors * 2048);
    const row = document.createElement("div"); row.className = "row";
    const btn = document.createElement("button"); btn.type = "button"; btn.textContent = "Convert";
    const bar = document.createElement("progress"); bar.max = 1; bar.value = 0; bar.hidden = true;
    const st = document.createElement("span"); st.className = "status";
    row.append(btn, bar, st); li.append(h, meta, row);
    btn.addEventListener("click", () => run(plan, name + ".iso", btn, bar, st, row));
    return li;
  }

  async function run(plan, outName, btn, bar, st, row) {
    if (busy) return;
    busy = true; btn.disabled = true; bar.hidden = false; st.className = "status"; st.textContent = "";
    try {
      let sink, chunks = [], writable = null;
      if (canStream) {
        const handle = await window.showSaveFilePicker({ suggestedName: outName, types: [{ description: "ISO image", accept: { "application/x-iso9660-image": [".iso"] } }] });
        writable = await handle.createWritable();
      }
      const head = new Uint8Array(17 * 2048); let have = 0;
      sink = async (buf) => {
        if (have < head.length) { const n = Math.min(buf.length, head.length - have); head.set(buf.subarray(0, n), have); have += n; }
        if (writable) await writable.write(buf); else chunks.push(buf);
      };
      await C.convertTrack(plan.blob, plan, sink, (d, t) => { bar.value = d / t; st.textContent = Math.round((d / t) * 100) + "%"; });
      if (writable) await writable.close();
      const label = have >= head.length ? C.isoLabel(head.subarray(16 * 2048)) : null;
      st.className = "status " + (label !== null ? "ok" : "");
      st.textContent = label !== null ? "Done. Valid ISO 9660" + (label ? ', volume "' + label + '".' : ".")
        : "Done, but there's no ISO 9660 signature at sector 16. The disc may use another filesystem (UDF, HFS, audio-only data).";
      if (!writable) {
        const url = URL.createObjectURL(new Blob(chunks, { type: "application/x-iso9660-image" }));
        const a = document.createElement("a"); a.className = "btn"; a.href = url; a.download = outName; a.textContent = "Download " + outName;
        row.appendChild(a);
      }
      bar.hidden = true;
    } catch (e) {
      if (e && e.name === "AbortError") { st.textContent = "Cancelled."; }
      else { st.className = "status err"; st.textContent = e && e.name === "QuotaExceededError" || /memory|allocation/i.test(String(e && e.message))
        ? "Ran out of memory building the ISO. Use desktop Chrome or Edge, which save straight to disk." : String(e && e.message || e); }
      bar.hidden = true; btn.disabled = false;
    } finally { busy = false; }
  }

  input.addEventListener("change", () => handle(input.files));
  ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => { if (e.dataTransfer) handle(e.dataTransfer.files); });
})();
