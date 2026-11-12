// Regenerates every logo file in brand/svg from geometry.mjs.
// Run: node brand/build-svgs.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { COLORS as C, SYMBOL_M, holes, ticket, wordmark } from "./geometry.mjs";

const out = join(dirname(fileURLToPath(import.meta.url)), "svg");
mkdirSync(out, { recursive: true });

const svg = (viewBox, body, extra = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"${extra}>${body}</svg>\n`;

const wm = wordmark();
const T = ticket(6);
const H = holes();

// Symbol, knocked out: one colour, the m and the perforation are holes.
export const symbolKnockout = (fill) => `<path fill="${fill}" fill-rule="evenodd" d="${T}${H}${SYMBOL_M}"/>`;
// Symbol, two colours: paper ticket, ink m.
export const symbolTwoTone = (paper, ink) =>
  `<path fill="${paper}" fill-rule="evenodd" d="${T}${H}"/><path fill="${ink}" d="${SYMBOL_M}"/>`;
export const wordmarkPaths = (fill, dot = fill) =>
  `<path fill="${fill}" fill-rule="evenodd" d="${wm.body}"/><path fill="${dot}" d="${wm.dot}"/>`;

const SYM_VB = "22 12 76 96";
const WM_VB = `0 ${wm.top} ${Math.round(wm.width * 100) / 100} ${Math.round((wm.bottom - wm.top) * 100) / 100}`;

// Horizontal lockup: wordmark at 1.2x, x-height centred on the ticket.
const hs = 1.05;
const hx = 120;
const hy = 60 - 40 * hs;
const H_VB = `22 12 ${Math.round((hx + wm.width * hs - 22) * 100) / 100} 96`;
const lockupH = (sym, word) =>
  `${sym}<g transform="translate(${hx} ${hy}) scale(${hs})">${word}</g>`;

// Stacked lockup: wordmark at 0.75x, centred under the ticket.
const ss = 0.75;
const sx = 60 - (wm.width * ss) / 2;
const sy = 122 - wm.top * ss;
const sBottom = wm.bottom * ss + sy;
const S_VB = `${Math.round(sx * 100) / 100} 12 ${Math.round(wm.width * ss * 100) / 100} ${Math.round((sBottom - 12) * 100) / 100}`;
const lockupS = (sym, word) =>
  `${sym}<g transform="translate(${Math.round(sx * 100) / 100} ${sy}) scale(${ss})">${word}</g>`;

export const LAYOUT = { SYM_VB, WM_VB, H_VB, S_VB, hs, hx, hy, ss, sx, sy };
export const lockups = { lockupH, lockupS };

const files = {
  "menucito-symbol-birome.svg": svg(SYM_VB, symbolKnockout(C.birome)),
  "menucito-symbol-papel.svg": svg(SYM_VB, symbolKnockout(C.papel)),
  "menucito-symbol-carbon.svg": svg(SYM_VB, symbolKnockout(C.carbon)),
  "menucito-symbol-two-tone.svg": svg(SYM_VB, symbolTwoTone(C.papel, C.birome)),
  "menucito-favicon.svg": svg(
    "0 0 32 32",
    `<rect width="32" height="32" fill="${C.birome}"/><g transform="translate(-2 -2) scale(0.3)"><path fill="${C.papel}" d="${ticket(4)}"/><path fill="${C.birome}" d="${SYMBOL_M}"/></g>`,
  ),
  "menucito-avatar-1080.svg": svg(
    "0 0 1080 1080",
    `<rect width="1080" height="1080" fill="${C.birome}"/><g transform="translate(120 120) scale(7)">${symbolTwoTone(C.papel, C.birome)}</g>`,
  ),
  "menucito-wordmark-birome.svg": svg(WM_VB, wordmarkPaths(C.birome)),
  "menucito-wordmark-papel.svg": svg(WM_VB, wordmarkPaths(C.papel)),
  "menucito-wordmark-carbon.svg": svg(WM_VB, wordmarkPaths(C.carbon)),
  "menucito-lockup-horizontal.svg": svg(H_VB, lockupH(symbolKnockout(C.birome), wordmarkPaths(C.birome, C.sello))),
  "menucito-lockup-horizontal-papel.svg": svg(H_VB, lockupH(symbolKnockout(C.papel), wordmarkPaths(C.papel))),
  "menucito-lockup-stacked.svg": svg(S_VB, lockupS(symbolKnockout(C.birome), wordmarkPaths(C.birome, C.sello))),
  "menucito-lockup-stacked-papel.svg": svg(S_VB, lockupS(symbolKnockout(C.papel), wordmarkPaths(C.papel))),
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [name, content] of Object.entries(files)) writeFileSync(join(out, name), content);
  console.log(`wrote ${Object.keys(files).length} files to ${out}`);
}
