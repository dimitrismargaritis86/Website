import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";

const canvas = document.getElementById("car-canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth < 640 ? 1 : 1.5));
renderer.setSize(innerWidth, innerHeight);

let fxActive = true;
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver((es) => { fxActive = es[0].isIntersecting; }, { threshold: 0 });
  const target = document.querySelector(".car-fx");
  if (target) io.observe(target);
}
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.1, 100);
const CAM_LOOK = new THREE.Vector3(0, 0.5, 0);
const CAM_BASE = new THREE.Vector3(0.09, 1.23, 9.01);
const CAM_DIR = new THREE.Vector3();
let CAM_DIST = 0;

function frameForAspect() {
  const aspect = innerWidth / innerHeight;
  const ref = 1.6;
  const mul = aspect >= ref ? 1 : Math.min(3.0, (ref / aspect) * 1.12);
  CAM_BASE.set(0.09, 1.23, 9.01 * mul);
  CAM_DIR.copy(CAM_LOOK).sub(CAM_BASE).normalize();
  CAM_DIST = CAM_BASE.distanceTo(CAM_LOOK);
  camera.position.copy(CAM_BASE);
  camera.lookAt(CAM_LOOK);
}
frameForAspect();

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment()).texture;
scene.environmentIntensity = 0.35;

RectAreaLightUniformsLib.init();
const boxKey = new THREE.RectAreaLight(0xffffff, 4, 9, 3.2);
boxKey.position.set(2.5, 6.5, 5); boxKey.lookAt(0, 0.5, 0); scene.add(boxKey);
const boxSide = new THREE.RectAreaLight(0xeaf0ff, 2.5, 7.5, 3);
boxSide.position.set(-5.5, 2.2, 5); boxSide.lookAt(0, 0.55, -0.5); scene.add(boxSide);
const rimG = new THREE.DirectionalLight(0x39ff8a, 0.7); rimG.position.set(7, 2.5, -6); scene.add(rimG);
scene.add(new THREE.AmbientLight(0x3a414d, 0.12));

const carGroup = new THREE.Group();
scene.add(carGroup);
let wheelPivots = [];

const PATH = new THREE.CatmullRomCurve3([
  new THREE.Vector3(21, 0.6, -18),
  new THREE.Vector3(4.5, 0.6, -17),
  new THREE.Vector3(0, 0.30, 0.1),
]);
const START_ROT = Math.PI * -0.42;
const END_ROT = Math.PI * -0.15;
const TURN_START = 0.15;
const ENTRANCE_END = 0.077;
const WHEEL_SPIN = -7.0;
let carRoot = null;
let progress = 0;
let prevEase = 0;
let wheelAngle = 0;
let services = [];
let segStart = [], segLen = [];
const _pos = new THREE.Vector3();
const _prevPos = PATH.getPoint(0);

