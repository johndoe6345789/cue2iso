# cue2iso

Convert a CD image from **CUE/BIN** to **ISO**, in the browser. The files are read locally with the File API and
**never uploaded**; the server is a static page.

Live: https://cue2iso.wardcrew.com

[![CI](https://github.com/johndoe6345789/cue2iso/actions/workflows/ci.yml/badge.svg)](https://github.com/johndoe6345789/cue2iso/actions/workflows/ci.yml)

## What it does

A raw CD sector is 2352 bytes, of which 2048 are the data. The converter keeps those 2048 bytes of every data-track
sector and drops the sync, header and error-correction bytes.

- Layouts: `MODE1/2352`, `MODE2/2352` (CD-ROM XA form 1), `MODE2/2336`, and 2048-byte tracks.
- Audio tracks are skipped; a cue with several data tracks gives one ISO per track.
- A lone `.bin` works: the sector format is detected from its sync/mode bytes.
- Pregaps (`INDEX 00`) are excluded from the track before them. Multi-file cues, quoted or bare names, BOM and CRLF are handled.
- The result is checked for an ISO 9660 signature at sector 16 and its volume label is shown.
- Not handled: copy-protected discs and bad sectors (no faithful ISO exists), and mixed-mode discs only give the data track.
- Desktop Chrome/Edge stream the ISO straight to disk (File System Access API). Other browsers build it in memory, so a
  700 MB disc needs about that much free RAM.

## Run it

```sh
docker run --rm -p 8080:8080 ghcr.io/johndoe6345789/cue2iso:latest   # http://localhost:8080
```

or `docker compose up -d`. The image is unprivileged nginx on port 8080 with a strict CSP (own scripts only, no network
access from the page), and runs fine read-only with all capabilities dropped (see `compose.yml`).

**CapRover:** deploy this repo (it has a `captain-definition`) or the image above, and set the container HTTP port to 8080.

## Develop

`site/convert.js` is the whole conversion core (a UMD module used by the page and by the tests); `site/app.js` is the UI.
There is no build step. To try it locally: `python3 -m http.server -d site`.

```sh
test/run.sh     # needs Docker
```

The tests build a real ISO 9660 image with xorriso, wrap it into raw MODE1/MODE2 sectors with random junk in the non-data
bytes, and check the converter returns it byte for byte (plus cue parsing edge cases and error paths).

## License

MIT
