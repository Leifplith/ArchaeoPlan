import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';

const VERSION = '0.1.2';
const $ = id => document.getElementById(id);

const viewport = $('viewport');
const status = $('status');
const fileInput = $('fileInput');
const modelList = $('modelList');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xd6d9dc);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
viewport.prepend(renderer.domElement);

const perspectiveCamera = new THREE.PerspectiveCamera(45, 1, 0.001, 10000000);
perspectiveCamera.position.set(5, 5, 5);
const orthographicCamera = new THREE.OrthographicCamera(-5, 5, 5, -5, -10000000, 10000000);
let camera = perspectiveCamera;

let orbit = createOrbit(camera);
const transform = new TransformControls(camera, renderer.domElement);
transform.setMode('translate');
transform.addEventListener('dragging-changed', event => { orbit.enabled = !event.value; });
transform.addEventListener('objectChange', syncTransformFields);
scene.add(transform);

const grid = new THREE.GridHelper(20, 20, 0x6c7379, 0xaab0b5);
scene.add(grid);
scene.add(new THREE.AxesHelper(1));

const models = [];
let selectedModel = null;
let modelNumber = 1;

function createOrbit(activeCamera) {
  const controls = new OrbitControls(activeCamera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = true;
  controls.enablePan = true;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  return controls;
}

function setStatus(text) { status.textContent = text; }

function disposeMaterial(material) {
  if (!material) return;
  const textureKeys = ['map','alphaMap','aoMap','bumpMap','normalMap','roughnessMap','metalnessMap','emissiveMap'];
  for (const key of textureKeys) material[key]?.dispose?.();
  material.dispose?.();
}

function disposeObject(root) {
  root.traverse(object => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) object.material.forEach(disposeMaterial);
    else disposeMaterial(object.material);
  });
}

function documentationMaterial(source, object) {
  const texture = source?.map || null;
  if (texture) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
  }

  const hasVertexColors = Boolean(object.geometry?.attributes?.color);
  return new THREE.MeshBasicMaterial({
    map: texture,
    alphaMap: source?.alphaMap || null,
    color: texture ? 0xffffff : (source?.color?.clone?.() || new THREE.Color(0xd0d0d0)),
    vertexColors: hasVertexColors,
    transparent: Boolean(source?.transparent || (source?.opacity ?? 1) < 1),
    opacity: source?.opacity ?? 1,
    alphaTest: source?.alphaTest ?? 0,
    depthWrite: source?.depthWrite ?? true,
    side: THREE.DoubleSide
  });
}

function neutralizeMaterials(root) {
  root.traverse(object => {
    if (object.isPoints) {
      const old = object.material;
      object.material = new THREE.PointsMaterial({
        size: old?.size || 0.01,
        sizeAttenuation: old?.sizeAttenuation ?? true,
        map: old?.map || null,
        color: old?.color?.clone?.() || new THREE.Color(0xffffff),
        vertexColors: Boolean(object.geometry?.attributes?.color),
        transparent: Boolean(old?.transparent),
        opacity: old?.opacity ?? 1
      });
      return;
    }
    if (!object.isMesh) return;
    const originals = Array.isArray(object.material) ? object.material : [object.material];
    const converted = originals.map(source => documentationMaterial(source, object));
    object.material = Array.isArray(object.material) ? converted : converted[0];
  });
}

function addModel(root, name) {
  root.name = name || `Model ${modelNumber}`;
  root.userData.locked = false;
  neutralizeMaterials(root);
  scene.add(root);
  const model = { id: modelNumber++, name: root.name, root };
  models.push(model);
  selectModel(model);
  rebuildModelList();
  fitAll();
  setStatus(`Indlæst: ${model.name}`);
}

function selectModel(model) {
  selectedModel = model;
  transform.detach();
  if (model && !model.root.userData.locked) transform.attach(model.root);
  rebuildModelList();
  syncTransformFields();
}