const loader = new GLTFLoader();
const draco = new DRACOLoader();
draco.setDecoderPath("https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/");
loader.setDRACOLoader(draco);
loader.load("models/supra.glb?v=5", async (gltf) => {
  const car = gltf.scene;
  const box = new THREE.Box3().setFromObject(car);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  car.position.sub(center);
  const s = 5.8 / size.length();
  car.scale.setScalar(s);
  car.updateWorldMatrix(true, true);

  const _box = new THREE.Box3();
  const bctr = (o) => _box.setFromObject(o).getCenter(new THREE.Vector3());
  const cands = [];
  car.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const mat = o.material, mn = mat.name || "";
    if (mn === "body" || mn === "body.002") {
      mat.color.setRGB(0.006, 0.006, 0.008);
      mat.metalness = 0.6; mat.roughness = 0.22; mat.envMapIntensity = 0.5;
    }
    if (/tire|rubber|whipper/i.test(mn)) {
      mat.color.setRGB(0.02, 0.02, 0.022);
      mat.metalness = 0.0; mat.roughness = 0.85;
      if (mat.map) mat.map = null;
    }
    if (mn === "chrome.001") {
      mat.color.setRGB(0.02, 0.02, 0.022);
      mat.metalness = 0.9; mat.roughness = 0.4;
    }
    if (mn === "white") {
      mat.color.setRGB(0.02, 0.02, 0.022);
      mat.metalness = 0.0; mat.roughness = 0.6;
    }
    if (/brake/i.test(mn)) {
      mat.color.setRGB(0.12, 0.12, 0.13);
      mat.metalness = 0.85; mat.roughness = 0.33;
      if (mat.map) mat.map = null;
    }

    if (/^rim|^brake/i.test(o.name) || /tire|brake/i.test(mn)) cands.push(o);
  });

  const buckets = { LF: [], RF: [], LR: [], RR: [] };
  for (const m of cands) {
    const c = bctr(m);
    buckets[(c.x < 0 ? "L" : "R") + (c.z < 0 ? "F" : "R")].push(m);
  }
  const _v = new THREE.Vector3();
  for (const key of Object.keys(buckets)) {
    const grp = buckets[key];
    if (!grp.length) continue;
    const round = grp.filter((m) => /^rim/i.test(m.name) || /tire/i.test((m.material && m.material.name) || ""));
    const rp = round.length ? round : grp;
    const bb = new THREE.Box3();
    rp.forEach((m) => bb.expandByObject(m));
    const center2 = bb.getCenter(new THREE.Vector3());
    const xs = [], zs = [];
    for (const m of rp) {
      const pos = m.geometry.attributes.position;
      const step = Math.max(1, Math.floor(pos.count / 120));
      for (let i = 0; i < pos.count; i += step) {
        _v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        car.worldToLocal(_v);
        xs.push(_v.x); zs.push(_v.z);
      }
    }
    let mx = 0, mz = 0;
    for (let i = 0; i < xs.length; i++) { mx += xs[i]; mz += zs[i]; }
    mx /= xs.length; mz /= zs.length;
    let cxx = 0, cxz = 0, czz = 0;
    for (let i = 0; i < xs.length; i++) {
      const dx = xs[i] - mx, dz = zs[i] - mz;
      cxx += dx * dx; cxz += dx * dz; czz += dz * dz;
    }
    const tr = (cxx + czz) / 2, dsc = Math.sqrt(((cxx - czz) / 2) ** 2 + cxz * cxz);
    const lmin = tr - dsc;
    let nx = cxz, nz = lmin - cxx;
    if (Math.abs(nx) + Math.abs(nz) < 1e-6) { nx = lmin - czz; nz = cxz; }
    const axle = new THREE.Vector3(nx, 0, nz).normalize();
    const pivot = new THREE.Group();
    pivot.position.copy(car.worldToLocal(center2.clone()));
    pivot.userData.axle = axle;
    pivot.userData.key = key;
    car.add(pivot);
    grp.forEach((m) => pivot.attach(m));
    wheelPivots.push(pivot);
  }

  const sideAvg = (pred) => {
    const v = new THREE.Vector3(); let n = 0;
    for (const pv of wheelPivots) if (pred(pv.userData.key)) { v.add(pv.position); n++; }
    return n ? v.divideScalar(n) : null;
  };
  const leftC = sideAvg((k) => k[0] === "L");
  const rightC = sideAvg((k) => k[0] === "R");
  const rollAxis = new THREE.Vector3(1, 0, 0);
  if (leftC && rightC) rollAxis.copy(rightC).sub(leftC).setY(0).normalize();
  for (const pv of wheelPivots) {
    const a = pv.userData.axle.clone();
    if (a.dot(rollAxis) < 0) a.negate();
    pv.userData.base = new THREE.Quaternion().setFromUnitVectors(a, rollAxis);
    pv.userData.roll = rollAxis;
    pv.quaternion.copy(pv.userData.base);
  }

  const P = (x, y, z) => new THREE.Vector3(x, y, z);
  services = [
    { t: "Αλλαγή λαδιών",        yaw: -0.5236, pitch:  0.0698, zoom: 1.15, p: P(0.203, 0.561, 1.208) },
    { t: "Αλλαγή φίλτρων",       yaw: -0.6458, pitch: -0.0175, zoom: 1.30, p: P(0.574, 0.278, 1.275) },
    { t: "Καθαρισμός μπεκ",      yaw: -0.3840, pitch:  0.0524, zoom: 1.15, p: P(0.223, 0.580, 1.133) },
    { t: "Αλλαγή μπαταρίας",     yaw: -0.2618, pitch:  0.0698, zoom: 1.45, p: P(0.339, 0.531, 1.237) },
    { t: "Επισκευή κινητήρα",    yaw:  0.0000, pitch:  0.1745, zoom: 1.30, p: P(-0.001, 0.603, 1.037) },
    { t: "Service κινητήρα",     yaw: -0.3840, pitch:  0.1745, zoom: 1.30, p: P(0.039, 0.583, 1.143) },
    { t: "Έλεγχος φώτων",        yaw: -0.3840, pitch:  0.0873, zoom: 1.55, p: P(0.431, 0.423, 1.333) },
    { t: "Έλεγχος κλιματισμού",  yaw: -2.0944, pitch:  0.2094, zoom: 1.55, p: P(0.483, 0.653, -0.217) },
    { t: "Διαγνωστικός έλεγχος", yaw: -2.3038, pitch:  0.3491, zoom: 1.40, p: P(0.516, 0.586, 0.023) },
    { t: "Έλεγχος ανάρτησης",    yaw: -0.8552, pitch: -0.1222, zoom: 1.30, p: P(0.522, 0.469, 0.904) },
    { t: "Έλεγχος φρένων",       yaw: -1.1519, pitch:  0.0000, zoom: 1.70, p: P(0.604, 0.349, 0.841) },
    { t: "Έλεγχος εξατμίσεων",   yaw: -2.8623, pitch:  0.0000, zoom: 1.85, p: P(0.369, 0.195, -1.213) },
    { t: "Και πολλά άλλα",       yaw:  0.0000, pitch:  0.0000, zoom: 2.20, p: P(-0.002, 0.612, -0.123),
      camPos: P(0, 1.15, 1.8), camLook: P(0, 1.05, 1.3), labelAt: 0.12, labelOut: 0.5,
      labelSize: 1.1, offX: 0, offY: -30 },
  ];

  if (document.documentElement.lang === "en") {
    const EN = ["Oil change", "Filter replacement", "Injector cleaning", "Battery replacement",
      "Engine repair", "Engine service", "Headlight inspection", "Air conditioning inspection",
      "Diagnostic check", "Suspension inspection", "Brake inspection", "Exhaust inspection",
      "And many more"];
    services.forEach((s, i) => { if (EN[i]) s.t = EN[i]; });
  }

  {
    const w = services.map((sv, i) => (i === services.length - 1 ? 2.0 : 1));
    const tot = w.reduce((a, b) => a + b, 0);
    let acc = 0;
    for (let i = 0; i < w.length; i++) { segStart[i] = acc / tot; segLen[i] = w[i] / tot; acc += w[i]; }
  }

  carRoot = car;
  carGroup.add(car);

  const yield_ = () => new Promise((r) => requestAnimationFrame(r));
  PATH.getPoint(1, _pos);
  carGroup.position.copy(_pos);
  car.rotation.y = END_ROT;
  try { await renderer.compileAsync(scene, camera); } catch (e) {}
  await yield_();
  renderer.render(scene, camera);
  await yield_();

  PATH.getPoint(0, _pos);
  carGroup.position.copy(_pos);
  car.rotation.y = START_ROT;
  renderer.render(scene, camera);
});

