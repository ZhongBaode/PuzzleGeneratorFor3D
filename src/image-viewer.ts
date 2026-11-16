import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { positionedVertices } from './image-placement';
import type { Model } from './image-model';
export function createModelViewer(host: HTMLElement, model: Model, plate = 0) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setClearColor('#edf0e7');
  renderer.domElement.setAttribute('aria-label', '3D model preview. Drag to rotate, scroll to zoom.');
  host.replaceChildren(renderer.domElement);
  const scene = new THREE.Scene(), group = new THREE.Group(); scene.add(group);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x637354, 2.5));
  const light = new THREE.DirectionalLight(0xffffff, 2); light.position.set(-40, 80, 200); scene.add(light);
  const materials = model.palette.map(color => new THREE.MeshStandardMaterial({ color, roughness: .85, metalness: 0, flatShading: true }));
  for (const p of model.pieces.filter(p => p.plate === plate)) for (const solid of p.solids) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positionedVertices(p, solid.mesh), 3));
    geom.setIndex(solid.mesh.triangles); geom.computeVertexNormals();
    group.add(new THREE.Mesh(geom, materials[solid.slot]));
  }
  const box = new THREE.Box3().setFromObject(group), center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.y, 10), camera = new THREE.PerspectiveCamera(35, 1, .05, span * 30);
  camera.up.set(0, 0, 1); camera.position.set(center.x, center.y - span * .65, span * 1.7);
  const controls = new OrbitControls(camera, renderer.domElement); controls.target.copy(center); controls.enableDamping = false; controls.update();
  const render = () => renderer.render(scene, camera); controls.addEventListener('change', render);
  const resize = () => { const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); render(); };
  const observer = new ResizeObserver(resize); observer.observe(host); resize();
  return () => { observer.disconnect(); controls.dispose(); scene.traverse(obj => { if (obj instanceof THREE.Mesh) obj.geometry.dispose(); }); materials.forEach(m => m.dispose()); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); };
}