function rebuildModelList() {
  modelList.innerHTML = '';
  if (models.length === 0) {
    modelList.innerHTML = '<p class="muted">Ingen modeller åbnet.</p>';
    return;
  }
  for (const model of models) {
    const row = document.createElement('div');
    row.className = `model-row${model === selectedModel ? ' selected' : ''}`;
    const visible = document.createElement('input');
    visible.type = 'checkbox';
    visible.checked = model.root.visible;
    visible.addEventListener('change', () => { model.root.visible = visible.checked; });
    const name = document.createElement('div');
    name.className = 'model-name';
    name.textContent = model.name;
    name.title = model.name;
    name.addEventListener('click', () => selectModel(model));
    const remove = document.createElement('button');
    remove.className = 'model-delete';
    remove.textContent = '×';
    remove.title = 'Fjern fra projekt';
    remove.addEventListener('click', () => {
      if (selectedModel === model) selectModel(null);
      transform.detach();
      scene.remove(model.root);
      disposeObject(model.root);
      models.splice(models.indexOf(model), 1);
      rebuildModelList();
      setStatus(`Fjernet: ${model.name}`);
    });
    row.append(visible, name, remove);
    modelList.append(row);
  }
}

function newProject() {
  if (models.length && !window.confirm('Opret et nyt projekt? Alle modeller i den nuværende arbejdsflade fjernes.')) return;
  transform.detach();
  selectedModel = null;
  for (const model of models) {
    scene.remove(model.root);
    disposeObject(model.root);
  }
  models.length = 0;
  modelNumber = 1;
  perspectiveCamera.position.set(5, 5, 5);
  orthographicCamera.position.set(5, 5, 5);
  orbit.target.set(0, 0, 0);
  orbit.update();
  rebuildModelList();
  syncTransformFields();
  setStatus('Nyt tomt projekt oprettet.');
}

function syncTransformFields() {
  const fieldIds = ['posX','posY','posZ','rotX','rotY','rotZ'];
  for (const id of fieldIds) $(id).disabled = !selectedModel;
  if (!selectedModel) { $('lockButton').textContent = 'Lås'; return; }
  const p = selectedModel.root.position;
  const r = selectedModel.root.rotation;
  $('posX').value = p.x.toFixed(3); $('posY').value = p.y.toFixed(3); $('posZ').value = p.z.toFixed(3);
  $('rotX').value = THREE.MathUtils.radToDeg(r.x).toFixed(2);
  $('rotY').value = THREE.MathUtils.radToDeg(r.y).toFixed(2);
  $('rotZ').value = THREE.MathUtils.radToDeg(r.z).toFixed(2);
  $('lockButton').textContent = selectedModel.root.userData.locked ? 'Lås op' : 'Lås';
}

function applyTransformFields() {
  if (!selectedModel) return;
  const number = id => Number.parseFloat($(id).value) || 0;
  selectedModel.root.position.set(number('posX'), number('posY'), number('posZ'));
  selectedModel.root.rotation.set(
    THREE.MathUtils.degToRad(number('rotX')),
    THREE.MathUtils.degToRad(number('rotY')),
    THREE.MathUtils.degToRad(number('rotZ'))
  );
}
for (const id of ['posX','posY','posZ','rotX','rotY','rotZ']) $(id).addEventListener('change', applyTransformFields);

function getVisibleBounds() {
  const bounds = new THREE.Box3();
  let hasVisibleGeometry = false;
  for (const model of models) {
    if (!model.root.visible) continue;
    const modelBounds = new THREE.Box3().setFromObject(model.root);
    if (!modelBounds.isEmpty()) { bounds.union(modelBounds); hasVisibleGeometry = true; }
  }
  return hasVisibleGeometry ? bounds : null;
}

function fitAll() {
  const bounds = getVisibleBounds();
  if (!bounds) return;
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z, 0.001);
  orbit.target.copy(center);
  if (camera.isPerspectiveCamera) {
    const distance = maxDimension / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.35;
    let direction = camera.position.clone().sub(center).normalize();
    if (direction.lengthSq() < 0.1) direction = new THREE.Vector3(1, 1, 1).normalize();
    camera.position.copy(center).add(direction.multiplyScalar(distance));
    camera.near = Math.max(distance / 10000, 0.001);
    camera.far = distance * 10000;
  } else {
    const aspect = viewport.clientWidth / viewport.clientHeight;
    const halfHeight = maxDimension * 0.65;
    camera.left = -halfHeight * aspect; camera.right = halfHeight * aspect;
    camera.top = halfHeight; camera.bottom = -halfHeight;
    camera.near = -maxDimension * 1000; camera.far = maxDimension * 1000;
  }
  camera.updateProjectionMatrix();
  orbit.update();
}

