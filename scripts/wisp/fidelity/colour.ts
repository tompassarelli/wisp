import type { RGB } from "./image";
export type Lab = readonly [number, number, number];
export function lab(rgb: RGB): Lab {
  const [r,g,b] = rgb.map(v => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  const f = (v: number) => v > (6/29)**3 ? Math.cbrt(v) : v / (3 * (6/29)**2) + 4/29;
  const x = f(((r ?? 0)*0.4124564+(g ?? 0)*0.3575761+(b ?? 0)*0.1804375)/0.95047);
  const y = f((r ?? 0)*0.2126729+(g ?? 0)*0.7151522+(b ?? 0)*0.0721750);
  const z = f(((r ?? 0)*0.0193339+(g ?? 0)*0.1191920+(b ?? 0)*0.9503041)/1.08883);
  return [116*y-16,500*(x-y),200*(y-z)];
}
export function deltaE00(a: Lab, b: Lab): number {
  const rad = Math.PI/180, deg = 180/Math.PI;
  const c1 = Math.hypot(a[1],a[2]), c2 = Math.hypot(b[1],b[2]);
  const cm = (c1+c2)/2, g = (1-Math.sqrt(cm**7/(cm**7+25**7)))/2;
  const ap = a[1]*(1+g), bp = b[1]*(1+g);
  const ca = Math.hypot(ap,a[2]), cb = Math.hypot(bp,b[2]);
  const hue = (x: number,y: number) => (Math.atan2(y,x)*deg+360)%360;
  const ha = ca === 0 ? 0 : hue(ap,a[2]), hb = cb === 0 ? 0 : hue(bp,b[2]);
  let dh = hb-ha;
  if (ca*cb === 0) dh = 0; else if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
  const dl = b[0]-a[0], dc = cb-ca, dH = 2*Math.sqrt(ca*cb)*Math.sin(dh*rad/2);
  const lm = (a[0]+b[0])/2, cp = (ca+cb)/2;
  const hm = ca*cb === 0 ? ha+hb : Math.abs(ha-hb) <= 180 ? (ha+hb)/2 : (ha+hb+(ha+hb < 360 ? 360 : -360))/2;
  const t = 1-0.17*Math.cos((hm-30)*rad)+0.24*Math.cos(2*hm*rad)+0.32*Math.cos((3*hm+6)*rad)-0.20*Math.cos((4*hm-63)*rad);
  const sl = 1+0.015*(lm-50)**2/Math.sqrt(20+(lm-50)**2), sc = 1+0.045*cp, sh = 1+0.015*cp*t;
  const rt = -2*Math.sqrt(cp**7/(cp**7+25**7))*Math.sin(60*Math.exp(-(((hm-275)/25)**2))*rad);
  return Math.sqrt((dl/sl)**2+(dc/sc)**2+(dH/sh)**2+rt*(dc/sc)*(dH/sh));
}
