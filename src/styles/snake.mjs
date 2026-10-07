// Style "snake" : un serpent mange les jours actifs du moins chargé au plus
// chargé (1 commit d'abord, les plus gros jours à la fin). Entre deux
// commits il suit un trajet pseudo-aléatoire (déterministe : même données,
// même parcours) qui se rapproche de sa cible sans jamais se mordre la queue
// ni faire demi-tour. À nombre de commits égal, il enchaîne le plus proche.
// La simulation tourne une fois à la génération, puis est convertie en
// animation CSS : la tête avance à vitesse constante (une case par pas),
// donc l'interpolation `linear` reproduit exactement le mouvement, et
// le corps (4 segments) suit la tête case par case.

import { LEVEL_COLOR, gridGeometry } from "../lib/contributions.mjs";

export const meta = {
  id: "snake",
  label: "Commit Snake",
  description: "Un serpent file vers le commit le plus proche et le mange, sans jamais grandir, jusqu'à avoir tout avalé.",
};

const MAX_STEP = 0.18;    // s par case parcourue, au plus (lent : ~5,5 cases/s)
const MIN_STEP = 0.05;    // s par case parcourue, au moins
const TARGET_CYCLE = 70;  // s, durée visée pour une boucle : le pas s'adapte pour y tenir
const HOLD = 1.0;         // s, pause avant la remise à zéro
const RESET_DUR = 0.5;    // s, le serpent disparaît et les commits reviennent
const SEGMENTS = 3;       // segments derrière la tête
const SEG_LAG = 1;        // retard de chaque segment sur le précédent, en pas (= une case)
const SNAKE_COLOR = "#e0e0e0";
const BAR_H = 5;          // hauteur de la barre de progression
const BAR_GAP = 8;        // espace entre la grille et la barre

