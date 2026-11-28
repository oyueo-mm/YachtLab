import * as THREE from "three";

/**
 * Studio environment for dice reflections (FX-1). The camera looks straight down, so a top face mirrors
 * whatever is straight above it: the stock RoomEnvironment puts bright ceiling panels there and washed
 * every polished top face out to white (measured on glass / ruby / marble / frost). Here the zenith is a
 * dim, slightly warm grey; the light comes from soft panels at 35–55° elevation, so polished faces keep
 * their colour and depth while bevels and tilted faces catch clean highlights. Built once per table.
 */
export function studioScene(): { scene: THREE.Scene; dispose: () => void } {
  const scene = new THREE.Scene();
  const disposables: { dispose: () => void }[] = [];
  const sky = new THREE.SphereGeometry(20, 32, 16);
  const colors: number[] = [];
  const pos = sky.attributes.position;
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 20; // -1 floor … 1 zenith
    // floor dark, horizon brightest, zenith dim
    const l = y < 0 ? 0.05 + 0.12 * (1 + y) : 0.17 + 0.2 * Math.pow(1 - y, 1.6);
    c.setRGB(l * 1.02, l, l * 0.97);
    colors.push(c.r, c.g, c.b);
  }
  sky.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const skyMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true });
  scene.add(new THREE.Mesh(sky, skyMat));
  disposables.push(sky, skyMat);
  const panel = new THREE.PlaneGeometry(1, 1);
  disposables.push(panel);
  const add = (intensity: number, tint: number, w: number, h: number, azimuth: number, elevation: number) => {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(tint).multiplyScalar(intensity), side: THREE.DoubleSide });
    disposables.push(mat);
    const m = new THREE.Mesh(panel, mat);
    const r = 12;
    const el = (elevation * Math.PI) / 180, az = (azimuth * Math.PI) / 180;
    m.position.set(Math.cos(el) * Math.sin(az) * r, Math.sin(el) * r, Math.cos(el) * Math.cos(az) * r);
    m.scale.set(w, h, 1);
    m.lookAt(0, 0, 0);
    scene.add(m);
  };
  add(4.2, 0xfff4e6, 9, 4, -35, 48); // key softbox, upper left (matches the directional light)
  add(2.2, 0xe6efff, 5, 7, 140, 38); // cool strip, back right (rim)
  add(1.3, 0xffffff, 12, 2, 70, 30); // long low strip, right
  add(0.9, 0xffffff, 3, 3, 0, 72); // small top-front card: a gentle sheen on flat faces, not a white-out
  return { scene, dispose: () => disposables.forEach((d) => d.dispose()) };
}
