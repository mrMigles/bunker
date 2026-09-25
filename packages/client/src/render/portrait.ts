// Portraits of the residents as they look in the game: their own 3D model (clothes, hat, skin, hair) drawn
// once by one small offscreen renderer and kept as an image. Every screen that shows a face uses this,
// so a cook in a white cap is a cook in a white cap everywhere — not one of four stock pictures.
import * as THREE from "three";
import { CharView } from "./chars";
import { h } from "../ui/dom";

type Look = { color: number; hat: number; skin?: number; hair?: number };

const SIZE_W = 120;
const SIZE_H = 136;
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
const cache = new Map<string, string>();
let failed = false;

function setup() {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE_W * 2;
  canvas.height = SIZE_H * 2;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(SIZE_W * 2, SIZE_H * 2, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xd8c0a0, 1.2));
  const key = new THREE.DirectionalLight(0xffd29a, 2.2);
  key.position.set(2.5, 3, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fc4ff, 1.1);
  rim.position.set(-3, 2, -2);
  scene.add(rim);
  camera = new THREE.PerspectiveCamera(22, SIZE_W / SIZE_H, 0.1, 30);
  camera.position.set(0.45, 1.28, 2.55);
  camera.lookAt(0, 1.1, 0);
}

/** A data URL with the portrait of this look (null when WebGL is not available). */
export function portraitURL(id: string, look: Look): string | null {
  const key = `${look.color}|${look.hat}|${look.skin ?? "-"}|${look.hair ?? "-"}|${look.skin === undefined || look.hair === undefined ? id : ""}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (failed) return null;
  try {
    if (!renderer) setup();
    const view = CharView.of(id, look);
    view.update(0.016, "idle", 0);
    view.root.rotation.y = 0.28;
    scene.add(view.root);
    renderer!.render(scene, camera);
    const url = renderer!.domElement.toDataURL("image/png");
    scene.remove(view.root);
    view.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry?.dispose?.();
    });
    cache.set(key, url);
    return url;
  } catch {
    failed = true;
    return null;
  }
}

/** A portrait element for a resident; falls back to the stock picture when WebGL is unavailable. */
export function portrait(id: string, look: Look, cls = "", fallback?: () => HTMLElement): HTMLElement {
  const url = portraitURL(id, look);
  if (!url && fallback) {
    const f = fallback();
    if (cls) f.classList.add(...cls.split(" ").filter(Boolean));
    return f;
  }
  return h("span.portrait" + (cls ? "." + cls.split(" ").join(".") : ""), { style: { backgroundImage: (url ? `url(${url}), ` : "") + "radial-gradient(circle at 50% 35%, #5a3a22, #1c1512 75%)" }, "aria-hidden": "true" });
}