// PRNG déterministe (mulberry32) : le parcours ne change pas d'un jour à l'autre
// tant que les données ne changent pas.
function makeRng(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const WANDER = 0.18; // probabilité de faire un pas qui ne rapproche pas de la cible

function simulate(days, cols) {
  const key = (c, r) => c * 7 + r;
  const rng = makeRng(days.reduce((n, d) => (n * 31 + d.count + 7) | 0, cols));
  const inGrid = (c, r) => c >= 0 && c < cols && r >= 0 && r < 7;
  const food = new Map(days.filter((d) => d.count > 0).map((d) => [key(d.col, d.row), d]));

  const heads = [{ c: 0, r: 3 }];
  const eats = [];
  const eatAt = (c, r, step) => {
    const k = key(c, r);
    if (food.has(k)) { eats.push({ step, day: food.get(k) }); food.delete(k); }
  };

  // Ordre de visite : nombre de commits croissant, puis plus proche voisin.
  const byCount = new Map();
  for (const d of food.values()) {
    if (!byCount.has(d.count)) byCount.set(d.count, []);
    byCount.get(d.count).push(d);
  }
  const order = [];
  let cur = heads[0];
  for (const count of [...byCount.keys()].sort((a, b) => a - b)) {
    const rest = [...byCount.get(count)];
    while (rest.length) {
      let best = 0, bestD = Infinity;
      rest.forEach((d, i) => {
        const dist = Math.abs(d.col - cur.c) + Math.abs(d.row - cur.r) + rng() * 0.5;
        if (dist < bestD) { bestD = dist; best = i; }
      });
      const [d] = rest.splice(best, 1);
      order.push(d);
      cur = { c: d.col, r: d.row };
    }
  }

  for (const target of order) {
    let guard = 0;
    for (;;) {
      const head = heads[heads.length - 1];
      if (head.c === target.col && head.r === target.row) break;
      const prev1 = heads[heads.length - 2], prev2 = heads[heads.length - 3];
      const is = (p, c, r) => p && p.c === c && p.r === r;
      const moves = DIRS.map(([dc, dr]) => ({ c: head.c + dc, r: head.r + dr }))
        .filter((m) => inGrid(m.c, m.r));
      // Pas de demi-tour ni de retour dans le corps ; sinon, au pire, n'importe quoi.
      let cands = moves.filter((m) => !is(prev1, m.c, m.r) && !is(prev2, m.c, m.r));
      if (!cands.length) cands = moves.filter((m) => !is(prev1, m.c, m.r));
      if (!cands.length) cands = moves;
      // Le serpent peut passer par-dessus un autre commit sans le manger : seul
      // celui dont c'est le tour disparaît, ce qui garantit l'ordre croissant.
      const dx = target.col - head.c, dy = target.row - head.r;
      const dist = (m) => Math.abs(target.col - m.c) + Math.abs(target.row - m.r);
      const toward = cands.filter((m) => dist(m) < Math.abs(dx) + Math.abs(dy));

      let pick;
      if (toward.length && (++guard > 80 || rng() > WANDER)) {
        // Choix pondéré par la distance restante sur chaque axe : trajet en escalier.
        const w = toward.map((m) => (m.c !== head.c ? Math.abs(dx) : Math.abs(dy)));
        let x = rng() * w.reduce((a, b) => a + b, 0);
        pick = toward[w.findIndex((v) => (x -= v) < 0)] ?? toward[0];
      } else {
        pick = cands[Math.floor(rng() * cands.length)];
      }
      heads.push({ c: pick.c, r: pick.r });
      if (pick.c === target.col && pick.r === target.row) eatAt(pick.c, pick.r, heads.length - 1);
    }
  }

  return { heads, eats, endStep: heads.length - 1 };
}

export function render(days, opts = {}) {
  const accent = `#${(opts.accent ?? "ff9100").replace(/^#/, "")}`;
  const bg = opts.background ?? "#0d1117";
  const g = gridGeometry(days, { top: 8, left: 8, right: 8, bottom: 8 + BAR_GAP + BAR_H });
  const { heads, eats, endStep } = simulate(days, g.cols);
  const STEP = Math.max(MIN_STEP, Math.min(MAX_STEP, TARGET_CYCLE / Math.max(endStep, 1)));

  const simEnd = endStep * STEP;
  const holdEnd = simEnd + HOLD;
  const cycleEnd = holdEnd + RESET_DUR;
  const pct = (s) => ((s / cycleEnd) * 100).toFixed(3);
  const cx = (c) => g.cellX(c) + g.CELL / 2;
  const cy = (r) => g.cellY(r) + g.CELL / 2;
  const EPS = 0.12; // s, fondu de disparition d'un commit mangé

  let cellRects = "";
  days.forEach((d) => {
    cellRects += `<rect x="${g.cellX(d.col)}" y="${g.cellY(d.row)}" width="${g.CELL}" height="${g.CELL}" rx="2" fill="#161b22"/>\n`;
  });

  // Commits : un carré plein par jour actif, avalé quand la tête passe dessus.
  let foodEls = "", keyframes = "";
  const eatAt = new Map(eats.map((e) => [e.day, e.step * STEP]));
  days.filter((d) => d.count > 0).forEach((d, i) => {
    const color = LEVEL_COLOR[d.level] ?? accent;
    const x = g.cellX(d.col), y = g.cellY(d.row);
    const t = eatAt.get(d);
    if (t === undefined) {
      foodEls += `<rect x="${x}" y="${y}" width="${g.CELL}" height="${g.CELL}" rx="2" fill="${color}"/>\n`;
      return;
    }
    keyframes += `@keyframes f${i} {
  0% { opacity: 1; }
  ${pct(t)}% { opacity: 1; }
  ${pct(t + EPS)}% { opacity: 0; }
  ${pct(holdEnd)}% { opacity: 0; }
  100% { opacity: 1; }
}\n`;
    foodEls += `<rect x="${x}" y="${y}" width="${g.CELL}" height="${g.CELL}" rx="2" fill="${color}" style="animation: f${i} ${cycleEnd.toFixed(2)}s linear infinite;"/>\n`;
  });

  // Tête : vitesse constante, on ne garde un point d'arrêt que là où la
  // direction change (l'interpolation linéaire fait le reste).
  let headKf = `0% { transform: translate(${cx(heads[0].c).toFixed(1)}px,${cy(heads[0].r).toFixed(1)}px); opacity: 1; }\n`;
  for (let i = 1; i < heads.length; i++) {
    const a = heads[i - 1], b = heads[i], n = heads[i + 1];
    const turn = !n || (b.c - a.c) !== (n.c - b.c) || (b.r - a.r) !== (n.r - b.r);
    if (turn) headKf += `${pct(i * STEP)}% { transform: translate(${cx(b.c).toFixed(1)}px,${cy(b.r).toFixed(1)}px); }\n`;
  }
  const last = heads[heads.length - 1];
  headKf += `${pct(holdEnd)}% { transform: translate(${cx(last.c).toFixed(1)}px,${cy(last.r).toFixed(1)}px); opacity: 1; }\n`;
  headKf += `${pct(holdEnd + 0.2)}% { transform: translate(${cx(last.c).toFixed(1)}px,${cy(last.r).toFixed(1)}px); opacity: 0; }\n`;
  headKf += `100% { transform: translate(${cx(heads[0].c).toFixed(1)}px,${cy(heads[0].r).toFixed(1)}px); opacity: 0; }\n`;

  // Barre de progression : un tronçon par série de commits de même niveau
  // (couleur du niveau), qui se remplit en continu à mesure que le serpent
  // mange, puis se vide pendant la remise à zéro.
  const totalEaten = eats.length;
  const barY = g.PAD_TOP + g.gridHeight + BAR_GAP;
  let barEls = "";
  if (totalEaten > 0) {
    const groups = [];
    eats.forEach((e) => {
      const last = groups[groups.length - 1];
      if (last && last.level === e.day.level) last.times.push(e.step * STEP);
      else groups.push({ level: e.day.level, times: [e.step * STEP], first: groups.reduce((n, x) => n + x.times.length, 0) });
    });
    let prevT = 0;
    groups.forEach((grp, gi) => {
      const x = g.PAD_LEFT + (grp.first / totalEaten) * g.gridWidth;
      const w = (grp.times.length / totalEaten) * g.gridWidth;
      const color = LEVEL_COLOR[grp.level] ?? accent;
      let kf = `0% { transform: scaleX(0); }\n${pct(prevT)}% { transform: scaleX(0); }\n`;
      grp.times.forEach((t, k) => {
        kf += `${pct(t)}% { transform: scaleX(${((k + 1) / grp.times.length).toFixed(3)}); }\n`;
      });
      kf += `${pct(holdEnd)}% { transform: scaleX(1); }\n100% { transform: scaleX(0); }\n`;
      keyframes += `@keyframes bar${gi} { ${kf} }\n`;
      barEls += `<rect x="${x.toFixed(1)}" y="${barY}" width="${w.toFixed(1)}" height="${BAR_H}" fill="${color}" style="transform: scaleX(0); transform-box: fill-box; transform-origin: left center; animation: bar${gi} ${cycleEnd.toFixed(2)}s linear infinite;"/>\n`;
      prevT = grp.times[grp.times.length - 1];
    });
  }

  // Le serpent : 4 éléments gris clair qui rapetissent vers la queue et
  // suivent exactement le chemin de la tête, chacun une case derrière le
  // précédent — il épouse les virages comme dans snk.
  const SCALE = g.PITCH / 16;
  const SIZES = [14.4, 12.3, 10.8, 9.9].map((v) => v * SCALE);
  let snakeEls = "";
  for (let i = SEGMENTS; i >= 0; i--) {
    const size = SIZES[Math.min(i, SIZES.length - 1)];
    const delay = (i * SEG_LAG * STEP).toFixed(3);
    snakeEls += `<rect x="${(-size / 2).toFixed(2)}" y="${(-size / 2).toFixed(2)}" width="${size.toFixed(2)}" height="${size.toFixed(2)}" rx="${(size * 0.31).toFixed(2)}" fill="${SNAKE_COLOR}" style="animation: head ${cycleEnd.toFixed(2)}s linear ${delay}s infinite backwards;"/>\n`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${g.width}" height="${g.height}" viewBox="0 0 ${g.width} ${g.height}">
<style>
rect { shape-rendering: geometricPrecision; }
@keyframes head { ${headKf} }
${keyframes}
</style>
<rect width="${g.width}" height="${g.height}" fill="${bg}"/>
${cellRects}
${foodEls}
${barEls}${snakeEls}
</svg>`;
}