function switchCamera(useOrthographic) {
  const previousPosition = camera.position.clone();
  const previousTarget = orbit.target.clone();
  orbit.dispose();
  transform.detach();
  camera = useOrthographic ? orthographicCamera : perspectiveCamera;
  camera.position.copy(previousPosition);
  orbit = createOrbit(camera);
  orbit.target.copy(previousTarget);
  transform.camera = camera;
  if (selectedModel && !selectedModel.root.userData.locked) transform.attach(selectedModel.root);
  $('perspectiveButton').classList.toggle('active', !useOrthographic);
  $('orthographicButton').classList.toggle('active', useOrthographic);
  fitAll();
}

function setStandardView(viewName) {
  if (!camera.isOrthographicCamera) switchCamera(true);
  const bounds = getVisibleBounds();
  const center = bounds ? bounds.getCenter(new THREE.Vector3()) : new THREE.Vector3();
  const size = bounds ? Math.max(...bounds.getSize(new THREE.Vector3()).toArray(), 1) : 5;
  const distance = size * 2;
  const directions = {
    top:[0,distance,0], bottom:[0,-distance,0], front:[0,0,distance],
    back:[0,0,-distance], left:[-distance,0,0], right:[distance,0,0]
  };
  camera.position.copy(center).add(new THREE.Vector3(...directions[viewName]));
  camera.up.set(0,1,0);
  if (viewName === 'top') camera.up.set(0,0,-1);
  if (viewName === 'bottom') camera.up.set(0,0,1);
  orbit.target.copy(center);
  orbit.update();
  fitAll();
}

function basename(url) {
  return decodeURIComponent(url.split(/[\\/]/).pop().split(/[?#]/)[0]).toLowerCase();
}

async function loadFiles(fileList) {
  const files = Array.from(fileList);
  if (!files.length) return;

  const filesByName = new Map(files.map(file => [file.name.toLowerCase(), file]));
  const objectUrls = new Map(files.map(file => [file.name.toLowerCase(), URL.createObjectURL(file)]));
  const mainFiles = files.filter(file => /\.(glb|gltf|obj|ply)$/i.test(file.name));

  if (!mainFiles.length) {
    setStatus('Vælg en GLB-, GLTF-, OBJ- eller PLY-fil. Til OBJ/GLTF vælges hjælpefiler samtidig.');
    objectUrls.forEach(url => URL.revokeObjectURL(url));
    return;
  }

  try {
    for (const file of mainFiles) {
      try {
        setStatus(`Indlæser: ${file.name}`);
        const extension = file.name.split('.').pop().toLowerCase();
        const manager = new THREE.LoadingManager();
        manager.setURLModifier(url => objectUrls.get(basename(url)) || url);

        if (extension === 'glb' || extension === 'gltf') {
          const loader = new GLTFLoader(manager);
          const data = extension === 'gltf' ? await file.text() : await file.arrayBuffer();
          const gltf = await new Promise((resolve, reject) => loader.parse(data, '', resolve, reject));
          addModel(gltf.scene, file.name);
          continue;
        }

        if (extension === 'ply') {
          const geometry = new PLYLoader().parse(await file.arrayBuffer());
          let root;
          const looksLikeMesh = Boolean(geometry.index || geometry.attributes.normal);
          if (looksLikeMesh) {
            if (!geometry.attributes.normal) geometry.computeVertexNormals();
            root = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
              color: geometry.attributes.color ? 0xffffff : 0xd0d0d0,
              vertexColors: Boolean(geometry.attributes.color),
              side: THREE.DoubleSide
            }));
          } else {
            root = new THREE.Points(geometry, new THREE.PointsMaterial({
              size: 0.01,
              color: geometry.attributes.color ? 0xffffff : 0xd0d0d0,
              vertexColors: Boolean(geometry.attributes.color)
            }));
          }
          addModel(root, file.name);
          continue;
        }

        if (extension === 'obj') {
          const objText = await file.text();
          const materialReference = objText.match(/^\s*mtllib\s+(.+)$/mi);
          let materials = null;
          if (materialReference) {
            const materialName = basename(materialReference[1].trim());
            const materialFile = filesByName.get(materialName);
            if (materialFile) {
              materials = new MTLLoader(manager).parse(await materialFile.text(), '');
              materials.preload();
            } else {
              setStatus(`OBJ fundet, men ${materialReference[1].trim()} mangler. Modellen indlæses uden tekstur.`);
            }
          }
          const loader = new OBJLoader(manager);
          if (materials) loader.setMaterials(materials);
          addModel(loader.parse(objText), file.name);
        }
      } catch (error) {
        console.error(error);
        setStatus(`Fejl ved ${file.name}: ${error.message || error}`);
      }
    }
  } finally {
    setTimeout(() => objectUrls.forEach(url => URL.revokeObjectURL(url)), 1000);
    fileInput.value = '';
  }
}

