// Post-processing for the one shared WebGL renderer: soft bloom on lamps and fire, a filmic grade (warm
// highlights, cool shadows, a touch more contrast), vignette, fine film grain and a hint of chromatic
// fringing at the edges. «Качество» in the settings: full / light (no bloom) / off. Phones default to light.
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

export type FxQuality = "full" | "light" | "off";

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    time: { value: 0 },
    vignette: { value: 0.42 },
    grain: { value: 0.035 },
    aberration: { value: 0.0016 },
    saturation: { value: 1.06 },
    contrast: { value: 1.08 },
    warmth: { value: 1.0 },
    flash: { value: 0 },
    danger: { value: 0 },
    resolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time, vignette, grain, aberration, saturation, contrast, warmth, flash, danger;
    uniform vec2 resolution;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      // chromatic fringing grows toward the corners only
      vec2 off = d * aberration * (0.4 + r2 * 3.0);
      vec3 c;
      c.r = texture2D(tDiffuse, vUv + off).r;
      c.g = texture2D(tDiffuse, vUv).g;
      c.b = texture2D(tDiffuse, vUv - off).b;
      // grade: contrast around mid-grey, saturation, split toning (warm highlights, teal shadows)
      c = (c - 0.5) * contrast + 0.5;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l), c, saturation);
      vec3 warm = vec3(1.06, 1.0, 0.9);
      vec3 cool = vec3(0.9, 0.98, 1.06);
      c *= mix(cool, warm, smoothstep(0.15, 0.75, l) * warmth);
      // vignette (a little red when someone is dying or the bunker is in trouble)
      float v = smoothstep(0.85, 0.2, sqrt(r2) * (1.0 + vignette));
      c *= mix(1.0 - vignette * 0.9, 1.0, v);
      c = mix(c, c * vec3(1.25, 0.7, 0.65), danger * (1.0 - v) * 0.8);
      // film grain, finer on bigger screens
      float g = hash(vUv * resolution + fract(time) * 100.0) - 0.5;
      c += g * grain;
      c += flash;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }
  `,
};

export class PostFX {
  composer: EffectComposer;
  private renderPass: RenderPass;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;
  quality: FxQuality;
  private t0 = performance.now();
  /** set by the game for a red edge when someone is down or the bunker is under attack */
  danger = 0;
  flash = 0;

  constructor(private renderer: THREE.WebGLRenderer, quality?: FxQuality) {
    const saved = (() => {
      try {
        return localStorage.getItem("bunker.fx") as FxQuality | null;
      } catch {
        return null;
      }
    })();
    const phone = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
    // automated browsers (e2e) render on the CPU: effects would only slow the game clock down there
    const robot = navigator.webdriver === true;
    this.quality = quality ?? saved ?? (robot || localStorage.getItem("bunker.post") === "0" ? "off" : phone ? "light" : "full");
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    const size = renderer.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(new THREE.Scene(), new THREE.Camera());
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.42, 0.55, 0.78);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    // tone mapping and sRGB first, then the grade works on display values (and writes to the screen)
    this.composer.addPass(new OutputPass());
    this.composer.addPass(this.grade);
    this.apply();
  }

  setQuality(q: FxQuality) {
    this.quality = q;
    try {
      localStorage.setItem("bunker.fx", q);
    } catch {}
    this.apply();
  }

  private apply() {
    this.bloom.enabled = this.quality === "full";
    const u = this.grade.uniforms;
    u.grain.value = this.quality === "full" ? 0.035 : 0.02;
    u.aberration.value = this.quality === "full" ? 0.0016 : 0;
  }

  setSize(w: number, h: number) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.grade.uniforms.resolution.value.set(w, h);
  }

  render(scene: THREE.Scene, camera: THREE.Camera) {
    if (this.quality === "off") {
      this.renderer.render(scene, camera);
      return;
    }
    const size = this.renderer.getSize(new THREE.Vector2());
    if (this.grade.uniforms.resolution.value.x !== size.x || this.grade.uniforms.resolution.value.y !== size.y) this.setSize(size.x, size.y);
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    const u = this.grade.uniforms;
    u.time.value = (performance.now() - this.t0) / 1000;
    u.danger.value += (this.danger - u.danger.value) * 0.05;
    u.flash.value = this.flash;
    this.composer.render();
  }
}

let shared: PostFX | null = null;
/** The one PostFX for the shared renderer (created on first use). */
export function postfx(renderer: THREE.WebGLRenderer) {
  if (!shared) shared = new PostFX(renderer);
  return shared;
}
