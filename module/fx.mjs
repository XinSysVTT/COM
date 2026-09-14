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

/* -------------------------------------------- */
/* Explosions                                   */
/* -------------------------------------------- */

/**
 * Barrel detonation: white-hot flash, expanding fireball, a shockwave ring
 * and flying sparks. `radius` is the blast radius in grid cells. Resolves
 * once the main fireball has played out (sparks keep flying on their own).
 */
export async function explosion({ x, y, radius = 2 }) {
  try {
    const l = layer();
    if (!l) return;
    const R = canvas.grid.size * (radius + 0.6);

    // White-hot flash at the core.
    const flash = new PIXI.Graphics();
    flash.beginFill(0xfff6dd, 0.95).drawCircle(0, 0, canvas.grid.size * 0.4).endFill();
    flash.beginFill(0xffe9a0, 0.6).drawCircle(0, 0, canvas.grid.size * 0.62).endFill();
    flash.position.set(x, y);
    l.addChild(flash);
    tween(260, (t) => {
      flash.scale.set(1 + t * 1.6);
      flash.alpha = 1 - t;
    }).then(() => flash.destroy());

    // Fireball: layered orange discs eating outward.
    const fire = new PIXI.Container();
    const core = new PIXI.Graphics();
    core.beginFill(0xffdd77, 0.9).drawCircle(0, 0, canvas.grid.size * 0.5).endFill();
    core.beginFill(0xff9030, 0.75).drawCircle(0, 0, canvas.grid.size * 0.8).endFill();
    core.beginFill(0xc23c10, 0.5).drawCircle(0, 0, canvas.grid.size * 1.05).endFill();
    fire.addChild(core);
    fire.position.set(x, y);
    l.addChild(fire);
    await tween(480, (t) => {
      const e = 1 - Math.pow(1 - t, 2); // ease-out
      fire.scale.set(0.25 + e * (R / (canvas.grid.size * 1.05) - 0.25));
      fire.alpha = 1 - t * t;
    });
    fire.destroy();

    // Shockwave ring racing past the fireball edge.
    const ring = new PIXI.Graphics();
    ring.lineStyle({ width: 4, color: 0xffd9a0, alpha: 0.8, cap: PIXI.LINE_CAP.ROUND }).drawCircle(0, 0, R * 0.35);
    ring.position.set(x, y);
    l.addChild(ring);
    tween(520, (t) => {
      ring.scale.set(0.3 + t * (R / (R * 0.35) - 0.3));
      ring.alpha = 0.8 * (1 - t);
    }).then(() => ring.destroy());

    // Sparks: burning chunks flung outward.
    const sparks = [];
    for (let i = 0; i < 12; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = R * (0.5 + Math.random() * 0.8);
      const s = new PIXI.Graphics();
      s.beginFill(i % 3 === 0 ? 0xfff2c0 : 0xff8a2a, 0.95).drawCircle(0, 0, 2 + Math.random() * 2.5).endFill();
      s.position.set(x, y);
      l.addChild(s);
      sparks.push({ s, ang, dist, spin: (Math.random() - 0.5) * 6 });
      tween(500 + Math.random() * 350, (t) => {
        s.x = x + Math.cos(ang) * dist * t;
        s.y = y + Math.sin(ang) * dist * t - Math.sin(t * Math.PI) * canvas.grid.size * 0.35;
        s.alpha = 1 - t;
        s.rotation = ang + t * s.spin;
      }).then(() => s.destroy());
    }
  } catch (err) {
    console.warn("COM: explosion effect skipped", err);
  }
}
