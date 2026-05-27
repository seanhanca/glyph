// site/play/threed-runtime.js
//
// Three.js scenes for the playground's "3D · Three.js" tab. Lazy-loads
// three.js from esm.sh on first use so users who never click a 3D chip
// don't pay the ~600 KB tax. Each scene is a small `init` function that
// receives the WebGL renderer + a params object from the spec and
// returns a `dispose()` callback for cleanup.
//
// Spec shape:
//   { "threeD": { "scene": "<name>", "params": { ... } } }
//
// Glyph's chart-spec + compose specs are deterministic; these 3D specs
// are NOT. They emit WebGL, which is GPU-dependent, and the animation
// loop is wall-clock driven. We surface this clearly in the audit
// panel + the spec description.

const THREE_CDN_URL = "https://esm.sh/three@0.160.0";

let threePromise = null;
function loadThree() {
  if (!threePromise) {
    threePromise = import(THREE_CDN_URL).then((mod) => {
      // esm.sh exports the namespace at .default and also flat.
      return mod.default ?? mod;
    });
  }
  return threePromise;
}

// Track the current scene's dispose so we tear down before re-renders.
let currentDispose = null;

/**
 * Render a 3D spec into the host element. Replaces the host's contents
 * with a <canvas>, kicks off the scene, and starts the animation loop.
 * Returns once the first frame is drawn (host is interactive).
 */
export async function renderThreeD(spec, host) {
  if (currentDispose) {
    currentDispose();
    currentDispose = null;
  }
  const sceneName = spec?.threeD?.scene;
  const params = spec?.threeD?.params ?? {};
  if (!sceneName) {
    host.innerHTML = '<div class="empty">Missing `threeD.scene` in spec.</div>';
    return;
  }

  // Set up canvas + sizes.
  const w = Math.max(280, host.clientWidth || 720);
  const h = Math.max(240, host.clientHeight || 460);
  host.innerHTML = "";
  const canvas = document.createElement("canvas");
  canvas.width = w * (window.devicePixelRatio || 1);
  canvas.height = h * (window.devicePixelRatio || 1);
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.maxWidth = `${w}px`;
  canvas.style.display = "block";
  host.appendChild(canvas);

  const THREE = await loadThree();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(w, h, false);
  renderer.setClearColor(0xfafbfd, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 5000);
  camera.position.set(0, 0, 6);
  scene.add(new THREE.AmbientLight(0xffffff, 0.45));
  const key = new THREE.DirectionalLight(0xffffff, 0.85);
  key.position.set(6, 8, 4);
  scene.add(key);

  const ctx = { THREE, renderer, scene, camera, params, w, h };
  const sceneFn = SCENES[sceneName];
  if (!sceneFn) {
    host.innerHTML = `<div class="empty">Unknown 3D scene: <code>${sceneName}</code></div>`;
    return;
  }
  const sceneState = sceneFn(ctx);

  let raf = 0;
  const start = performance.now();
  function loop() {
    const t = (performance.now() - start) / 1000;
    sceneState?.update?.(t);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  }
  loop();

  currentDispose = () => {
    cancelAnimationFrame(raf);
    sceneState?.dispose?.();
    renderer.dispose();
  };
}

// ===========================================================================
// SCENES — keyed by spec.threeD.scene. Each receives ctx { THREE, scene,
// camera, params } and returns an optional { update(t), dispose() }.
// ===========================================================================

