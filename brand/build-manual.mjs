// Builds brand/manual.html (the published brand manual) from the same geometry as the SVG files.
// Run: node brand/build-manual.mjs
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { COLORS as C, SYMBOL_M, contrast, ticket } from "./geometry.mjs";
import { LAYOUT as L, lockups, symbolKnockout, symbolTwoTone, wordmarkPaths } from "./build-svgs.mjs";

const here = dirname(fileURLToPath(import.meta.url));

const sym = (cls = "", label = "Símbolo de Menucito") =>
  `<svg class="${cls}" viewBox="${L.SYM_VB}" role="img" aria-label="${label}">${symbolKnockout("currentColor")}</svg>`;
const sym2 = (cls = "", paper = C.papel, ink = C.birome) =>
  `<svg class="${cls}" viewBox="${L.SYM_VB}" role="img" aria-label="Símbolo de Menucito">${symbolTwoTone(paper, ink)}</svg>`;
const word = (cls = "", dot = "currentColor") =>
  `<svg class="${cls}" viewBox="${L.WM_VB}" role="img" aria-label="menucito">${wordmarkPaths("currentColor", dot)}</svg>`;
const lockH = (cls = "", dot = "currentColor") =>
  `<svg class="${cls}" viewBox="${L.H_VB}" role="img" aria-label="Menucito">${lockups.lockupH(symbolKnockout("currentColor"), wordmarkPaths("currentColor", dot))}</svg>`;
const lockS = (cls = "", dot = "currentColor") =>
  `<svg class="${cls}" viewBox="${L.S_VB}" role="img" aria-label="Menucito">${lockups.lockupS(symbolKnockout("currentColor"), wordmarkPaths("currentColor", dot))}</svg>`;
const favicon = (size) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 32 32" role="img" aria-label="Favicon"><rect width="32" height="32" fill="${C.birome}"/><g transform="translate(-2 -2) scale(0.3)"><path fill="${C.papel}" d="${ticket(4)}"/><path fill="${C.birome}" d="${SYMBOL_M}"/></g></svg>`;
const avatar = (cls = "") =>
  `<svg class="${cls}" viewBox="0 0 1080 1080" role="img" aria-label="Foto de perfil"><rect width="1080" height="1080" fill="${C.birome}"/><g transform="translate(120 120) scale(7)">${symbolTwoTone(C.papel, C.birome)}</g></svg>`;

const PALETTE = [
  ["Birome", C.birome, "Primario", "La tinta de la birome con la que el mozo anota. Logo, botones, titulares, fondo de piezas fuertes.", "papel"],
  ["Papel", C.papel, "Fondo", "El papel del talonario y del ticket térmico. Fondo general; nunca crema.", "carbon"],
  ["Carbón", C.carbon, "Texto", "Texto largo, precios, modo oscuro. Negro con un toque de tinta.", "papel"],
  ["Sello", C.sello, "Acento", "El sello de goma: Agotado, Pagado, Nuevo. Poco y en momentos puntuales.", "papel"],
  ["Duplicado", C.duplicado, "Resaltado", "La copia amarilla del talonario. Tips, stickers, destacados.", "carbon"],
  ["Calco", C.calco, "Superficie", "La tinta que pasa al duplicado. Fondos secundarios, chips, estados suaves.", "carbon"],
];
const fg = { papel: C.papel, carbon: C.carbon };

const PAIRS = [
  ["Papel", "Birome"],
  ["Birome", "Papel"],
  ["Carbón", "Papel"],
  ["Birome", "Duplicado"],
  ["Carbón", "Duplicado"],
  ["Sello", "Papel"],
  ["Papel", "Sello"],
  ["Birome", "Calco"],
  ["Papel", "Carbón"],
];
const hexOf = Object.fromEntries(PALETTE.map((p) => [p[0], p[1]]));
const pairRows = PAIRS.map(([t, b]) => {
  const ratio = contrast(hexOf[t], hexOf[b]);
  const grade = ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : ratio >= 3 ? "Solo texto grande" : "No usar para texto";
  return `<tr><td><span class="pair" style="background:${hexOf[b]};color:${hexOf[t]}">Agotado $4.800</span></td><td>${t} sobre ${b}</td><td class="num">${ratio.toFixed(1)}:1</td><td>${grade}</td></tr>`;
}).join("");

const swatches = PALETTE.map(
  ([name, hex, role, desc, on]) => `
  <article class="sw">
    <div class="sw-chip" style="background:${hex};color:${fg[on]}"><span>${name}</span></div>
    <div class="sw-meta"><b>${role}</b><code>${hex}</code></div>
    <p>${desc}</p>
  </article>`,
).join("");