gsap.registerPlugin(ScrollTrigger);

requestAnimationFrame(() => {
  ScrollTrigger.create({
    trigger: ".car-fx", start: "top top", end: "+=3400%", pin: true, scrub: 1,
    onUpdate: (self) => { progress = self.progress; },
  });
});

const elLabel = document.getElementById("svcLabel");
const elLine = document.getElementById("svcLine");
const elDot = document.getElementById("svcDot");
const elFade = document.getElementById("carFade");
const elTitle = document.getElementById("fxTitle");
const _wp = new THREE.Vector3();
const _look = new THREE.Vector3();

function finalLabel(op) {
  const s = services[services.length - 1];
  if (!s || !carRoot) { elLabel.style.opacity = 0; return; }
  _wp.copy(s.p); carRoot.localToWorld(_wp); _wp.project(camera);
  const sx = (_wp.x * 0.5 + 0.5) * innerWidth + (s.offX || 0);
  const sy = (-_wp.y * 0.5 + 0.5) * innerHeight + (s.offY || 0);
  elLabel.textContent = s.t;
  elLabel.style.background = "rgba(5,10,14,0.82)";
  elLabel.style.transform = "translate(-50%,-50%)";
  elLabel.style.fontSize = (s.labelSize || 1.6) + "rem";
  elLabel.style.left = sx + "px"; elLabel.style.top = sy + "px";
  elLabel.style.opacity = Math.max(0, op);
  elLine.setAttribute("opacity", 0); elDot.setAttribute("opacity", 0);
}