async function exportPng() {
  const width = Math.max(200, Math.min(10000, Number.parseInt($('exportWidth').value) || 3000));
  const height = Math.max(200, Math.min(10000, Number.parseInt($('exportHeight').value) || 2000));
  const previousSize = new THREE.Vector2(); renderer.getSize(previousSize);
  const previousPixelRatio = renderer.getPixelRatio();
  const previousPerspectiveAspect = perspectiveCamera.aspect;
  const previousOrtho = { left:orthographicCamera.left, right:orthographicCamera.right, top:orthographicCamera.top, bottom:orthographicCamera.bottom };
  renderer.setPixelRatio(1); renderer.setSize(width, height, false);
  if (camera.isPerspectiveCamera) camera.aspect = width / height;
  else {
    const centerX=(camera.left+camera.right)/2, centerY=(camera.top+camera.bottom)/2;
    const halfHeight=(camera.top-camera.bottom)/2, halfWidth=halfHeight*(width/height);
    camera.left=centerX-halfWidth; camera.right=centerX+halfWidth;
    camera.top=centerY+halfHeight; camera.bottom=centerY-halfHeight;
  }
  camera.updateProjectionMatrix(); renderer.render(scene, camera);
  const link=document.createElement('a');
  link.href=renderer.domElement.toDataURL('image/png');
  link.download=`ArchaeoPlan-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.png`;
  link.click();
  renderer.setPixelRatio(previousPixelRatio); renderer.setSize(previousSize.x, previousSize.y, false);
  perspectiveCamera.aspect=previousPerspectiveAspect; Object.assign(orthographicCamera, previousOrtho);
  camera.updateProjectionMatrix();
  setStatus(`PNG gemt: ${width} × ${height} px`);
}

function resize() {
  const width=viewport.clientWidth, height=viewport.clientHeight;
  renderer.setSize(width,height,false);
  perspectiveCamera.aspect=width/height; perspectiveCamera.updateProjectionMatrix();
  const halfHeight=(orthographicCamera.top-orthographicCamera.bottom)/2 || 5;
  orthographicCamera.left=-halfHeight*width/height;
  orthographicCamera.right=halfHeight*width/height;
  orthographicCamera.updateProjectionMatrix();
}

$('newProjectButton').addEventListener('click', newProject);
$('addFileButton').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', event => loadFiles(event.target.files));
$('exportButton').addEventListener('click', exportPng);
$('perspectiveButton').addEventListener('click', () => switchCamera(false));
$('orthographicButton').addEventListener('click', () => switchCamera(true));
$('gridToggle').addEventListener('change', event => { grid.visible = event.target.checked; });
$('translateButton').addEventListener('click', () => {
  transform.setMode('translate'); $('translateButton').classList.add('active'); $('rotateButton').classList.remove('active');
});
$('rotateButton').addEventListener('click', () => {
  transform.setMode('rotate'); $('rotateButton').classList.add('active'); $('translateButton').classList.remove('active');
});
$('lockButton').addEventListener('click', () => {
  if (!selectedModel) return;
  selectedModel.root.userData.locked=!selectedModel.root.userData.locked;
  transform.detach();
  if (!selectedModel.root.userData.locked) transform.attach(selectedModel.root);
  syncTransformFields();
});
for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => setStandardView(button.dataset.view));
for (const eventName of ['dragenter','dragover']) viewport.addEventListener(eventName,event=>{event.preventDefault();$('dropZone').classList.add('show');});
for (const eventName of ['dragleave','drop']) viewport.addEventListener(eventName,event=>{event.preventDefault();$('dropZone').classList.remove('show');});
viewport.addEventListener('drop', event => loadFiles(event.dataTransfer.files));
window.addEventListener('resize',resize);

resize();
rebuildModelList();
syncTransformFields();
setStatus(`ArchaeoPlan v${VERSION} klar.`);
function animate(){requestAnimationFrame(animate);orbit.update();renderer.render(scene,camera);} animate();