const css = /* css */ `
/* Layout: one long comanda. A narrow reading column for text, wide plates for marks and mockups. */
:root{
  --bg:#F2F3EF; --surface:#FFFFFF; --fg:#121528; --muted:#4B5068; --line:#D5D8E2; --accent:#2433C2; --on-accent:#F2F3EF; --stamp:#C9213A; --plate:#E6E8EF;
  --b-birome:${C.birome}; --b-papel:${C.papel}; --b-carbon:${C.carbon}; --b-sello:${C.sello}; --b-duplicado:${C.duplicado}; --b-calco:${C.calco};
  --f-display:"Archivo","Arial Black",system-ui,sans-serif;
  --f-body:"Instrument Sans",system-ui,-apple-system,"Segoe UI",sans-serif;
  --f-mono:"IBM Plex Mono",ui-monospace,"Cascadia Mono",Consolas,monospace;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#0E1122;--surface:#161A31;--fg:#EEF0EA;--muted:#A6ABC4;--line:#2A2F4B;--accent:#9AA5FF;--on-accent:#0E1122;--stamp:#FF6B7D;--plate:#1C2140;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#0E1122;--surface:#161A31;--fg:#EEF0EA;--muted:#A6ABC4;--line:#2A2F4B;--accent:#9AA5FF;--on-accent:#0E1122;--stamp:#FF6B7D;--plate:#1C2140;color-scheme:dark}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--fg);font-family:var(--f-body);font-size:17px;line-height:1.55;-webkit-font-smoothing:antialiased}
.wrap{max-width:1120px;margin:0 auto;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
h1,h2,h3{font-family:var(--f-display);font-stretch:125%;line-height:1.02;text-wrap:balance;margin:0}
h2{font-size:clamp(30px,4.6vw,52px);font-weight:800;letter-spacing:-.01em}
h3{font-size:20px;font-weight:750;font-stretch:112%;margin-bottom:6px}
p{margin:0;max-width:64ch}
code,.mono{font-family:var(--f-mono)}
.eyebrow{font-family:var(--f-mono);font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.lead{font-size:20px;color:var(--fg)}
.muted{color:var(--muted)}
section{padding-block:72px;border-top:1px dashed var(--line)}
.sec-head{display:grid;gap:14px;margin-bottom:36px}
.grid{display:grid;gap:20px}
.g2{grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr))}
.g3{grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr))}
.g4{grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr))}
.stack{display:grid;gap:10px;min-width:0}
.plate{background:var(--plate);display:grid;place-items:center;padding:36px;min-height:220px;border-radius:2px}
.plate.b{background:var(--b-birome);color:var(--b-papel)}
.plate.p{background:var(--b-papel);color:var(--b-birome)}
.plate.k{background:var(--b-carbon);color:var(--b-papel)}
.plate.y{background:var(--b-duplicado);color:var(--b-carbon)}
.cap{font-size:14px;color:var(--muted)}
.cap b{color:var(--fg);font-weight:600}
a{color:var(--accent)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

/* Top */
.top{padding-block:28px 0;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
.top .lk{height:34px;color:var(--accent)}
.hero{padding-block:56px 80px;display:grid;gap:40px;grid-template-columns:repeat(auto-fit,minmax(min(100%,440px),1fr));align-items:center}
.hero h1{font-size:clamp(40px,7vw,88px);font-weight:850;letter-spacing:-.015em}
.hero h1 em{font-style:normal;color:var(--accent)}
.hero .stack{gap:22px}
.facts{display:flex;flex-wrap:wrap;gap:8px 18px;font-family:var(--f-mono);font-size:13px;color:var(--muted)}

/* Ticket + stamp, shared by manual and mockups */
.tk{--z:14px;--hole:var(--b-birome);background:var(--b-papel);color:var(--b-carbon);font-family:var(--f-mono);padding:22px 22px calc(22px + var(--z));
  -webkit-mask:conic-gradient(from -45deg at bottom,#0000,#000 1deg 89deg,#0000 90deg) 50%/var(--z) 100%;mask:conic-gradient(from -45deg at bottom,#0000,#000 1deg 89deg,#0000 90deg) 50%/var(--z) 100%}
.perf{height:8px;margin:0 -6px 16px;background:radial-gradient(circle,var(--hole) 0 3px,transparent 3.5px) 0 50%/14px 8px repeat-x}
.tk-row{display:flex;gap:8px;align-items:baseline}
.tk-row .dots{flex:1;border-bottom:2px dotted currentColor;opacity:.35;transform:translateY(-4px);min-width:12px}
.tk-row .q{min-width:2.2ch}
.tk hr{border:0;border-top:2px dashed currentColor;opacity:.4;margin:12px 0}
.stamp{display:inline-block;font-family:var(--f-display);font-stretch:125%;font-weight:900;text-transform:uppercase;color:var(--b-sello);border:3px solid currentColor;outline:1.5px solid currentColor;outline-offset:3px;padding:4px 12px;border-radius:4px;letter-spacing:.04em;transform:rotate(-9deg)}
.hero-tk{position:relative;max-width:420px;justify-self:center;width:100%;filter:drop-shadow(0 18px 30px rgba(18,21,40,.18))}
.hero-tk .tk{font-size:15px;transform:rotate(-1.5deg)}
.hero-tk .stamp{position:absolute;right:-6px;bottom:84px;font-size:34px;mix-blend-mode:multiply}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .hero-tk .stamp{mix-blend-mode:normal}}
:root[data-theme="dark"] .hero-tk .stamp{mix-blend-mode:normal}

/* Directions */
.dir{border:1px solid var(--line);padding:22px;display:grid;gap:12px;background:var(--surface);align-content:start}
.dir.rec{border:2px solid var(--accent)}
.dir .tag{font-family:var(--f-mono);font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--accent)}
.chips{display:flex;gap:6px}
.chips i{width:28px;height:28px;display:block;border:1px solid rgba(0,0,0,.08)}

/* Logo */
.bigsym{width:min(260px,60vw);color:var(--b-birome)}
.anat{display:grid;gap:10px;align-content:center}
.anat li{margin-bottom:6px}
.anat ol{margin:0;padding-left:20px;max-width:56ch}
.lk-h{width:min(100%,460px)}
.lk-s{width:min(100%,220px)}
.lk-sym{width:110px}
.wm{width:min(100%,520px)}
.sizes{display:flex;align-items:flex-end;gap:28px;flex-wrap:wrap;color:var(--b-birome)}
.sizes figure{margin:0;display:grid;gap:8px;justify-items:start}
.sizes figcaption{font-family:var(--f-mono);font-size:12px;color:var(--muted)}
.dd{display:grid;gap:8px}
.dd .plate{min-height:150px;padding:24px;position:relative;overflow:hidden}
.dd .plate svg{width:72px}
.verdict{font-family:var(--f-mono);font-size:12px;letter-spacing:.06em;text-transform:uppercase}
.verdict.no{color:var(--stamp)}
.verdict.si{color:var(--accent)}
.cuadrille{background:repeating-conic-gradient(#d33 0 25%,#fff 0 50%) 0 0/28px 28px !important}

/* Color */
.sw{display:grid;gap:10px;align-content:start}
.sw-chip{aspect-ratio:4/3;max-width:100%;display:flex;align-items:flex-end;padding:14px;font-family:var(--f-display);font-stretch:125%;font-weight:800;font-size:22px}
.plate-chip{border:1px solid var(--line)}
.sw-meta{display:flex;justify-content:space-between;gap:8px;font-size:14px}
.sw-meta code{color:var(--muted)}
.sw p{font-size:14px;color:var(--muted)}
.ratio{display:flex;height:44px;margin-top:8px}
.ratio div{height:100%}
.tbl{overflow-x:auto}
table{border-collapse:collapse;width:100%;min-width:560px;font-size:15px}
td,th{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:middle}
th{font-family:var(--f-mono);font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:500}
.num{font-family:var(--f-mono);font-variant-numeric:tabular-nums}
.pair{display:inline-block;padding:6px 10px;font-family:var(--f-mono);font-weight:600;font-size:14px;white-space:nowrap}

/* Type */
.spec{border-top:2px solid var(--fg);padding-top:14px;display:grid;gap:10px;min-width:0}
.spec .row{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:13px;color:var(--muted);font-family:var(--f-mono)}
.d-sample{font-family:var(--f-display);font-stretch:125%;font-weight:850;font-size:clamp(34px,5vw,56px);line-height:.98;text-transform:uppercase;overflow-wrap:anywhere}
.b-sample{font-size:19px;max-width:44ch}
.m-sample{font-family:var(--f-mono);font-size:18px;font-weight:500}
.scale{display:grid;gap:8px}
.scale div{display:flex;align-items:baseline;gap:16px;border-bottom:1px solid var(--line);padding-bottom:6px;overflow:hidden;white-space:nowrap}
.scale span:first-child{font-family:var(--f-mono);font-size:12px;color:var(--muted);width:56px;flex:none}

/* Voice */
.voice td:first-child{width:50%}
.si-txt{font-weight:600}
.no-txt{color:var(--muted);text-decoration:line-through;text-decoration-color:var(--stamp)}
.traits{display:grid;gap:20px;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))}
.trait{display:grid;gap:6px}
.trait b{font-family:var(--f-display);font-stretch:118%;font-size:22px;font-weight:800}

/* Instagram mockups: sized in container units, 1cqw = 10.8px of the real 1080px piece */
.ig-row{display:grid;gap:20px;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));align-items:start}
.post{container-type:inline-size;aspect-ratio:4/5;max-width:100%;position:relative;overflow:hidden;box-shadow:0 1px 0 var(--line)}
.story{container-type:inline-size;aspect-ratio:9/16;max-width:100%;position:relative;overflow:hidden}
.pz{position:absolute;inset:0;padding:7cqw;display:flex;flex-direction:column}
.pz .tk{--z:2.6cqw;padding:4cqw 4.5cqw calc(4cqw + var(--z));font-size:3.1cqw;line-height:1.5}
.pz .perf{height:1.6cqw;margin:0 -1cqw 3cqw;background:radial-gradient(circle,var(--hole) 0 .6cqw,transparent .7cqw) 0 50%/2.6cqw 1.6cqw repeat-x}
.pz .tk-row .dots{border-bottom-width:.35cqw;transform:translateY(-.8cqw)}
.pz .tk hr{border-top-width:.35cqw;margin:2cqw 0}
.pz .stamp{border-width:.6cqw;outline-width:.3cqw;outline-offset:.6cqw;padding:.6cqw 2.4cqw;border-radius:.8cqw}
.ph{font-family:var(--f-display);font-stretch:125%;font-weight:850;line-height:.94;letter-spacing:-.01em;margin:0}
.pb{font-family:var(--f-body);font-size:3.6cqw;line-height:1.4}
.pm{font-family:var(--f-mono);font-size:2.6cqw;letter-spacing:.06em;text-transform:uppercase}
.p1{background:var(--b-birome);color:var(--b-papel)}
.p1 .ph{font-size:12.4cqw;text-transform:uppercase}
.p1 .tk{width:74cqw;align-self:flex-end;transform:rotate(-2.5deg);margin-top:auto;filter:drop-shadow(0 2cqw 3cqw rgba(0,0,0,.25))}
.p2{background:var(--b-papel);color:var(--b-carbon)}
.p2 .ph{font-size:9.6cqw;color:var(--b-birome)}
.p2 .tk{--hole:var(--b-papel);background:#fff;width:86cqw;margin-top:auto;position:relative;box-shadow:none}
.p2 .tkw{margin-top:auto;position:relative;filter:drop-shadow(0 1.4cqw 2.4cqw rgba(18,21,40,.16))}
.p2 .stamp{position:absolute;right:-2cqw;top:15cqw;font-size:8cqw;mix-blend-mode:multiply}
.p3{background:var(--b-duplicado);color:var(--b-carbon)}
.p3 .ph{font-size:11cqw}
.p3 .item{background:var(--b-papel);padding:4cqw;display:grid;grid-template-columns:1fr auto;gap:1.4cqw 3cqw;align-items:center;margin-top:7cqw;box-shadow:0 1.2cqw 0 rgba(18,21,40,.12)}
.p3 .item .nm{font-family:var(--f-body);font-weight:600;font-size:4.2cqw}
.p3 .item .pr{font-family:var(--f-mono);font-size:3.4cqw;color:#4B5068;text-decoration:line-through}
.p3 .toggle{grid-row:1/3;grid-column:2;font-family:var(--f-display);font-stretch:125%;font-weight:900;text-transform:uppercase;font-size:3.6cqw;background:var(--b-sello);color:var(--b-papel);padding:1.6cqw 2.8cqw;border-radius:.6cqw;transform:rotate(-4deg)}
.ft{margin-top:auto;display:flex;justify-content:space-between;align-items:flex-end;gap:4cqw}
.ft svg{height:6.4cqw}
.st{background:var(--b-birome);color:var(--b-papel)}
.st .pz{padding:7cqw 7cqw}
.st .ph{font-size:12.5cqw;margin-top:6cqw}
.st .steps{display:grid;gap:1.6cqw;margin-top:5cqw;font-family:var(--f-mono);font-size:3.7cqw}
.st .steps div{display:flex;gap:4cqw;align-items:baseline;border-top:.35cqw dashed rgba(242,243,239,.45);padding-top:1.8cqw}
.st .steps b{font-family:var(--f-display);font-stretch:125%;font-size:7cqw;line-height:1}
.bubble{background:var(--b-papel);color:var(--b-carbon);font-family:var(--f-mono);font-size:3.6cqw;line-height:1.5;padding:4cqw 4.5cqw;border-radius:3cqw 3cqw 3cqw 0;margin-top:7cqw;width:80cqw;position:relative}
.bubble::after{content:"";position:absolute;left:0;bottom:-3cqw;border-left:4cqw solid var(--b-papel);border-bottom:3cqw solid transparent}
.bubble small{display:block;text-align:right;opacity:.6;font-size:2.8cqw}
.sticker{align-self:flex-end;margin-top:-3cqw;margin-right:-2cqw;position:relative;background:var(--b-duplicado);color:var(--b-carbon);font-family:var(--f-display);font-stretch:125%;font-weight:900;text-transform:uppercase;font-size:5.4cqw;padding:2.6cqw 5cqw;transform:rotate(-5deg)}
.safe{position:absolute;left:0;right:0;border:1.5px dashed rgba(242,243,239,.55);pointer-events:none}
.safe.t{top:0;height:14%;border-top:0;border-left:0;border-right:0}
.safe.b{bottom:0;height:20%;border-bottom:0;border-left:0;border-right:0}
.st .lkst{height:7cqw;color:var(--b-papel)}

/* Profile */
.profile{background:var(--surface);border:1px solid var(--line);padding:22px;display:grid;gap:16px;max-width:520px}
.prow{display:flex;gap:20px;align-items:center}
.prow .av{width:92px;height:92px;border-radius:50%;overflow:hidden;flex:none}
.prow .av svg{width:100%;height:100%;display:block}
.pstats{display:flex;gap:18px;font-size:14px}
.pstats b{display:block;font-size:17px}
.hl{display:flex;gap:16px}
.hl div{display:grid;justify-items:center;gap:6px;font-size:12px}
.hl i{width:58px;height:58px;border-radius:50%;display:grid;place-items:center;font-style:normal;font-family:var(--f-mono);font-weight:600;font-size:13px;border:2px solid var(--line)}

/* Landing */
.land{border:1px solid var(--line);background:var(--b-papel);color:var(--b-carbon);overflow:hidden}
.land nav{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:18px 28px;border-bottom:1px solid #D5D8E2;flex-wrap:wrap}
.land nav svg{height:28px;color:var(--b-birome)}
.land nav ul{display:flex;gap:22px;list-style:none;margin:0;padding:0;font-size:15px;flex-wrap:wrap}
.lhero{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr));gap:36px;padding:56px 28px 64px;align-items:center}
.lhero h3{font-size:clamp(34px,5vw,60px);font-weight:850;font-stretch:125%;line-height:.98;color:var(--b-carbon);margin:0 0 18px}
.lhero h3 em{font-style:normal;color:var(--b-birome)}
.lhero p{font-size:18px;color:#3A3F57;margin-bottom:26px}
.btns{display:flex;gap:12px;flex-wrap:wrap}
.btn{font-family:var(--f-body);font-weight:600;font-size:16px;padding:13px 20px;border-radius:3px;border:2px solid var(--b-birome);text-decoration:none}
.btn.pri{background:var(--b-birome);color:var(--b-papel)}
.btn.sec{color:var(--b-birome)}
.lhero .hero-tk .tk{--hole:var(--b-papel);background:#fff}
.band{background:var(--b-birome);color:var(--b-papel);font-family:var(--f-mono);font-size:14px;letter-spacing:.1em;text-transform:uppercase;padding:14px 28px;white-space:nowrap;overflow:hidden}

/* Files */
.files{display:grid;gap:0}
.files div{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:16px;padding:10px 0;border-bottom:1px solid var(--line);font-size:15px}
.files code{overflow-wrap:anywhere}

/* Appendix */
.mini{width:100%;aspect-ratio:1;display:grid;place-items:center;max-width:180px}
.mini span{font-size:72px;line-height:1}
.miniB{background:#1F2A24;color:#F1EFE6;font-family:"Archivo",sans-serif;font-style:italic;font-weight:300}
.miniB span{text-shadow:0 0 1px #F1EFE6;letter-spacing:-.02em}
.miniC{background:repeating-conic-gradient(#C92B2B 0 25%,#FFF 0 50%) 0 0/36px 36px}
.miniC span{background:#1E6B4F;color:#fff;font-family:"Archivo",sans-serif;font-weight:900;padding:8px 18px;border-radius:50%}
footer{padding-block:48px 72px;border-top:1px dashed var(--line);display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;font-size:14px;color:var(--muted)}
footer svg{height:26px;color:var(--accent)}
@media (prefers-reduced-motion:no-preference){.hero-tk .stamp{animation:stamp .5s cubic-bezier(.2,.9,.3,1.3) .3s both}@keyframes stamp{from{transform:rotate(-9deg) scale(1.6);opacity:0}to{transform:rotate(-9deg) scale(1);opacity:1}}}
`;