function drawArrow(idx, op) {
  if (idx < 0 || op <= 0.01 || !carRoot) { clearArrow(); return; }
  _wp.copy(services[idx].p);
  carRoot.localToWorld(_wp);
  _wp.project(camera);
  const sx = (_wp.x * 0.5 + 0.5) * innerWidth;
  const sy = (-_wp.y * 0.5 + 0.5) * innerHeight;
  const off = Math.min(innerWidth * 0.15, 160);
  const m = 90;
  const lx = Math.min(Math.max(sx < innerWidth * 0.5 ? sx - off : sx + off, m), innerWidth - m);
  const ly = Math.min(Math.max(sy - innerHeight * 0.14, 44), innerHeight - 44);
  elLabel.textContent = services[idx].t;
  elLabel.style.background = "rgba(5,10,14,0.82)";
  elLabel.style.transform = "translate(-50%,-50%)";
  elLabel.style.fontSize = "";
  elLabel.style.left = lx + "px"; elLabel.style.top = ly + "px"; elLabel.style.opacity = op;
  elLine.setAttribute("x1", sx); elLine.setAttribute("y1", sy);
  elLine.setAttribute("x2", lx); elLine.setAttribute("y2", ly); elLine.setAttribute("opacity", op);
  elDot.setAttribute("cx", sx); elDot.setAttribute("cy", sy); elDot.setAttribute("opacity", op);
}
function clearArrow() {
  elLabel.style.opacity = 0; elLabel.style.fontSize = ""; elLabel.style.transform = "translate(-50%,-50%)";
  elLine.setAttribute("opacity", 0); elDot.setAttribute("opacity", 0);
}
function applyZoom(z) {
  camera.position.copy(CAM_LOOK).addScaledVector(CAM_DIR, -CAM_DIST / z);
  camera.lookAt(CAM_LOOK);
}
function renderFinal(fr, pz) {
  const cur = services[services.length - 1];
  const DIVE = 0.4;
  const la = cur.labelAt != null ? cur.labelAt : 0.45;
  const lo = cur.labelOut != null ? cur.labelOut : 1.0;
  if (fr < DIVE) {
    const k = fr / DIVE, ks = k * k * (3 - 2 * k);
    applyZoom(pz + (1 - pz) * ks);
    clearArrow(); elFade.style.opacity = 0;
  } else {
    const g = (fr - DIVE) / (1 - DIVE), dv = g * g * (3 - 2 * g);
    camera.position.lerpVectors(CAM_BASE, cur.camPos, dv);
    _look.copy(CAM_LOOK).lerp(cur.camLook, dv);
    camera.lookAt(_look);
    let op = 0;
    if (g >= la) {
      const fin = Math.min((g - la) / 0.06, 1);
      const fout = g <= lo ? 1 : Math.max(0, 1 - (g - lo) / 0.06);
      op = fin * fout;
    }
    if (op > 0.001) finalLabel(op); else clearArrow();

    const trn = (g - lo) / Math.max(0.001, 1 - lo);
    elFade.style.opacity = Math.min(1, Math.max(0, trn));
  }
}