const SCENES = {
  // -------------------------------------------------------------------------
  // Lorenz attractor — animated 3D path traces the chaotic trajectory of
  // a particle in the Lorenz system. Built up step-by-step as the
  // animation runs so you see the strange attractor unfold.
  // -------------------------------------------------------------------------
  "lorenz-attractor"(ctx) {
    const { THREE, scene, camera, params } = ctx;
    camera.position.set(40, 30, 60);
    camera.lookAt(0, 0, 0);
    const sigma = params.sigma ?? 10;
    const rho = params.rho ?? 28;
    const beta = params.beta ?? 8 / 3;
    const dt = params.dt ?? 0.005;
    const totalPoints = params.totalPoints ?? 8000;
    const allPoints = new Float32Array(totalPoints * 3);
    let x = 0.1;
    let y = 0;
    let z = 0;
    for (let i = 0; i < totalPoints; i++) {
      const dx = sigma * (y - x);
      const dy = x * (rho - z) - y;
      const dz = x * y - beta * z;
      x += dx * dt;
      y += dy * dt;
      z += dz * dt;
      allPoints[i * 3] = x;
      allPoints[i * 3 + 1] = y;
      allPoints[i * 3 + 2] = z - 27;
    }

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(totalPoints * 3);
    const colors = new Float32Array(totalPoints * 3);
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const material = new THREE.LineBasicMaterial({ vertexColors: true, linewidth: 1.5 });
    const line = new THREE.Line(geometry, material);
    scene.add(line);

    return {
      update(t) {
        const drawSpeed = 220;
        const count = Math.min(totalPoints, Math.floor(t * drawSpeed));
        for (let i = 0; i < count; i++) {
          positions[i * 3] = allPoints[i * 3];
          positions[i * 3 + 1] = allPoints[i * 3 + 1];
          positions[i * 3 + 2] = allPoints[i * 3 + 2];
          const h = (i / totalPoints) * 0.6 + 0.55;
          const c = new THREE.Color().setHSL(h, 0.65, 0.55);
          colors[i * 3] = c.r;
          colors[i * 3 + 1] = c.g;
          colors[i * 3 + 2] = c.b;
        }
        geometry.setDrawRange(0, count);
        geometry.attributes.position.needsUpdate = true;
        geometry.attributes.color.needsUpdate = true;
        line.rotation.y = t * 0.18;
      },
      dispose() {
        geometry.dispose();
        material.dispose();
      },
    };
  },

  // -------------------------------------------------------------------------
  // DNA double helix — two phosphate strands winding around a central
  // axis, with base-pair rungs between them. Slowly rotates so the
  // structure is legible from every angle.
  // -------------------------------------------------------------------------
  "dna-helix"(ctx) {
    const { THREE, scene, camera, params } = ctx;
    camera.position.set(0, 0, 11);
    const turns = params.turns ?? 4;
    const rungs = params.rungs ?? 56;
    const radius = 1.2;
    const height = 10;
    const group = new THREE.Group();
    scene.add(group);

    // Two helical strands as continuous tubes.
    const strandPoints = (offsetAngle) => {
      const pts = [];
      for (let i = 0; i <= 200; i++) {
        const t = i / 200;
        const a = turns * 2 * Math.PI * t + offsetAngle;
        pts.push(
          new THREE.Vector3(radius * Math.cos(a), -height / 2 + t * height, radius * Math.sin(a)),
        );
      }
      return pts;
    };
    const strandA = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(strandPoints(0)),
      300,
      0.07,
      8,
      false,
    );
    const strandB = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(strandPoints(Math.PI)),
      300,
      0.07,
      8,
      false,
    );
    const matA = new THREE.MeshPhongMaterial({ color: 0x4c78a8, shininess: 60 });
    const matB = new THREE.MeshPhongMaterial({ color: 0xf58518, shininess: 60 });
    group.add(new THREE.Mesh(strandA, matA));
    group.add(new THREE.Mesh(strandB, matB));

    // Rungs (base pairs).
    const rungMat = new THREE.MeshPhongMaterial({ color: 0x888888 });
    const rungGeoms = [];
    for (let i = 0; i < rungs; i++) {
      const t = i / (rungs - 1);
      const a = turns * 2 * Math.PI * t;
      const ax = radius * Math.cos(a);
      const az = radius * Math.sin(a);
      const bx = radius * Math.cos(a + Math.PI);
      const bz = radius * Math.sin(a + Math.PI);
      const y = -height / 2 + t * height;
      const len = Math.hypot(ax - bx, az - bz);
      const cyl = new THREE.CylinderGeometry(0.03, 0.03, len, 6, 1, true);
      const m = new THREE.Mesh(cyl, rungMat);
      m.position.set((ax + bx) / 2, y, (az + bz) / 2);
      m.rotation.z = Math.PI / 2;
      m.rotation.y = -a;
      group.add(m);
      rungGeoms.push(cyl);
    }

    return {
      update(t) {
        group.rotation.y = t * 0.4;
      },
      dispose() {
        strandA.dispose();
        strandB.dispose();
        matA.dispose();
        matB.dispose();
        rungMat.dispose();
        for (const g of rungGeoms) g.dispose();
      },
    };
  },

  // -------------------------------------------------------------------------
  // Planetary gears — a sun gear in the middle with N planet gears
  // meshing around it. All gears rotate at their geared rates so the
  // motion reads physically correct.
  // -------------------------------------------------------------------------
  "planetary-gears"(ctx) {
    const { THREE, scene, camera, params } = ctx;
    camera.position.set(0, 6, 7);
    camera.lookAt(0, 0, 0);
    const planets = params.planets ?? 4;
    const sunTeeth = 16;
    const planetTeeth = 10;

    function makeGear(teeth, color) {
      const shape = new THREE.Shape();
      const outer = teeth * 0.18;
      const inner = outer * 0.72;
      for (let i = 0; i < teeth * 2; i++) {
        const a = (i / (teeth * 2)) * Math.PI * 2;
        const r = i % 2 === 0 ? outer : inner;
        const x = r * Math.cos(a);
        const y = r * Math.sin(a);
        if (i === 0) shape.moveTo(x, y);
        else shape.lineTo(x, y);
      }
      shape.closePath();
      const hole = new THREE.Path();
      hole.absarc(0, 0, outer * 0.25, 0, Math.PI * 2, true);
      shape.holes.push(hole);
      const geom = new THREE.ExtrudeGeometry(shape, {
        depth: 0.4,
        bevelEnabled: true,
        bevelSize: 0.06,
        bevelThickness: 0.06,
        bevelSegments: 2,
        steps: 1,
      });
      geom.center();
      return new THREE.Mesh(geom, new THREE.MeshPhongMaterial({ color, shininess: 80 }));
    }

    const sun = makeGear(sunTeeth, 0x4c78a8);
    scene.add(sun);
    const sunR = sunTeeth * 0.18;
    const planetR = planetTeeth * 0.18;
    const orbitR = sunR + planetR - 0.1;

    const planetMeshes = [];
    for (let i = 0; i < planets; i++) {
      const a = (i / planets) * Math.PI * 2;
      const p = makeGear(planetTeeth, 0xf58518);
      p.position.set(orbitR * Math.cos(a), orbitR * Math.sin(a), 0);
      scene.add(p);
      planetMeshes.push({ mesh: p, baseAngle: a });
    }

    // Central hub.
    const hubGeom = new THREE.CylinderGeometry(0.5, 0.5, 0.5, 32);
    const hubMat = new THREE.MeshPhongMaterial({ color: 0x1a1a1a });
    const hub = new THREE.Mesh(hubGeom, hubMat);
    hub.rotation.x = Math.PI / 2;
    scene.add(hub);

    return {
      update(t) {
        sun.rotation.z = t * 0.8;
        for (const p of planetMeshes) {
          p.mesh.rotation.z = -t * (sunTeeth / planetTeeth) * 0.8;
        }
      },
      dispose() {
        hubGeom.dispose();
        hubMat.dispose();
      },
    };
  },

  // -------------------------------------------------------------------------
  // Particle galaxy — N particles in a swirling orbital pattern around
  // a central point. Color and size vary with radial distance for depth
  // perception.
  // -------------------------------------------------------------------------
  "particle-galaxy"(ctx) {
    const { THREE, scene, camera, params } = ctx;
    camera.position.set(0, 3, 14);
    const count = params.count ?? 8000;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const angles = new Float32Array(count);
    const radii = new Float32Array(count);
    const speeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const arm = Math.floor(Math.random() * 3); // 3-arm spiral
      const t = Math.sqrt(Math.random()) * 7; // sqrt so density grows toward edges
      const armOffset = (arm / 3) * Math.PI * 2;
      const a = t * 0.55 + armOffset + (Math.random() - 0.5) * 0.5;
      const yJitter = (Math.random() - 0.5) * 0.6 * (1 - t / 8);
      angles[i] = a;
      radii[i] = t;
      speeds[i] = 1 / (t + 1.5);
      positions[i * 3] = t * Math.cos(a);
      positions[i * 3 + 1] = yJitter;
      positions[i * 3 + 2] = t * Math.sin(a);
      const hue = 0.62 - (t / 8) * 0.45;
      const c = new THREE.Color().setHSL(hue, 0.7, 0.6);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.06,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geom, mat);
    scene.add(points);

    return {
      update(t) {
        for (let i = 0; i < count; i++) {
          const a = angles[i] + t * speeds[i] * 0.6;
          positions[i * 3] = radii[i] * Math.cos(a);
          positions[i * 3 + 2] = radii[i] * Math.sin(a);
        }
        geom.attributes.position.needsUpdate = true;
        points.rotation.y = t * 0.05;
      },
      dispose() {
        geom.dispose();
        mat.dispose();
      },
    };
  },

  // -------------------------------------------------------------------------
  // Parametric torus knot — classic three.js demo: a (p, q) torus knot
  // with wireframe + solid shading. Slowly rotates so the knotty
  // topology reads from every angle.
  // -------------------------------------------------------------------------
  "torus-knot"(ctx) {
    const { THREE, scene, camera, params } = ctx;
    camera.position.set(0, 0, 8);
    const p = params.p ?? 3;
    const q = params.q ?? 4;
    const geom = new THREE.TorusKnotGeometry(2, 0.65, 240, 24, p, q);
    const mat = new THREE.MeshPhongMaterial({
      color: 0x4c78a8,
      shininess: 120,
      specular: 0x88aacc,
      side: THREE.DoubleSide,
    });
    const knot = new THREE.Mesh(geom, mat);
    scene.add(knot);
    const wireGeom = new THREE.TorusKnotGeometry(2, 0.65, 120, 12, p, q);
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      wireframe: true,
      transparent: true,
      opacity: 0.18,
    });
    const wire = new THREE.Mesh(wireGeom, wireMat);
    scene.add(wire);

    return {
      update(t) {
        knot.rotation.x = t * 0.4;
        knot.rotation.y = t * 0.55;
        wire.rotation.x = knot.rotation.x;
        wire.rotation.y = knot.rotation.y;
      },
      dispose() {
        geom.dispose();
        mat.dispose();
        wireGeom.dispose();
        wireMat.dispose();
      },
    };
  },

  // -------------------------------------------------------------------------
  // Truss bridge — engineering structure with diagonal cross-bracing
  // and gentle camera orbit. Demonstrates parametric geometry generation
  // from compact engineering parameters.
  // -------------------------------------------------------------------------
  "truss-bridge"(ctx) {
    const { THREE, scene, camera, params } = ctx;
    camera.position.set(0, 3, 14);
    const bays = params.bays ?? 8;
    const span = 12;
    const height = 2.5;
    const bayLen = span / bays;
    const memberMat = new THREE.MeshPhongMaterial({ color: 0x4c78a8, shininess: 30 });
    const deckMat = new THREE.MeshPhongMaterial({ color: 0xaaaaaa });
    const geoms = [];

    function addMember(x1, y1, x2, y2, z, radius = 0.06) {
      const len = Math.hypot(x2 - x1, y2 - y1);
      const cyl = new THREE.CylinderGeometry(radius, radius, len, 6);
      const m = new THREE.Mesh(cyl, memberMat);
      m.position.set((x1 + x2) / 2, (y1 + y2) / 2, z);
      m.rotation.z = Math.atan2(y2 - y1, x2 - x1) - Math.PI / 2;
      scene.add(m);
      geoms.push(cyl);
    }

    for (const z of [-1, 1]) {
      // Top + bottom chords.
      for (let i = 0; i < bays; i++) {
        const x1 = -span / 2 + i * bayLen;
        const x2 = x1 + bayLen;
        addMember(x1, 0, x2, 0, z);
        addMember(x1, height, x2, height, z);
      }
      // Verticals.
      for (let i = 0; i <= bays; i++) {
        const x = -span / 2 + i * bayLen;
        addMember(x, 0, x, height, z);
      }
      // Diagonals (alternating direction → Warren-truss pattern).
      for (let i = 0; i < bays; i++) {
        const x1 = -span / 2 + i * bayLen;
        const x2 = x1 + bayLen;
        if (i % 2 === 0) addMember(x1, 0, x2, height, z, 0.045);
        else addMember(x2, 0, x1, height, z, 0.045);
      }
    }
    // Cross-bracing between trusses (top).
    for (let i = 0; i <= bays; i++) {
      const x = -span / 2 + i * bayLen;
      const cyl = new THREE.CylinderGeometry(0.04, 0.04, 2, 6);
      const m = new THREE.Mesh(cyl, memberMat);
      m.position.set(x, height, 0);
      m.rotation.x = Math.PI / 2;
      scene.add(m);
      geoms.push(cyl);
    }
    // Deck (slab).
    const deckGeom = new THREE.BoxGeometry(span, 0.1, 2.4);
    const deck = new THREE.Mesh(deckGeom, deckMat);
    deck.position.y = -0.08;
    scene.add(deck);
    geoms.push(deckGeom);

    return {
      update(t) {
        camera.position.x = Math.sin(t * 0.12) * 14;
        camera.position.z = Math.cos(t * 0.12) * 14;
        camera.position.y = 3 + Math.sin(t * 0.08) * 1.2;
        camera.lookAt(0, 1.2, 0);
      },
      dispose() {
        memberMat.dispose();
        deckMat.dispose();
        for (const g of geoms) g.dispose();
      },
    };
  },
};

export function isThreeDSpec(spec) {
  return Boolean(spec && typeof spec === "object" && spec.threeD);
}