const order = (stampText = "") => `
  <div class="tk">
    <div class="perf"></div>
    <div class="tk-row"><span>PEDIDO #0214</span><span class="dots" style="opacity:0;border:0"></span><span>21:34</span></div>
    <div class="tk-row" style="opacity:.7"><span>Delivery · Av. San Juan 2130</span></div>
    <hr>
    <div class="tk-row"><span class="q">1</span><span>Milanesa napolitana</span><span class="dots"></span><span>$14.900</span></div>
    <div class="tk-row"><span class="q">2</span><span>Empanada de carne</span><span class="dots"></span><span>$5.200</span></div>
    <div class="tk-row"><span class="q">1</span><span>Flan mixto</span><span class="dots"></span><span>$4.800</span></div>
    <hr>
    <div class="tk-row" style="font-weight:600"><span>TOTAL</span><span class="dots"></span><span>$24.900</span></div>
    <div class="tk-row" style="opacity:.7"><span>Efectivo · paga con $30.000</span></div>
  </div>${stampText ? `<span class="stamp">${stampText}</span>` : ""}`;

const html = /* html */ `<title>Marca Menucito</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,300..900&family=IBM+Plex+Mono:wght@400;500;600&family=Instrument+Sans:wght@400..700&display=swap">
<style>${css}</style>

<div class="wrap">
  <header class="top">
    ${lockH("lk", C.sello)}
    <span class="eyebrow">Manual de marca · v1 · noviembre 2026</span>
  </header>

  <div class="hero">
    <div class="stack">
      <span class="eyebrow">Dirección elegida: Comanda</span>
      <h1>La comanda del local, <em>en el celu del cliente.</em></h1>
      <p class="lead">Menucito toma el talonario del mozo y lo pasa a un link: la carta, el pedido y el WhatsApp. La marca sale de ahí: papel de comanda, birome azul, el sello de goma y la copia amarilla del duplicado.</p>
      <div class="facts"><span>Birome #2433C2</span><span>Archivo Expanded</span><span>IBM Plex Mono para precios</span></div>
    </div>
    <div class="hero-tk">${order("Anotado")}</div>
  </div>
</div>

<section id="concepto"><div class="wrap">
  <div class="sec-head">
    <span class="eyebrow">Concepto</span>
    <h2>Tres caminos, uno elegido</h2>
    <p>Todas las ideas salen del mismo mundo: bodegones, rotiserías, la parrilla de la esquina. Elegimos la que tiene que ver con lo que Menucito hace de verdad, que es tomar pedidos.</p>
  </div>
  <div class="grid g3">
    <article class="dir rec">
      <span class="tag">Recomendada</span>
      <h3>A · Comanda</h3>
      <div class="chips"><i style="background:${C.birome}"></i><i style="background:${C.papel}"></i><i style="background:${C.sello}"></i><i style="background:${C.duplicado}"></i></div>
      <p>El talonario de comanda: papel cuadriculado de ticket, birome azul, el sello de "Pagado" y la copia amarilla. Es el objeto que Menucito reemplaza, así que la marca cuenta el producto sin explicarlo. El azul nos separa del rojo y naranja de las apps de delivery.</p>
    </article>
    <article class="dir">
      <span class="tag" style="color:var(--muted)">Apéndice</span>
      <h3>B · Pizarra del día</h3>
      <div class="chips"><i style="background:#1F2A24"></i><i style="background:#F1EFE6"></i><i style="background:#E8C547"></i></div>
      <p>El pizarrón del menú del día con tiza. Muy de bodegón, pero las letras a mano no escalan a 16 px y el look de "artesanal" ya lo usa medio rubro.</p>
    </article>
    <article class="dir">
      <span class="tag" style="color:var(--muted)">Apéndice</span>
      <h3>C · Mantel y sifón</h3>
      <div class="chips"><i style="background:#C92B2B"></i><i style="background:#FFFFFF"></i><i style="background:#1E6B4F"></i></div>
      <p>El mantel cuadrillé y el verde del sifón. Se reconoce al instante, pero es el código de miles de pizzerías: nuestro logo se confundiría con el de nuestros clientes.</p>
    </article>
  </div>
</div></section>

<section id="logo"><div class="wrap">
  <div class="sec-head">
    <span class="eyebrow">Logo · símbolo</span>
    <h2>Un ticket con una m</h2>
    <p>El símbolo es una hoja de comanda: borde de arriba recto, fila de perforado, corte en serrucho abajo. Adentro va la misma m del logotipo. Funciona solo, como foto de perfil y como favicon.</p>
  </div>
  <div class="grid g2">
    <div class="plate p" style="min-height:360px">${sym("bigsym")}</div>
    <div class="anat">
      <h3>Anatomía</h3>
      <ol>
        <li><b>Hoja.</b> Proporción 76 × 96. Esquinas de arriba con radio mínimo (3 de 76): es papel, no un botón.</li>
        <li><b>Perforado.</b> Siete agujeros: la línea por donde se corta la comanda. Desaparece por debajo de 48 px (versión favicon).</li>
        <li><b>La m.</b> Tres palos iguales y dos arcos que se cruzan dejando una muesca en el centro. Es la misma m del logotipo.</li>
        <li><b>Serrucho.</b> Seis dientes en el corte de abajo; cuatro en la versión chica.</li>
      </ol>
      <p class="cap">Todo está dibujado con paths. No depende de ninguna fuente, se puede abrir en Figma, Illustrator o Canva.</p>
    </div>
  </div>

  <div class="sec-head" style="margin-top:64px">
    <span class="eyebrow">Logo · logotipo y versiones</span>
    <h3>Logotipo "menucito"</h3>
    <p>Minúsculas geométricas dibujadas a mano: palo de 9 unidades, redondas que pasan apenas la línea para compensar. El punto de la i es cuadrado y va en Sello en la versión a color: es el único detalle rojo del logo.</p>
  </div>
  <div class="grid">
    <div class="plate p" style="min-height:200px">${word("wm", C.sello)}</div>
  </div>
  <div class="grid g3" style="margin-top:20px">
    <div class="stack"><div class="plate p">${lockH("lk-h", C.sello)}</div><p class="cap"><b>Horizontal.</b> Web, firmas, encabezados. Versión principal.</p></div>
    <div class="stack"><div class="plate p">${lockS("lk-s", C.sello)}</div><p class="cap"><b>Apilada.</b> Espacios cuadrados, cierre de video, stickers.</p></div>
    <div class="stack"><div class="plate p">${sym("lk-sym")}</div><p class="cap"><b>Símbolo.</b> Perfil de Instagram, favicon, ícono de app.</p></div>
  </div>
  <div class="grid g4" style="margin-top:20px">
    <div class="stack"><div class="plate p" style="min-height:150px">${lockH("lk-h")}</div><p class="cap"><b>Birome sobre Papel</b></p></div>
    <div class="stack"><div class="plate b" style="min-height:150px">${lockH("lk-h")}</div><p class="cap"><b>Papel sobre Birome</b></p></div>
    <div class="stack"><div class="plate k" style="min-height:150px">${lockH("lk-h")}</div><p class="cap"><b>Papel sobre Carbón</b></p></div>
    <div class="stack"><div class="plate y" style="min-height:150px">${lockH("lk-h")}</div><p class="cap"><b>Carbón sobre Duplicado</b></p></div>
  </div>

  <div class="grid g2" style="margin-top:64px">
    <div class="stack">
      <h3>Aire alrededor</h3>
      <div class="plate p" style="min-height:300px">
        <svg viewBox="-4 -14 128 146" style="width:min(240px,70%)" role="img" aria-label="Área de resguardo del símbolo">
          <rect x="2" y="-8" width="116" height="136" fill="none" stroke="${C.sello}" stroke-width=".8" stroke-dasharray="3 2"/>
          <rect x="22" y="12" width="76" height="96" fill="none" stroke="${C.carbon}" stroke-opacity=".3" stroke-width=".5"/>
          <g fill="${C.birome}">${symbolKnockout(C.birome)}</g>
          <line x1="22" y1="-3" x2="2" y2="-3" stroke="${C.sello}" stroke-width=".8"/>
          <text x="5" y="-5.5" font-family="IBM Plex Mono,monospace" font-size="5" fill="${C.sello}">½X</text>
          <line x1="104" y1="46" x2="104" y2="86" stroke="${C.sello}" stroke-width=".8"/>
          <text x="106" y="68" font-family="IBM Plex Mono,monospace" font-size="6" fill="${C.sello}">X</text>
        </svg>
      </div>
      <p class="cap"><b>X = alto de la m.</b> Dejá medio X libre alrededor del símbolo y de cualquier versión del logo. Ningún texto, borde ni foto entra en esa zona.</p>
    </div>
    <div class="stack">
      <h3>Tamaño mínimo</h3>
      <div class="plate p" style="min-height:300px;place-items:center start">
        <div class="sizes">
          <figure>${favicon(16)}<figcaption>16 px · favicon</figcaption></figure>
          <figure>${favicon(24)}<figcaption>24 px</figcaption></figure>
          <figure>${sym("", "Símbolo 32px").replace("<svg ", '<svg height="32" ')}<figcaption>32 px</figcaption></figure>
          <figure>${sym("", "Símbolo 48px").replace("<svg ", '<svg height="48" ')}<figcaption>48 px · con perforado</figcaption></figure>
          <figure>${lockH("", C.sello).replace("<svg ", '<svg width="120" ')}<figcaption>120 px · horizontal</figcaption></figure>
        </div>
      </div>
      <p class="cap"><b>Por debajo de 48 px</b> usá <code>menucito-favicon.svg</code> (sin perforado, cuatro dientes). El logo horizontal no baja de 120 px de ancho; el logotipo solo, de 80 px.</p>
    </div>
  </div>

  <h3 style="margin-top:64px;margin-bottom:16px">Sí y no</h3>
  <div class="grid g4">
    <div class="dd"><div class="plate p">${sym()}</div><span class="verdict si">Sí · Birome sobre Papel</span></div>
    <div class="dd"><div class="plate b">${sym()}</div><span class="verdict si">Sí · Papel sobre Birome</span></div>
    <div class="dd"><div class="plate y" style="color:${C.carbon}">${sym()}</div><span class="verdict si">Sí · Carbón sobre Duplicado</span></div>
    <div class="dd"><div class="plate k">${sym2()}</div><span class="verdict si">Sí · Dos tonos sobre Carbón</span></div>
    <div class="dd"><div class="plate p">${sym().replace("<svg ", '<svg preserveAspectRatio="none" style="width:140px;height:70px" ')}</div><span class="verdict no">No · estirar o aplastar</span></div>
    <div class="dd"><div class="plate p">${sym().replace("<svg ", '<svg style="transform:rotate(18deg)" ')}</div><span class="verdict no">No · rotar el símbolo</span></div>
    <div class="dd"><div class="plate p"><svg viewBox="${L.SYM_VB}" style="width:72px" role="img" aria-label="Uso incorrecto con degradé"><defs><linearGradient id="gx" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7C3AED"/><stop offset="1" stop-color="#2563EB"/></linearGradient></defs>${symbolKnockout("url(#gx)")}</svg></div><span class="verdict no">No · degradés ni brillos</span></div>
    <div class="dd"><div class="plate p" style="color:#c2410c">${sym()}</div><span class="verdict no">No · el naranja viejo</span></div>
    <div class="dd"><div class="plate p"><svg viewBox="${L.SYM_VB}" style="width:72px" role="img" aria-label="Uso incorrecto solo contorno"><path fill="none" stroke="${C.birome}" stroke-width="2" d="${ticket(6)}${SYMBOL_M}"/></svg></div><span class="verdict no">No · solo contorno</span></div>
    <div class="dd"><div class="plate cuadrille" style="color:${C.birome}">${sym()}</div><span class="verdict no">No · sobre fondos cargados</span></div>
    <div class="dd"><div class="plate p">${sym().replace("<svg ", '<svg style="filter:drop-shadow(6px 6px 4px rgba(0,0,0,.45))" ')}</div><span class="verdict no">No · sombras ni efectos</span></div>
    <div class="dd"><div class="plate b" style="color:${C.sello}">${sym()}</div><span class="verdict no">No · Sello sobre Birome</span></div>
  </div>
</div></section>

<section id="color"><div class="wrap">
  <div class="sec-head">
    <span class="eyebrow">Color</span>
    <h2>Seis colores de talonario</h2>
    <p>Cada color sale de un objeto real de la comanda. Birome manda; Papel ocupa casi todo el espacio; Sello aparece poco y para decir algo (Agotado, Pagado, Nuevo).</p>
  </div>
  <div class="grid g3">${swatches}</div>
  <h3 style="margin-top:40px">Proporción en una pieza típica</h3>
  <div class="ratio" role="img" aria-label="Proporción: Papel 55%, Birome 25%, Carbón 10%, Calco 5%, Duplicado 3%, Sello 2%">
    <div style="flex:55;background:${C.papel};border:1px solid var(--line)"></div><div style="flex:25;background:${C.birome}"></div><div style="flex:10;background:${C.carbon}"></div><div style="flex:5;background:${C.calco}"></div><div style="flex:3;background:${C.duplicado}"></div><div style="flex:2;background:${C.sello}"></div>
  </div>
  <p class="cap" style="margin-top:8px">Papel 55 · Birome 25 · Carbón 10 · Calco 5 · Duplicado 3 · Sello 2</p>
  <h3 style="margin-top:40px;margin-bottom:8px">Pares de contraste (WCAG)</h3>
  <div class="tbl"><table>
    <thead><tr><th>Muestra</th><th>Par</th><th>Contraste</th><th>Uso</th></tr></thead>
    <tbody>${pairRows}</tbody>
  </table></div>
  <p class="cap" style="margin-top:10px">Sello sobre Birome no se usa nunca (rojo sobre azul vibra y no llega a 3:1).</p>
</div></section>

<section id="tipografia"><div class="wrap">
  <div class="sec-head">
    <span class="eyebrow">Tipografía · Google Fonts</span>
    <h2>Grita poco, anota claro</h2>
    <p>Tres familias, cada una con un trabajo. La display ancha hace de cartel de la vidriera; la de texto explica; la mono es la letra del ticket y lleva todos los precios.</p>
  </div>
  <div class="grid g3">
    <div class="spec">
      <div class="row"><span>Display</span><span>Archivo · ancho 125 · 800–900</span></div>
      <div class="d-sample">Milanga completa</div>
      <p class="cap">Titulares y frases cortas. Mayúsculas solo hasta cinco palabras; más largo, en oración. Interletra −1 %.</p>
    </div>
    <div class="spec">
      <div class="row"><span>Texto</span><span>Instrument Sans · 400–600</span></div>
      <div class="b-sample">Cargá la carta una vez y cambiá los precios cuando quieras. El pedido te llega a WhatsApp con dirección y forma de pago.</div>
      <p class="cap">Todo el texto corrido, UI, botones. 16–19 px, interlínea 1,5.</p>
    </div>
    <div class="spec">
      <div class="row"><span>Utilitaria</span><span>IBM Plex Mono · 500</span></div>
      <div class="m-sample">2 × Empanada ... $5.200<br>PEDIDO #0214 · 21:34</div>
      <p class="cap">Precios, números de pedido, horarios, etiquetas en mayúscula (+6 % interletra). Cifras tabulares.</p>
    </div>
  </div>
  <h3 style="margin-top:44px;margin-bottom:12px">Escala</h3>
  <div class="scale">
    <div><span>96</span><span style="font-family:var(--f-display);font-stretch:125%;font-weight:850;font-size:clamp(40px,8vw,96px);line-height:1">PEDÍ</span></div>
    <div><span>56</span><span style="font-family:var(--f-display);font-stretch:125%;font-weight:800;font-size:clamp(30px,5vw,56px);line-height:1">Tu carta en un link</span></div>
    <div><span>32</span><span style="font-family:var(--f-display);font-stretch:118%;font-weight:750;font-size:32px">Rotiserías y bodegones</span></div>
    <div><span>20</span><span style="font-size:20px">Sin audios, sin llamadas, sin anotar dos veces.</span></div>
    <div><span>16</span><span style="font-size:16px">El pedido entra con todo: qué, cuánto y dónde.</span></div>
    <div><span>13</span><span style="font-family:var(--f-mono);font-size:13px;letter-spacing:.06em">TOTAL $24.900 · EFECTIVO</span></div>
  </div>
</div></section>

<section id="voz"><div class="wrap">
  <div class="sec-head">
    <span class="eyebrow">Voz</span>
    <h2>Como habla el que atiende</h2>
    <p>Voseo rioplatense, frases cortas, datos concretos. Le hablamos al dueño del local como alguien que conoce la cocina un viernes a las 21.</p>
  </div>
  <div class="traits">
    <div class="trait"><b>De mostrador</b><p class="muted">Directo y amable. "Tu link", "Mi local", "Agotado". Nada de "soluciones gastronómicas".</p></div>
    <div class="trait"><b>Concreto</b><p class="muted">Precios, horarios, cantidades. Si se puede decir con un número, va el número.</p></div>
    <div class="trait"><b>Con oficio</b><p class="muted">Respeta el laburo. Humor seco cuando suma, nunca a costa del cliente. Sin emojis de fuego.</p></div>
  </div>
  <div class="tbl" style="margin-top:32px"><table class="voice">
    <thead><tr><th>Así sí</th><th>Así no</th></tr></thead>
    <tbody>
      <tr><td class="si-txt">Cargá la carta una vez. Cambiá precios cuando quieras.</td><td class="no-txt">Revolucioná la experiencia gastronómica de tus clientes.</td></tr>
      <tr><td class="si-txt">Entró un pedido: 2 de carne y una fugazzeta. Retira 21:30.</td><td class="no-txt">¡¡Nuevo pedido recibido!! 🎉🔥</td></tr>
      <tr><td class="si-txt">Se cortó la conexión. Tu pedido quedó guardado, probá de nuevo.</td><td class="no-txt">Ups, algo salió mal.</td></tr>
      <tr><td class="si-txt">¿Se terminó el vacío? Marcalo Agotado.</td><td class="no-txt">Producto sin stock disponible.</td></tr>
      <tr><td class="si-txt">Tu carta en un link. El pedido, por WhatsApp.</td><td class="no-txt">La plataforma all-in-one para tu negocio.</td></tr>
    </tbody>
  </table></div>
</div></section>

<section id="instagram"><div class="wrap">
  <div class="sec-head">
    <span class="eyebrow">Aplicación · Instagram</span>
    <h2>El feed como un talonario</h2>
    <p>Las piezas alternan fondo Birome, Papel y Duplicado para que la grilla se lea como hojas de comanda. Cada post lleva un ticket, un sello o un dato real (precio, hora, cantidad). Medidas reales: post 1080 × 1350, historia 1080 × 1920.</p>
  </div>

  <div class="grid g2" style="align-items:center">
    <div class="profile" aria-label="Maqueta del perfil de Instagram">
      <div class="prow">
        <div class="av">${avatar()}</div>
        <div class="pstats"><span><b>36</b>posts</span><span><b>1.204</b>seguidores</span><span><b>180</b>seguidos</span></div>
      </div>
      <div style="font-size:15px;line-height:1.45"><b>Menucito</b><br>Carta digital y pedidos por WhatsApp para tu local.<br>Bodegones, rotiserías, parrillas. Hecho en Argentina.<br><span style="color:var(--accent)">Link en la bio ↓</span></div>
      <div class="hl">
        <div><i style="background:${C.birome};color:${C.papel}">1·2·3</i>Cómo va</div>
        <div><i style="background:${C.papel};color:${C.birome}">$</i>Precios</div>
        <div><i style="background:${C.duplicado};color:${C.carbon}">TIP</i>Tips</div>
        <div><i style="background:${C.calco};color:${C.birome}">#</i>Locales</div>
      </div>
    </div>
    <div class="stack">
      <h3>Foto de perfil</h3>
      <p>Símbolo en dos tonos sobre Birome: <code>menucito-avatar-1080.svg</code>. El ticket entra completo en el círculo de recorte con margen. Destacadas en los colores de la paleta, con texto mono, sin íconos sueltos.</p>
    </div>
  </div>

  <div class="ig-row" style="margin-top:40px">
    <div class="stack">
      <div class="post p1"><div class="pz">
        <div class="ft" style="margin-top:0">${word("", C.papel).replace("<svg ", '<svg style="height:5.2cqw;color:var(--b-papel)" ')}<span class="pm" style="opacity:.75">Para tu local</span></div>
        <h4 class="ph" style="margin-top:8cqw">La carta<br>en un link.</h4>
        <p class="pb" style="margin-top:4cqw;max-width:60cqw;opacity:.88">El cliente elige, el pedido te llega a WhatsApp.</p>
        ${order()}
      </div></div>
      <p class="cap"><b>Post 1 · presentación.</b> Fondo Birome, ticket inclinado 2,5°.</p>
    </div>
    <div class="stack">
      <div class="post p2"><div class="pz">
        <span class="pm" style="color:${C.birome}">Pedidos por WhatsApp</span>
        <h4 class="ph" style="margin-top:4cqw">El pedido llega escrito.</h4>
        <p class="pb" style="margin-top:3.6cqw;max-width:66cqw">Sin audios de tres minutos. Sin "¿me repetís la dirección?". Llega con todo: qué, cuánto y dónde.</p>
        <div class="tkw">${order("Anotado")}</div>
      </div></div>
      <p class="cap"><b>Post 2 · beneficio.</b> Fondo Papel, sello rojo encima del ticket.</p>
    </div>
    <div class="stack">
      <div class="post p3"><div class="pz">
        <span class="pm">Tip · tu carta</span>
        <h4 class="ph" style="margin-top:4cqw">¿Se terminó el vacío?</h4>
        <div class="item"><span class="nm">Vacío a la parrilla</span><span class="toggle">Agotado</span><span class="pr">$18.500</span></div>
        <p class="pb" style="margin-top:6cqw;max-width:66cqw">Lo marcás Agotado desde el celu y la carta se actualiza al toque. Nadie te lo pide por WhatsApp.</p>
        <div class="ft">${lockH("", C.sello).replace("<svg ", `<svg style="height:6.4cqw;color:${C.birome}" `)}<span class="pm">Tip 04</span></div>
      </div></div>
      <p class="cap"><b>Post 3 · tip.</b> Fondo Duplicado, el sello como chip de estado.</p>
    </div>
  </div>

  <div class="grid g2" style="margin-top:40px;align-items:start">
    <div class="stack" style="max-width:360px">
      <div class="story st">
        <div class="safe t"></div><div class="safe b"></div>
        <div class="pz">
          <div style="margin-top:18cqw">${lockH("lkst")}</div>
          <h4 class="ph" style="margin-top:9cqw">Pedí sin llamar.</h4>
          <div class="steps">
            <div><b>1</b><span>Abrís el link del local</span></div>
            <div><b>2</b><span>Armás el pedido</span></div>
            <div><b>3</b><span>Lo mandás por WhatsApp</span></div>
          </div>
          <div class="bubble">Hola! Te paso el pedido #0214<br>Total $24.900 · efectivo<small>21:34</small></div>
          <span class="sticker">Link en la bio ↑</span>
        </div>
      </div>
      <p class="cap"><b>Historia.</b> Las líneas punteadas marcan las zonas que tapa Instagram (14 % arriba, 20 % abajo): ahí no va nada importante.</p>
    </div>
    <div class="stack">
      <h3>Reglas para piezas</h3>
      <ul style="margin:0;padding-left:20px;display:grid;gap:8px;max-width:58ch">
        <li>Un solo mensaje por pieza. Titular en Archivo ancha, como máximo dos líneas de texto de apoyo.</li>
        <li>Siempre un objeto de comanda: ticket, sello, chip de estado o una cifra en mono.</li>
        <li>Rotaciones solo en objetos (tickets −2,5°, sellos −9°). El logo y los titulares van derechos.</li>
        <li>Precios con punto de miles y sin centavos: $14.900.</li>
        <li>Fotos de comida: sí, recortadas en rectángulo, sin filtros. El ticket puede pisar la foto, el logo no.</li>
        <li>Nada de emojis como viñeta, nada de degradés.</li>
      </ul>
    </div>
  </div>
</div></section>

<section id="landing"><div class="wrap">
  <div class="sec-head">
    <span class="eyebrow">Aplicación · landing</span>
    <h2>Del feed a la web</h2>
    <p>El hero repite el post 1: titular ancho, el ticket como imagen principal y un botón Birome con esquinas de 3 px. Abajo, una franja con el vocabulario del rubro hace de separador.</p>
  </div>
  <div class="land">
    <nav>${lockH("", C.sello)}<ul><li>Cómo funciona</li><li>Precios</li><li>Ejemplos</li><li style="color:${C.birome};font-weight:600">Ingresar</li></ul></nav>
    <div class="lhero">
      <div>
        <h3>Tu carta, tus pedidos, <em>tu WhatsApp.</em></h3>
        <p>Armá la carta de tu local en una tarde. Tus clientes piden desde el link y el pedido te llega escrito, con dirección y forma de pago.</p>
        <div class="btns"><span class="btn pri">Probar gratis</span><span class="btn sec">Ver una carta de ejemplo</span></div>
      </div>
      <div class="hero-tk">${order("Pagado")}</div>
    </div>
    <div class="band">Empanadas · Milanesas · Pizza al molde · Minutas · Pastas caseras · Parrilla · Postres · Bebidas ·</div>
  </div>
  <p class="cap" style="margin-top:12px">Cuando se aplique a <code>apps/web</code> y <code>apps/admin</code>, Birome reemplaza al naranja actual y Papel al fondo crema. Ese cambio queda para un paso aparte.</p>
</div></section>

<section id="archivos"><div class="wrap">
  <div class="sec-head">
    <span class="eyebrow">Archivos</span>
    <h2>Dónde está cada cosa</h2>
    <p>En el repo, carpeta <code>brand/svg/</code>. Todos los SVG salen de <code>brand/geometry.mjs</code>; para regenerarlos corré <code>node brand/build-svgs.mjs</code>.</p>
  </div>
  <div class="files">
    <div><code>menucito-avatar-1080.svg</code><span>Foto de perfil de Instagram</span></div>
    <div><code>menucito-favicon.svg</code><span>Favicon y tamaños menores a 48 px</span></div>
    <div><code>menucito-symbol-{birome,papel,carbon}.svg</code><span>Símbolo calado, un color</span></div>
    <div><code>menucito-symbol-two-tone.svg</code><span>Ticket Papel con m Birome, para fondos oscuros</span></div>
    <div><code>menucito-wordmark-{birome,papel,carbon}.svg</code><span>Logotipo solo</span></div>
    <div><code>menucito-lockup-horizontal(-papel).svg</code><span>Versión principal</span></div>
    <div><code>menucito-lockup-stacked(-papel).svg</code><span>Versión apilada</span></div>
  </div>
</div></section>

<section id="apendice"><div class="wrap">
  <div class="sec-head">
    <span class="eyebrow">Apéndice</span>
    <h2>Los caminos que no elegimos</h2>
    <p>Quedan como referencia por si se quiere volver a mirar. Son bocetos de tono, no logos terminados.</p>
  </div>
  <div class="grid g2">
    <div class="grid" style="grid-template-columns:auto minmax(0,1fr);gap:20px;align-items:start">
      <div class="mini miniB" style="width:150px"><span>m</span></div>
      <div class="stack"><h3>B · Pizarra del día</h3><p class="muted">Verde pizarrón #1F2A24, tiza #F1EFE6, tiza amarilla #E8C547. Display a mano, cuerpo en grotesca. Fuerte en Instagram, débil en UI: el trazo de tiza no funciona en un botón ni a 16 px, y se acerca al look "artesanal" que usan muchos locales.</p></div>
    </div>
    <div class="grid" style="grid-template-columns:auto minmax(0,1fr);gap:20px;align-items:start">
      <div class="mini miniC" style="width:150px"><span>m</span></div>
      <div class="stack"><h3>C · Mantel y sifón</h3><p class="muted">Rojo mantel #C92B2B, blanco, verde sifón #1E6B4F. Cuadrillé como patrón. Se reconoce al toque pero dice "pizzería", no "sistema de pedidos", y compite visualmente con las cartas de los propios clientes.</p></div>
    </div>
  </div>
</div></section>

<div class="wrap"><footer>${lockH("", C.sello)}<span>Manual de marca Menucito · v1 · Para revisar y ajustar antes de aplicarlo a la app.</span></footer></div>
`;

writeFileSync(join(here, "manual.html"), html);
console.log("wrote brand/manual.html", (html.length / 1024).toFixed(0) + "KB");
