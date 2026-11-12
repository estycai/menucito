// Menucito brand geometry. Every mark is built from these paths: no fonts involved.
// Wordmark grid: baseline y=60, x-height top y=20, stem 9 units.
// Symbol grid: 120 x 120, a comanda ticket with a perforation row and the wordmark "m".

const f = (n) => String(Math.round(n * 100) / 100);

export const COLORS = {
  birome: "#2433C2",
  papel: "#F2F3EF",
  carbon: "#121528",
  sello: "#C9213A",
  duplicado: "#F4DE6E",
  calco: "#CDD3F6",
};

// Round letters overshoot the x-height a little so they look the same size as straight ones.
const R = 20.8;
const r = 11.8;

const glyphs = {
  m: (X) => ({
    w: 49,
    d: `M${f(X)} 60V34.5A14.5 14.5 0 0 1 ${f(X + 24.5)} 24A14.5 14.5 0 0 1 ${f(X + 49)} 34.5V60H${f(X + 40)}V34.5A5.5 5.5 0 0 0 ${f(X + 29)} 34.5V60H${f(X + 20)}V34.5A5.5 5.5 0 0 0 ${f(X + 9)} 34.5V60Z`,
  }),
  e: (X) => {
    const cx = X + R;
    const rad = (deg) => (deg * Math.PI) / 180;
    const p1x = cx + Math.sqrt(R * R - 25);
    const barBx = cx + Math.sqrt(R * R - 9);
    const toX = cx + R * Math.cos(rad(40));
    const toY = 40 + R * Math.sin(rad(40));
    const tiX = cx + r * Math.cos(rad(40));
    const tiY = 40 + r * Math.sin(rad(40));
    const inL = cx - Math.sqrt(r * r - 9);
    const hL = cx - Math.sqrt(r * r - 25);
    const hR = cx + Math.sqrt(r * r - 25);
    return {
      w: 2 * R,
      d:
        `M${f(p1x)} 35A${R} ${R} 0 1 0 ${f(toX)} ${f(toY)}L${f(tiX)} ${f(tiY)}A${r} ${r} 0 0 1 ${f(inL)} 43H${f(barBx)}L${f(p1x)} 35Z` +
        `M${f(hL)} 35A${r} ${r} 0 0 1 ${f(hR)} 35Z`,
    };
  },
  n: (X) => ({
    w: 31,
    d: `M${f(X)} 60V35.5A15.5 15.5 0 0 1 ${f(X + 31)} 35.5V60H${f(X + 22)}V35.5A6.5 6.5 0 0 0 ${f(X + 9)} 35.5V60Z`,
  }),
  u: (X) => ({
    w: 31,
    d: `M${f(X)} 20V44.5A15.5 15.5 0 0 0 ${f(X + 31)} 44.5V20H${f(X + 22)}V44.5A6.5 6.5 0 0 1 ${f(X + 9)} 44.5V20Z`,
  }),
  c: (X) => {
    const cx = X + R;
    const k = Math.SQRT1_2;
    return {
      w: R + R * k,
      d: `M${f(cx + R * k)} ${f(40 - R * k)}A${R} ${R} 0 1 0 ${f(cx + R * k)} ${f(40 + R * k)}L${f(cx + r * k)} ${f(40 + r * k)}A${r} ${r} 0 1 1 ${f(cx + r * k)} ${f(40 - r * k)}Z`,
    };
  },
  i: (X) => ({ w: 9, d: `M${f(X)} 20H${f(X + 9)}V60H${f(X)}Z`, dot: `M${f(X)} 6H${f(X + 9)}V15H${f(X)}Z` }),
  t: (X) => ({
    w: 22,
    d: `M${f(X + 6)} 10L${f(X + 15)} 6V20H${f(X + 22)}V28H${f(X + 15)}V60H${f(X + 6)}V28H${f(X)}V20H${f(X + 6)}Z`,
  }),
  o: (X) => {
    const cx = X + R;
    return {
      w: 2 * R,
      d: `M${f(cx)} ${f(40 - R)}A${R} ${R} 0 1 1 ${f(cx)} ${f(40 + R)}A${R} ${R} 0 1 1 ${f(cx)} ${f(40 - R)}ZM${f(cx)} ${f(40 - r)}A${r} ${r} 0 1 0 ${f(cx)} ${f(40 + r)}A${r} ${r} 0 1 0 ${f(cx)} ${f(40 - r)}Z`,
    };
  },
};

// Letter-by-letter spacing, tuned by eye: round sides sit closer.
const WORD = [
  ["m", 6],
  ["e", 6],
  ["n", 8],
  ["u", 6],
  ["c", 7],
  ["i", 5],
  ["t", 4],
  ["o", 0],
];

export function wordmark() {
  let x = 0;
  const parts = [];
  let dot = "";
  for (const [ch, gap] of WORD) {
    const g = glyphs[ch](x);
    parts.push(g.d);
    if (g.dot) dot = g.dot;
    x += g.w + gap;
  }
  return { body: parts.join(""), dot, width: x, top: 6, bottom: 40 + R };
}

// The symbol "m" is the wordmark m, centred in the ticket.
export const SYMBOL_M = (() => {
  const d = glyphs.m(35.5).d;
  // shift down by 26 units: rebuild with a translate applied to y values
  return d.replace(/([MLHVAZ])([^MLHVAZ]*)/g, (all, cmd, args) => {
    const n = args.trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (cmd === "Z") return "Z";
    if (cmd === "H") return `H${f(n[0])}`;
    if (cmd === "V") return `V${f(n[0] + 26)}`;
    if (cmd === "A") return `A${n[0]} ${n[1]} ${n[2]} ${n[3]} ${n[4]} ${f(n[5])} ${f(n[6] + 26)}`;
    return `${cmd}${f(n[0])} ${f(n[1] + 26)}`;
  });
})();

export function ticket(teeth = 6) {
  const left = 22;
  const right = 98;
  const valley = 100;
  const point = 108;
  const w = (right - left) / teeth;
  let d = `M25 12H95Q98 12 98 15V${valley}`;
  for (let i = 0; i < teeth; i++) {
    const x0 = right - i * w;
    d += `L${f(x0 - w / 2)} ${point}L${f(x0 - w)} ${valley}`;
  }
  d += `V15Q22 12 25 12Z`;
  return d;
}

export function holes() {
  let d = "";
  const rr = 2.4;
  for (let i = 0; i < 7; i++) {
    const cx = 32 + (i * 56) / 6;
    d += `M${f(cx - rr)} 28A${rr} ${rr} 0 1 0 ${f(cx + rr)} 28A${rr} ${rr} 0 1 0 ${f(cx - rr)} 28Z`;
  }
  return d;
}

// Contrast helpers for the manual's color table.
function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const l = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
}
export function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
