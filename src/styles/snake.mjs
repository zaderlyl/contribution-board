// Style "snake" : un serpent traverse la grille et mange chaque jour actif.
// À chaque pas il file vers le commit non mangé le plus proche (plus court
// chemin, sans traverser son propre corps). Sa longueur reste constante.
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

const STEP = 0.18;        // s par case parcourue (lent : ~5,5 cases/s)
const MAX_STEPS = 6000;   // garde-fou
const START_LEN = 4;      // longueur, constante (tête + 3 segments)
const HOLD = 1.0;         // s, pause avant la remise à zéro
const RESET_DUR = 0.5;    // s, le serpent disparaît et les commits reviennent
const SEGMENTS = 3;       // segments derrière la tête
const SEG_LAG = 1;        // retard de chaque segment sur le précédent, en pas (= une case)
const SNAKE_COLOR = "#e0e0e0";
const BAR_H = 5;          // hauteur de la barre de progression
const BAR_GAP = 8;        // espace entre la grille et la barre
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

function simulate(days, cols) {
  const key = (c, r) => c * 7 + r;
  const food = new Map(days.filter((d) => d.count > 0).map((d) => [key(d.col, d.row), d]));
  const inGrid = (c, r) => c >= 0 && c < cols && r >= 0 && r < 7;

  let head = { c: 0, r: 3 };
  const body = [{ ...head }]; // du plus ancien (queue) au plus récent (tête)
  const occ = new Set([key(head.c, head.r)]);
  const heads = [{ ...head }];          // position de la tête à chaque pas
  const eats = [];                      // { step, day }
  const enters = new Map();             // case -> instants d'entrée (pas)
  const leaves = new Map();             // case -> instants de sortie (pas)
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  push(enters, key(head.c, head.r), 0);
  let grow = START_LEN - 1;

  // Cases libres atteignables depuis `from` (pour choisir un cul-de-sac le moins
  // mauvais quand aucun commit n'est atteignable).
  const reachable = (from, blocked) => {
    const seen = new Set([key(from.c, from.r)]);
    const q = [from];
    while (q.length) {
      const p = q.pop();
      for (const [dc, dr] of DIRS) {
        const c = p.c + dc, r = p.r + dr, k = key(c, r);
        if (!inGrid(c, r) || seen.has(k) || blocked.has(k)) continue;
        seen.add(k); q.push({ c, r });
      }
    }
    return seen.size;
  };

  const release = (step, cell) => {
    occ.delete(key(cell.c, cell.r));
    push(leaves, key(cell.c, cell.r), step);
  };

  let step = 0, shrinks = 0;
  while (food.size > 0 && step < MAX_STEPS) {
    const tail = body[0];
    const tailK = key(tail.c, tail.r);
    // La queue libère sa case au même pas, sauf si on grandit.
    const blocked = new Set(occ);
    if (grow === 0) blocked.delete(tailK);

    // BFS vers le commit le plus proche.
    const prev = new Map([[key(head.c, head.r), null]]);
    const queue = [head];
    let goal = null;
    for (let i = 0; i < queue.length && !goal; i++) {
      const p = queue[i];
      for (const [dc, dr] of DIRS) {
        const c = p.c + dc, r = p.r + dr, k = key(c, r);
        if (!inGrid(c, r) || prev.has(k) || blocked.has(k)) continue;
        prev.set(k, p);
        if (food.has(k)) { goal = { c, r }; break; }
        queue.push({ c, r });
      }
    }

    let next = null;
    if (goal) {
      let p = goal, back = null;
      while (prev.get(key(p.c, p.r))) { back = p; p = prev.get(key(p.c, p.r)); }
      next = back;
    } else {
      // Aucun commit atteignable : on prend la case libre la plus ouverte.
      let best = -1;
      for (const [dc, dr] of DIRS) {
        const c = head.c + dc, r = head.r + dr, k = key(c, r);
        if (!inGrid(c, r) || blocked.has(k)) continue;
        const room = reachable({ c, r }, new Set([...blocked, key(head.c, head.r)]));
        if (room > best) { best = room; next = { c, r }; }
      }
    }

    if (!next) {
      // Enfermé : le serpent se raccourcit à sa longueur de départ et repart.
      shrinks++;
      while (body.length > START_LEN) release(step, body.shift());
      grow = 0;
      if (shrinks > 200) break;
      continue;
    }

    step++;
    const nk = key(next.c, next.r);
    if (grow > 0) grow--;
    else release(step, body.shift());
    head = next;
    body.push({ ...head });
    occ.add(nk);
    push(enters, nk, step);
    heads.push({ ...head });
    if (food.has(nk)) { eats.push({ step, day: food.get(nk) }); food.delete(nk); }
  }

  // Ce qu'il reste du serpent disparaît à la fin de la simulation.
  const endStep = step;
  for (const cell of body) push(leaves, key(cell.c, cell.r), endStep + HOLD / STEP);
  return { heads, eats, enters, leaves, endStep, key };
}

export function render(days, opts = {}) {
  const accent = `#${(opts.accent ?? "ff9100").replace(/^#/, "")}`;
  const bg = opts.background ?? "#0d1117";
  const g = gridGeometry(days, { top: 8, left: 8, right: 8, bottom: 8 + BAR_GAP + BAR_H });
  const { heads, eats, enters, leaves, endStep, key } = simulate(days, g.cols);

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