function animate() {
  requestAnimationFrame(animate);
  if (!fxActive) return;

  const p = Math.min(progress / ENTRANCE_END, 1);
  const ease = 1 - Math.pow(1 - p, 3);

  if (elTitle) { const te = Math.min(Math.max((ease - 0.25) / 0.4, 0), 1); elTitle.style.opacity = 1 - te * te * (3 - 2 * te); }
  PATH.getPoint(ease, _pos);
  carGroup.position.copy(_pos);
  const rp = Math.min(Math.max((ease - TURN_START) / (1 - TURN_START), 0), 1);
  const rotT = rp * rp * rp * (rp * (rp * 6 - 15) + 10);
  const baseYaw = START_ROT + (END_ROT - START_ROT) * rotT;
  const signedDist = _pos.distanceTo(_prevPos) * Math.sign(ease - prevEase);
  prevEase = ease;
  _prevPos.copy(_pos);
  wheelAngle += signedDist * WHEEL_SPIN;
  for (const pv of wheelPivots) pv.quaternion.setFromAxisAngle(pv.userData.roll, wheelAngle).multiply(pv.userData.base);

  let yaw = baseYaw, pitch = 0;
  if (services.length && progress > ENTRANCE_END) {
    const sp = Math.min(Math.max((progress - ENTRANCE_END) / (1 - ENTRANCE_END), 0), 1);
    const n = services.length;
    let idx = n - 1;
    for (let i = 0; i < n; i++) { if (sp < segStart[i] + segLen[i]) { idx = i; break; } }
    const fr = Math.min(Math.max((sp - segStart[idx]) / segLen[idx], 0), 1);
    const cur = services[idx];
    const py = idx > 0 ? services[idx - 1].yaw : END_ROT;
    const pp = idx > 0 ? (services[idx - 1].pitch || 0) : 0;
    const pz = idx > 0 ? services[idx - 1].zoom : 1;
    const TRANS = 0.62;
    const mt = Math.min(fr / TRANS, 1);
    const sm = mt * mt * mt * (mt * (mt * 6 - 15) + 10);
    yaw = py + (cur.yaw - py) * sm;
    pitch = pp + ((cur.pitch || 0) - pp) * sm;
    if (carRoot) { carRoot.rotation.y = yaw; carRoot.rotation.x = pitch; }

    if (idx === n - 1) {
      renderFinal(fr, pz);
    } else {
      applyZoom(pz + (cur.zoom - pz) * sm);
      elFade.style.opacity = 0;
      let a = 0;
      if (fr > TRANS) { const g = (fr - TRANS) / (1 - TRANS); a = Math.min(g / 0.12, 1) * Math.min((1 - g) / 0.12, 1); }
      drawArrow(idx, Math.max(0, Math.min(1, a)));
    }
  } else {
    if (carRoot) { carRoot.rotation.y = yaw; carRoot.rotation.x = 0; }
    applyZoom(1);
    clearArrow();
    elFade.style.opacity = 0;
  }

  if ((parseFloat(elFade.style.opacity) || 0) < 0.99) renderer.render(scene, camera);
}
animate();

addEventListener("resize", () => {
  frameForAspect();
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth < 640 ? 1 : 1.5));
  renderer.setSize(innerWidth, innerHeight);
  ScrollTrigger.refresh();
});
