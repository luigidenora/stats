---
version: 1
slug: "src-overlay-ts"
primary_target: "src/overlay.ts"
related_targets: ["src/styles.ts","src/glyphs.ts"]
---

# Surface: stats overlay

Mode: Operate. Overlay over a live three.js canvas; developers glance, then return to the scene. Only overlay elements take the pointer (tooltips, DISP, page toggles); empty areas leave canvas events untouched.

Confirmed with the user: readouts top-left on one row; counters bottom-left; backend plate, page toggles and DISP bottom-right; mode graphs bottom-centre (top, under the readouts, on narrow screens); centre always free. DISP cycles display modes (Simple, Performance, Mesh & instances, Memory, Image, Info, custom, Off) and remembers the choice. Every new component obeys the same rules: grid cell, spacing scale, exit past the nearest edge, hidden in Off. References live in `.impeccable/reference/` (gitignored, never shipped, never named).

## Direction contract

THESIS: A camera display for a render loop: indicators hug the frame edges, the image owns the centre, DISP changes what is shown. Refuses the stats.js box, the dashboard card, the gamer HUD and the inspector tree.
OWN-WORLD: White condensed tabular numerals with a 1px dark contour (text-stroke; geometry for glyphs and graphs), no panels; dark plates with a 1px white border; scrolling time graphs and additive R/G/B histograms where channels meet in white; yellow only for alerts and current choice; red only for out-of-range; series colours on labels only while their graph is visible.
STORY: The developer reads FPS and ms in under a second, notices only what turns yellow, switches mode with DISP for the job at hand, and forgets the overlay otherwise.
FIRST VIEWPORT: Simple mode: top-left one row FPS · MS CPU · MS GPU · MB HEAP; bottom-left glyph counter grid; bottom-right GL2 · DISP STD. Performance adds frame/CPU/GPU graphs bottom-centre; Image and Info add the large RGB histogram top-left; Info shrinks the canvas to a thumbnail with key/value pages on the right.
FORM: pinned whole by the user (camera-like minimal technical readout over the canvas). seed: none (pinned) — "the style is a minimal, technical, simple and well-structured interface, so it never pulls attention away from the main canvas"
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
