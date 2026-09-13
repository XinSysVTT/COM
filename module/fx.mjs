/**
 * Attack visual effects: muzzle flash, tracer bolt, impact flash and a
 * melee slash. Everything draws on a lightweight container above the
 * canvas, cleans itself up, and never throws into the combat flow.
 */
import { SQ } from "./config.mjs";
import * as H from "./helpers.mjs";

const LAYER_NAME = "com-fx";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** The overlay container holding all attack effects (created on demand). */
function layer() {
  if (!canvas.interface) return null;
  let l = canvas.interface.getChildByName(LAYER_NAME);
  if (!l) {
    l = new PIXI.Container();
    l.name = LAYER_NAME;
    l.eventMode = "none";
    canvas.interface.addChild(l);
  }
  return l;
}

/** Minimal rAF tween: calls fn(t) with t running 0→1 over `ms`. */
function tween(ms, fn) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      fn(t);
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

/**
 * Play the attack animation and resolve when the shot lands, so damage is
 * applied as the bolt arrives. `melee` weapons draw a slash instead.
 */
export async function shoot({ attacker, target, hit, melee = false }) {
  try {
    if (melee) await slash(target);
    else await gunshot(attacker, target, hit);
  } catch (err) {
    console.warn("COM: attack effect skipped", err);
  }
}

/* -------------------------------------------- */
/* Gun fire                                     */
/* -------------------------------------------- */

async function gunshot(attacker, target, hit) {
  const l = layer();
  if (!l) return;
  const s = H.tokenCenter(attacker);
  const t = H.tokenCenter(target);

  // A miss visibly misses: the bolt deflects past the target instead.
  let e = { x: t.x, y: t.y };
  if (!hit) {
    const ang = Math.atan2(t.y - s.y, t.x - s.x) + Math.PI / 2;
    const off = canvas.grid.size * (0.45 + Math.random() * 0.5) * (Math.random() < 0.5 ? -1 : 1);
    e = { x: t.x + Math.cos(ang) * off, y: t.y + Math.sin(ang) * off };
  }

  // Muzzle flash (runs while the bolt travels).
  const muzzle = new PIXI.Graphics();
  muzzle.beginFill(0xfff2c0, 0.9).drawCircle(0, 0, 7).endFill();
  muzzle.beginFill(0xffffff, 0.9).drawCircle(0, 0, 3).endFill();
  muzzle.position.set(s.x, s.y);
  l.addChild(muzzle);
  tween(130, (t) => {
    muzzle.scale.set(1 + t * 1.7);
    muzzle.alpha = 1 - t;
  }).then(() => muzzle.destroy());

  // Tracer bolt travelling from muzzle to impact point.
  const dist = Math.hypot(e.x - s.x, e.y - s.y);
  const dur = Math.max(180, Math.min(550, dist));
  const len = Math.min(canvas.grid.size * 1.1, dist * 0.55);
  const bolt = new PIXI.Graphics();
  bolt.lineStyle({ width: 5, color: SQ.FX_TRACER_GLOW, alpha: 0.45, cap: PIXI.LINE_CAP.ROUND })
    .moveTo(-len / 2, 0)
    .lineTo(len / 2, 0);
  bolt.lineStyle({ width: 2, color: SQ.FX_TRACER, alpha: 0.95, cap: PIXI.LINE_CAP.ROUND })
    .moveTo(-len / 2 + 2, 0)
    .lineTo(len / 2, 0);
  bolt.beginFill(SQ.FX_TRACER, 0.95).drawCircle(len / 2, 0, 3).endFill();
  const holder = new PIXI.Container();
  holder.addChild(bolt);
  holder.rotation = Math.atan2(e.y - s.y, e.x - s.x);
  holder.position.set(s.x, s.y);
  l.addChild(holder);
  await tween(dur, (t) => {
    holder.x = s.x + (e.x - s.x) * t;
    holder.y = s.y + (e.y - s.y) * t;
  });
  holder.destroy();

  // On a hit, flash the full beam between shooter and victim so the tracer
  // clearly completes; a miss just pops the small deflection spark.
  if (hit) {
    const beam = new PIXI.Graphics();
    beam.lineStyle({ width: 2, color: 0xffe9a0, alpha: 0.85, cap: PIXI.LINE_CAP.ROUND })
      .moveTo(s.x, s.y)
      .lineTo(t.x, t.y);
    l.addChild(beam);
    tween(220, (t) => {
      beam.alpha = 1 - t;
    }).then(() => beam.destroy());
  }

  // Impact flash: bold on the target, small spark on a deflection.
  const impact = new PIXI.Graphics();
  if (hit) {
    impact.beginFill(0xffd77a, 0.85).drawCircle(0, 0, 9).endFill();
    impact.beginFill(0xffffff, 1).drawCircle(0, 0, 4).endFill();
  } else {
    impact.beginFill(0xfff2c0, 0.8).drawCircle(0, 0, 4).endFill();
  }
  impact.position.set(e.x, e.y);
  l.addChild(impact);
  await tween(hit ? 320 : 180, (t) => {
    impact.scale.set(1 + t * (hit ? 2.2 : 1.2));
    impact.alpha = 1 - t;
  });
  impact.destroy();
}

/* -------------------------------------------- */
/* Melee                                        */
/* -------------------------------------------- */

async function slash(target) {
  const l = layer();
  if (!l) return;
  const t = H.tokenCenter(target);
  const g = new PIXI.Graphics();
  g.lineStyle({ width: 3, color: 0xffffff, alpha: 0.9, cap: PIXI.LINE_CAP.ROUND });
  g.arc(0, 0, canvas.grid.size * 0.55, -0.9, 0.9);
  g.position.set(t.x, t.y);
  l.addChild(g);
  await tween(240, (t) => {
    g.rotation = -0.6 + t * 1.2;
    g.scale.set(0.8 + t * 0.4);
    g.alpha = 1 - t * 0.9;
  });
  g.destroy();
}
