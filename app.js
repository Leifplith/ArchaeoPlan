import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';

const VERSION = '0.2.3';
const $ = id => document.getElementById(id);

const viewport = $('viewport');
const status = $('status');
const fileInput = $('fileInput');
const modelList = $('modelList');
const cropInputLayer = $('cropInputLayer');
const cropOverlay = $('cropOverlay');
const cropLine = $('cropLine');
const cropPolygon = $('cropPolygon');
const cropPointsGroup = $('cropPoints');
const cropHint = $('cropHint');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xd6d9dc);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true,
  alpha: false
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.toneMappingExposure = 1;
viewport.prepend(renderer.domElement);

const perspectiveCamera = new THREE.PerspectiveCamera(45, 1, 0.001, 10000000);
perspectiveCamera.position.set(5, 5, 5);
const orthographicCamera = new THREE.OrthographicCamera(-5, 5, 5, -5, -10000000, 10000000);
let camera = perspectiveCamera;

let orbit = createOrbit(camera);
const transform = new TransformControls(camera, renderer.domElement);
transform.setMode('translate');
transform.addEventListener('dragging-changed', event => {
  orbit.enabled = !event.value;
});
transform.addEventListener('objectChange', syncTransformFields);
scene.add(transform);

const grid = new THREE.GridHelper(20, 20, 0x6c7379, 0xaab0b5);
scene.add(grid);
scene.add(new THREE.AxesHelper(1));

const models = [];
let selectedModel = null;
let modelNumber = 1;

/* Object URLs must stay alive while textures are in use.
   Revoking them immediately can produce white OBJ/GLTF materials on Safari. */
const liveObjectUrls = new Set();

let cropMode = false;
let cropPoints = [];
let cropTool = 'freehand';
let cropDrawing = false;
let cropPointerId = null;

function createOrbit(activeCamera) {
  const controls = new OrbitControls(activeCamera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = true;
  controls.enablePan = true;
  controls.touches = {
    ONE: THREE.TOUCH.ROTATE,
    TWO: THREE.TOUCH.DOLLY_PAN
  };
  return controls;
}

function setStatus(text) {
  status.textContent = text;
}

function disposeMaterial(material) {
  if (!material) return;
  /* Do not dispose shared textures here. The same texture can be used by
     original and cropped copies. Materials themselves can safely go. */
  material.dispose?.();
}

function disposeObject(root) {
  root.traverse(object => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) object.material.forEach(disposeMaterial);
    else disposeMaterial(object.material);
  });
}

function releaseAllObjectUrls() {
  for (const url of liveObjectUrls) URL.revokeObjectURL(url);
  liveObjectUrls.clear();
}

/* Documentation material:
   preserve the original color texture and vertex colours, but remove lighting
   from the visualisation. The source texture object is reused unchanged. */
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
    color: texture
      ? 0xffffff
      : (source?.color?.clone?.() || new THREE.Color(0xd0d0d0)),
    vertexColors: hasVertexColors && !texture,
    transparent: Boolean(source?.transparent || (source?.opacity ?? 1) < 1),
    opacity: source?.opacity ?? 1,
    alphaTest: source?.alphaTest ?? 0,
    depthWrite: source?.depthWrite ?? true,
    side: THREE.DoubleSide
  });
}

function prepareDocumentationMaterials(root) {
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

    const sourceMaterials = Array.isArray(object.material)
      ? object.material
      : [object.material];

    const converted = sourceMaterials.map(source =>
      documentationMaterial(source, object)
    );

    object.material = Array.isArray(object.material)
      ? converted
      : converted[0];
  });
}

function addModel(root, name, options = {}) {
  root.name = name || `Model ${modelNumber}`;
  root.userData.locked = false;

  if (!options.alreadyPrepared) {
    prepareDocumentationMaterials(root);
  }

  scene.add(root);

  const model = {
    id: modelNumber++,
    name: root.name,
    root,
    cropped: Boolean(options.cropped)
  };

  models.push(model);
  selectModel(model);
  rebuildModelList();

  if (!options.skipFit) {
    // New imports are always framed around the selected model.
    const box = getFramingBox();
    if (box) {
      const center = box.getCenter(new THREE.Vector3());
      orbit.target.copy(center);
    }
    fitAll();
  }
  setStatus(`Indlæst: ${model.name}`);
  return model;
}

function selectModel(model) {
  selectedModel = model;
  transform.detach();

  if (model && !model.root.userData.locked && !cropMode) {
    transform.attach(model.root);
  }

  rebuildModelList();
  syncTransformFields();
  updateCropButtons();
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
    visible.addEventListener('change', () => {
      model.root.visible = visible.checked;
    });

    const name = document.createElement('div');
    name.className = 'model-name';
    name.textContent = model.cropped ? `${model.name} ✂` : model.name;
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
  if (
    models.length &&
    !window.confirm(
      'Opret et nyt projekt? Alle modeller i den nuværende arbejdsflade fjernes.'
    )
  ) return;

  cancelCrop();
  transform.detach();
  selectedModel = null;

  for (const model of models) {
    scene.remove(model.root);
    disposeObject(model.root);
  }

  models.length = 0;
  modelNumber = 1;
  releaseAllObjectUrls();

  perspectiveCamera.position.set(5, 5, 5);
  orthographicCamera.position.set(5, 5, 5);
  orbit.target.set(0, 0, 0);
  orbit.update();

  rebuildModelList();
  syncTransformFields();
  setStatus('Nyt tomt projekt oprettet.');
}

function syncTransformFields() {
  const fieldIds = ['posX', 'posY', 'posZ', 'rotX', 'rotY', 'rotZ'];

  for (const id of fieldIds) {
    $(id).disabled = !selectedModel;
  }

  if (!selectedModel) {
    $('lockButton').textContent = 'Lås';
    return;
  }

  const p = selectedModel.root.position;
  const r = selectedModel.root.rotation;

  $('posX').value = p.x.toFixed(3);
  $('posY').value = p.y.toFixed(3);
  $('posZ').value = p.z.toFixed(3);
  $('rotX').value = THREE.MathUtils.radToDeg(r.x).toFixed(2);
  $('rotY').value = THREE.MathUtils.radToDeg(r.y).toFixed(2);
  $('rotZ').value = THREE.MathUtils.radToDeg(r.z).toFixed(2);
  $('lockButton').textContent =
    selectedModel.root.userData.locked ? 'Lås op' : 'Lås';
}

function applyTransformFields() {
  if (!selectedModel) return;

  const number = id => Number.parseFloat($(id).value) || 0;

  selectedModel.root.position.set(
    number('posX'),
    number('posY'),
    number('posZ')
  );

  selectedModel.root.rotation.set(
    THREE.MathUtils.degToRad(number('rotX')),
    THREE.MathUtils.degToRad(number('rotY')),
    THREE.MathUtils.degToRad(number('rotZ'))
  );
}

for (const id of ['posX', 'posY', 'posZ', 'rotX', 'rotY', 'rotZ']) {
  $(id).addEventListener('change', applyTransformFields);
}

function getVisibleBounds() {
  const bounds = new THREE.Box3();
  let hasVisibleGeometry = false;

  for (const model of models) {
    if (!model.root.visible) continue;

    const modelBounds = new THREE.Box3().setFromObject(model.root);

    if (!modelBounds.isEmpty()) {
      bounds.union(modelBounds);
      hasVisibleGeometry = true;
    }
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
    const distance =
      maxDimension /
      (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) *
      1.35;

    let direction = camera.position.clone().sub(center).normalize();

    if (direction.lengthSq() < 0.1) {
      direction = new THREE.Vector3(1, 1, 1).normalize();
    }

    camera.position
      .copy(center)
      .add(direction.multiplyScalar(distance));

    camera.near = Math.max(distance / 10000, 0.001);
    camera.far = distance * 10000;
  } else {
    const aspect = viewport.clientWidth / viewport.clientHeight;
    const halfHeight = maxDimension * 0.65;

    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.near = -maxDimension * 1000;
    camera.far = maxDimension * 1000;
  }

  camera.updateProjectionMatrix();
  orbit.update();
}

function switchCamera(useOrthographic) {
  const previousPosition = camera.position.clone();
  const previousTarget = orbit.target.clone();

  orbit.dispose();
  transform.detach();

  camera = useOrthographic
    ? orthographicCamera
    : perspectiveCamera;

  camera.position.copy(previousPosition);
  orbit = createOrbit(camera);
  orbit.target.copy(previousTarget);
  transform.camera = camera;

  if (selectedModel && !selectedModel.root.userData.locked && !cropMode) {
    transform.attach(selectedModel.root);
  }

  $('perspectiveButton').classList.toggle('active', !useOrthographic);
  $('orthographicButton').classList.toggle('active', useOrthographic);

  fitAll();
}

function setStandardView(viewName) {
  if (!camera.isOrthographicCamera) switchCamera(true);

  const bounds = getVisibleBounds();
  const center = bounds
    ? bounds.getCenter(new THREE.Vector3())
    : new THREE.Vector3();

  const size = bounds
    ? Math.max(...bounds.getSize(new THREE.Vector3()).toArray(), 1)
    : 5;

  const distance = size * 2;

  const directions = {
    top: [0, distance, 0],
    bottom: [0, -distance, 0],
    front: [0, 0, distance],
    back: [0, 0, -distance],
    left: [-distance, 0, 0],
    right: [distance, 0, 0]
  };

  camera.position
    .copy(center)
    .add(new THREE.Vector3(...directions[viewName]));

  camera.up.set(0, 1, 0);

  if (viewName === 'top') camera.up.set(0, 0, -1);
  if (viewName === 'bottom') camera.up.set(0, 0, 1);

  orbit.target.copy(center);
  orbit.update();
  fitAll();
}

function basename(url) {
  return decodeURIComponent(
    url.split(/[\\/]/).pop().split(/[?#]/)[0]
  ).toLowerCase();
}

function makeObjectUrlMap(files) {
  const map = new Map();

  for (const file of files) {
    const url = URL.createObjectURL(file);
    liveObjectUrls.add(url);
    map.set(file.name.toLowerCase(), url);
  }

  return map;
}

function loadingManagerFor(objectUrls) {
  const manager = new THREE.LoadingManager();

  manager.setURLModifier(url => {
    const direct = objectUrls.get(basename(url));
    return direct || url;
  });

  return manager;
}

async function loadGlbOrGltf(file, manager) {
  const loader = new GLTFLoader(manager);
  const extension = file.name.split('.').pop().toLowerCase();

  const data = extension === 'gltf'
    ? await file.text()
    : await file.arrayBuffer();

  return await new Promise((resolve, reject) => {
    loader.parse(data, '', resolve, reject);
  });
}

async function loadObj(file, manager, filesByName) {
  const objText = await file.text();

  let materials = null;
  const mtllibReferences = [
    ...objText.matchAll(/^\s*mtllib\s+(.+)$/gmi)
  ].map(match => match[1].trim());

  if (mtllibReferences.length) {
    const reference = basename(mtllibReferences[0]);
    const mtlFile = filesByName.get(reference);

    if (mtlFile) {
      const mtlText = await mtlFile.text();
      materials = new MTLLoader(manager).parse(mtlText, '');
      materials.preload();
    }
  }

  const loader = new OBJLoader(manager);
  if (materials) loader.setMaterials(materials);

  return loader.parse(objText);
}

async function loadPly(file) {
  const geometry = new PLYLoader().parse(
    await file.arrayBuffer()
  );

  if (geometry.index || geometry.attributes.normal) {
    if (!geometry.attributes.normal) geometry.computeVertexNormals();

    return new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: geometry.attributes.color ? 0xffffff : 0xd0d0d0,
        vertexColors: Boolean(geometry.attributes.color),
        side: THREE.DoubleSide
      })
    );
  }

  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      size: 0.01,
      vertexColors: Boolean(geometry.attributes.color)
    })
  );
}

async function loadFiles(fileList) {
  const files = Array.from(fileList);
  if (!files.length) return;

  const filesByName = new Map(
    files.map(file => [file.name.toLowerCase(), file])
  );

  const objectUrls = makeObjectUrlMap(files);

  const mainFiles = files.filter(file =>
    /\.(glb|gltf|obj|ply)$/i.test(file.name)
  );

  if (!mainFiles.length) {
    setStatus(
      'Vælg en GLB-, GLTF-, OBJ- eller PLY-fil. Til OBJ/GLTF vælges hjælpefiler samtidig.'
    );
    return;
  }

  for (const file of mainFiles) {
    try {
      setStatus(`Indlæser: ${file.name}`);

      const extension =
        file.name.split('.').pop().toLowerCase();

      const manager = loadingManagerFor(objectUrls);

      if (extension === 'glb' || extension === 'gltf') {
        const gltf = await loadGlbOrGltf(file, manager);
        addModel(gltf.scene, file.name);
        continue;
      }

      if (extension === 'obj') {
        const object = await loadObj(
          file,
          manager,
          filesByName
        );

        addModel(object, file.name);

        const hasTexture = [];
        object.traverse(child => {
          if (!child.isMesh) return;
          const mats = Array.isArray(child.material)
            ? child.material
            : [child.material];
          for (const mat of mats) {
            if (mat?.map) hasTexture.push(true);
          }
        });

        if (!hasTexture.length) {
          setStatus(
            `${file.name} er indlæst, men ingen tekstur blev fundet. Vælg OBJ, MTL og JPG/PNG samtidig.`
          );
        }

        continue;
      }

      if (extension === 'ply') {
        addModel(await loadPly(file), file.name, {
          alreadyPrepared: true
        });
      }
    } catch (error) {
      console.error(error);
      setStatus(
        `Fejl ved ${file.name}: ${error.message || error}`
      );
    }
  }

  fileInput.value = '';
}

/* ---------- SIMPLE SCREEN-POLYGON CROP ---------- */

function updateCropButtons() {
  const canStart = Boolean(selectedModel) && !cropMode;
  $('startCropButton').disabled = !canStart;
  $('cancelCropButton').disabled = !cropMode;

  const polygonReady = cropMode && cropPoints.length >= 3;
  $('cropInsideButton').disabled = !polygonReady;
  $('cropOutsideButton').disabled = !polygonReady;
}

function startCrop() {
  if (!selectedModel) {
    setStatus('Vælg først den model, der skal beskæres.');
    return;
  }

  cropMode = true;
  cropPoints = [];
  cropDrawing = false;
  cropPointerId = null;

  transform.detach();
  orbit.enabled = false;
  orbit.enableRotate = false;
  orbit.enablePan = false;
  orbit.enableZoom = false;

  viewport.classList.add('crop-mode');
  cropInputLayer.classList.add('active');
  cropOverlay.classList.add('active');
  cropHint.classList.add('active');

  // Force the capture layer above WebGL even if Safari has stale CSS.
  Object.assign(cropInputLayer.style, {
    display: 'block',
    pointerEvents: 'auto',
    touchAction: 'none',
    position: 'absolute',
    inset: '0',
    zIndex: '1000',
    background: 'rgba(0,0,0,0.001)',
    cursor: 'crosshair'
  });
  cropOverlay.style.zIndex = '1001';
  cropOverlay.style.pointerEvents = 'none';

  $('freehandCropButton').classList.toggle('active', cropTool === 'freehand');
  $('polygonCropButton').classList.toggle('active', cropTool === 'polygon');
  $('startCropButton').classList.add('active');

  // Belt-and-braces for iPad/Safari: make the OrbitControls DOM element inert
  // while the dedicated crop layer is active.
  renderer.domElement.style.pointerEvents = 'none';

  redrawCropOverlay();
  updateCropButtons();

  setStatus(
    'Beskæring: tryk punkter rundt om det område, du vil beholde eller fjerne.'
  );
}

function cancelCrop() {
  cropMode = false;
  cropPoints = [];
  cropDrawing = false;
  cropPointerId = null;

  viewport.classList.remove('crop-mode');
  cropInputLayer.classList.remove('active');
  cropOverlay.classList.remove('active');
  cropHint.classList.remove('active');
  cropInputLayer.removeAttribute('style');
  cropOverlay.style.zIndex = '';
  cropOverlay.style.pointerEvents = '';
  $('startCropButton').classList.remove('active');
  renderer.domElement.style.pointerEvents = '';

  redrawCropOverlay();

  orbit.enabled = true;
  orbit.enableRotate = true;
  orbit.enablePan = true;
  orbit.enableZoom = true;

  if (
    selectedModel &&
    !selectedModel.root.userData.locked
  ) {
    transform.attach(selectedModel.root);
  }

  updateCropButtons();
}

function redrawCropOverlay() {
  const pointString = cropPoints
    .map(point => `${point.x},${point.y}`)
    .join(' ');

  cropLine.setAttribute('points', pointString);
  cropPolygon.setAttribute(
    'points',
    cropPoints.length >= 3 ? pointString : ''
  );

  cropPointsGroup.innerHTML = '';

  for (const point of cropPoints) {
    const circle = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'circle'
    );

    circle.setAttribute('cx', point.x);
    circle.setAttribute('cy', point.y);
    circle.setAttribute('r', 5);
    cropPointsGroup.appendChild(circle);
  }
}

function canvasPoint(event) {
  const rect = cropInputLayer.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function cropPointerDown(event) {
  if (!cropMode) return;
  event.preventDefault();
  event.stopPropagation();

  const point = canvasPoint(event);

  if (cropTool === 'polygon') {
    cropPoints.push(point);
    redrawCropOverlay();
    updateCropButtons();
    return;
  }

  cropDrawing = true;
  cropPointerId = event.pointerId;
  cropPoints = [point];
  cropInputLayer.setPointerCapture?.(event.pointerId);
  redrawCropOverlay();
  updateCropButtons();
}

function cropPointerMove(event) {
  if (!cropMode || cropTool !== 'freehand' || !cropDrawing) return;
  if (cropPointerId !== null && event.pointerId !== cropPointerId) return;

  event.preventDefault();
  const point = canvasPoint(event);
  const previous = cropPoints[cropPoints.length - 1];

  // Sample only after a few screen pixels: smoother and much smaller polygons.
  if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) >= 4) {
    cropPoints.push(point);
    redrawCropOverlay();
    updateCropButtons();
  }
}

function cropPointerUp(event) {
  if (!cropMode || cropTool !== 'freehand' || !cropDrawing) return;
  if (cropPointerId !== null && event.pointerId !== cropPointerId) return;

  event.preventDefault();
  cropDrawing = false;
  cropInputLayer.releasePointerCapture?.(event.pointerId);
  cropPointerId = null;

  // A freehand stroke is considered a closed selection after release.
  redrawCropOverlay();
  updateCropButtons();

  if (cropPoints.length >= 3) {
    setStatus('Frihåndsområde klar. Vælg “Behold indenfor” eller “Fjern indenfor”.');
  }
}

function setCropTool(tool) {
  cropTool = tool;
  cropPoints = [];
  cropDrawing = false;
  redrawCropOverlay();

  const free = $('freehandCropButton');
  const poly = $('polygonCropButton');
  free.classList.toggle('active', tool === 'freehand');
  poly.classList.toggle('active', tool === 'polygon');
  free.setAttribute('aria-pressed', tool === 'freehand' ? 'true' : 'false');
  poly.setAttribute('aria-pressed', tool === 'polygon' ? 'true' : 'false');

  cropHint.textContent = tool === 'freehand'
    ? 'Frihånd aktiv: tegn rundt om området med mus, finger eller Apple Pencil.'
    : 'Polygon aktiv: tryk punkter langs kanten.';

  // Choosing a crop tool is itself an explicit request to prepare cropping.
  // The Start button remains available, but this prevents the UI looking inert.
  if (selectedModel && !cropMode) {
    setStatus(`${tool === 'freehand' ? 'Frihånd' : 'Polygon'} valgt – tryk “Start beskæring”.`);
  }
  updateCropButtons();
}

function pointInPolygon(point, polygon) {
  let inside = false;

  for (
    let i = 0, j = polygon.length - 1;
    i < polygon.length;
    j = i++
  ) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersect =
      ((yi > point.y) !== (yj > point.y)) &&
      (
        point.x <
        (xj - xi) *
        (point.y - yi) /
        ((yj - yi) || Number.EPSILON) +
        xi
      );

    if (intersect) inside = !inside;
  }

  return inside;
}

function projectedScreenPoint(worldVector) {
  const rect = renderer.domElement.getBoundingClientRect();
  const projected = worldVector.clone().project(camera);

  return {
    x: (projected.x * 0.5 + 0.5) * rect.width,
    y: (-projected.y * 0.5 + 0.5) * rect.height
  };
}

function materialIndexForTriangle(
  geometry,
  indexOffset
) {
  if (!geometry.groups?.length) return 0;

  for (const group of geometry.groups) {
    if (
      indexOffset >= group.start &&
      indexOffset < group.start + group.count
    ) {
      return group.materialIndex || 0;
    }
  }

  return 0;
}

function cropMeshGeometry(
  mesh,
  polygon,
  keepInside
) {
  const geometry = mesh.geometry;
  const positions = geometry.attributes?.position;

  if (!positions || positions.count < 3) return false;

  const indexArray = geometry.index
    ? Array.from(geometry.index.array)
    : Array.from(
        { length: positions.count },
        (_, index) => index
      );

  mesh.updateWorldMatrix(true, false);

  const byMaterial = new Map();

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const centroid = new THREE.Vector3();

  for (let i = 0; i + 2 < indexArray.length; i += 3) {
    const ia = indexArray[i];
    const ib = indexArray[i + 1];
    const ic = indexArray[i + 2];

    a.fromBufferAttribute(positions, ia)
      .applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(positions, ib)
      .applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(positions, ic)
      .applyMatrix4(mesh.matrixWorld);

    centroid.copy(a)
      .add(b)
      .add(c)
      .multiplyScalar(1 / 3);

    const screenPoint = projectedScreenPoint(centroid);
    const inside = pointInPolygon(
      screenPoint,
      polygon
    );

    const keep = keepInside ? inside : !inside;

    if (!keep) continue;

    const materialIndex =
      materialIndexForTriangle(geometry, i);

    if (!byMaterial.has(materialIndex)) {
      byMaterial.set(materialIndex, []);
    }

    byMaterial
      .get(materialIndex)
      .push(ia, ib, ic);
  }

  const selectedIndices = [];

  geometry.clearGroups();

  const sortedEntries = [...byMaterial.entries()]
    .sort((aEntry, bEntry) => aEntry[0] - bEntry[0]);

  for (const [materialIndex, indices] of sortedEntries) {
    const start = selectedIndices.length;
    selectedIndices.push(...indices);

    geometry.addGroup(
      start,
      indices.length,
      materialIndex
    );
  }

  if (!selectedIndices.length) {
    geometry.setIndex([]);
    return true;
  }

  geometry.setIndex(selectedIndices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return true;
}

function cloneForCrop(model) {
  const clone = model.root.clone(true);

  clone.traverse(object => {
    if (!object.isMesh && !object.isPoints) return;

    if (object.geometry) {
      object.geometry = object.geometry.clone();
    }

    /* materials & textures can stay shared: cropping changes only indices,
       never the colour image, UVs or material values. */
  });

  clone.position.copy(model.root.position);
  clone.quaternion.copy(model.root.quaternion);
  clone.scale.copy(model.root.scale);

  return clone;
}

function applyCrop(keepInside) {
  if (
    !selectedModel ||
    cropPoints.length < 3
  ) return;

  const original = selectedModel;
  const croppedRoot = cloneForCrop(original);

  let meshCount = 0;

  croppedRoot.traverse(object => {
    if (!object.isMesh) return;

    if (
      cropMeshGeometry(
        object,
        cropPoints,
        keepInside
      )
    ) {
      meshCount += 1;
    }
  });

  if (!meshCount) {
    setStatus(
      'Den valgte model indeholder ingen trekants-mesh, der kan beskæres.'
    );
    return;
  }

  original.root.visible = false;

  const name =
    `${original.name} – beskåret`;

  const newModel = addModel(
    croppedRoot,
    name,
    {
      alreadyPrepared: true,
      cropped: true,
      skipFit: true
    }
  );

  cancelCrop();
  selectModel(newModel);

  setStatus(
    `Beskåret kopi oprettet. Originalen "${original.name}" er bevaret og skjult.`
  );
}

/* ---------- PNG EXPORT ---------- */

async function exportPng() {
  const width = Math.max(
    200,
    Math.min(
      10000,
      Number.parseInt($('exportWidth').value) || 3000
    )
  );

  const height = Math.max(
    200,
    Math.min(
      10000,
      Number.parseInt($('exportHeight').value) || 2000
    )
  );

  const previousSize = new THREE.Vector2();
  renderer.getSize(previousSize);

  const previousPixelRatio =
    renderer.getPixelRatio();

  const previousPerspectiveAspect =
    perspectiveCamera.aspect;

  const previousOrtho = {
    left: orthographicCamera.left,
    right: orthographicCamera.right,
    top: orthographicCamera.top,
    bottom: orthographicCamera.bottom
  };

  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);

  if (camera.isPerspectiveCamera) {
    camera.aspect = width / height;
  } else {
    const centerX =
      (camera.left + camera.right) / 2;

    const centerY =
      (camera.top + camera.bottom) / 2;

    const halfHeight =
      (camera.top - camera.bottom) / 2;

    const halfWidth =
      halfHeight * (width / height);

    camera.left = centerX - halfWidth;
    camera.right = centerX + halfWidth;
    camera.top = centerY + halfHeight;
    camera.bottom = centerY - halfHeight;
  }

  camera.updateProjectionMatrix();
  renderer.render(scene, camera);

  const image =
    renderer.domElement.toDataURL('image/png');

  const link = document.createElement('a');
  link.href = image;
  link.download =
    `ArchaeoPlan-${new Date()
      .toISOString()
      .slice(0, 19)
      .replace(/[:T]/g, '-')}.png`;

  link.click();

  renderer.setPixelRatio(previousPixelRatio);
  renderer.setSize(
    previousSize.x,
    previousSize.y,
    false
  );

  perspectiveCamera.aspect =
    previousPerspectiveAspect;

  Object.assign(
    orthographicCamera,
    previousOrtho
  );

  camera.updateProjectionMatrix();

  setStatus(
    `PNG gemt: ${width} × ${height} px`
  );
}

function resize() {
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;

  renderer.setSize(width, height, false);

  perspectiveCamera.aspect = width / height;
  perspectiveCamera.updateProjectionMatrix();

  const halfHeight =
    (orthographicCamera.top -
      orthographicCamera.bottom) / 2 || 5;

  orthographicCamera.left =
    -halfHeight * width / height;

  orthographicCamera.right =
    halfHeight * width / height;

  orthographicCamera.updateProjectionMatrix();

  cropOverlay.setAttribute(
    'viewBox',
    `0 0 ${width} ${height}`
  );
}

/* ---------- UI ---------- */

$('newProjectButton')
  .addEventListener('click', newProject);

$('addFileButton')
  .addEventListener('click', () => fileInput.click());

fileInput
  .addEventListener('change', event =>
    loadFiles(event.target.files)
  );

$('exportButton')
  .addEventListener('click', exportPng);

$('perspectiveButton')
  .addEventListener('click', () =>
    switchCamera(false)
  );

$('orthographicButton')
  .addEventListener('click', () =>
    switchCamera(true)
  );

$('gridToggle')
  .addEventListener('change', event => {
    grid.visible = event.target.checked;
  });

$('translateButton')
  .addEventListener('click', () => {
    transform.setMode('translate');

    $('translateButton')
      .classList.add('active');

    $('rotateButton')
      .classList.remove('active');
  });

$('rotateButton')
  .addEventListener('click', () => {
    transform.setMode('rotate');

    $('rotateButton')
      .classList.add('active');

    $('translateButton')
      .classList.remove('active');
  });

$('lockButton')
  .addEventListener('click', () => {
    if (!selectedModel) return;

    selectedModel.root.userData.locked =
      !selectedModel.root.userData.locked;

    transform.detach();

    if (
      !selectedModel.root.userData.locked &&
      !cropMode
    ) {
      transform.attach(selectedModel.root);
    }

    syncTransformFields();
  });

$('freehandCropButton')
  .addEventListener('click', () => setCropTool('freehand'));

$('polygonCropButton')
  .addEventListener('click', () => setCropTool('polygon'));

$('startCropButton')
  .addEventListener('click', startCrop);

$('cancelCropButton')
  .addEventListener('click', cancelCrop);

$('cropInsideButton')
  .addEventListener('click', () =>
    applyCrop(true)
  );

$('cropOutsideButton')
  .addEventListener('click', () =>
    applyCrop(false)
  );

for (
  const button of
  document.querySelectorAll('[data-view]')
) {
  button.addEventListener(
    'click',
    () => setStandardView(button.dataset.view)
  );
}

for (
  const eventName of
  ['dragenter', 'dragover']
) {
  viewport.addEventListener(
    eventName,
    event => {
      event.preventDefault();
      $('dropZone').classList.add('show');
    }
  );
}

for (
  const eventName of
  ['dragleave', 'drop']
) {
  viewport.addEventListener(
    eventName,
    event => {
      event.preventDefault();
      $('dropZone').classList.remove('show');
    }
  );
}

viewport.addEventListener(
  'drop',
  event => loadFiles(event.dataTransfer.files)
);

cropInputLayer.addEventListener('pointerdown', event => {
  if (!cropMode) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  cropPointerDown(event);
}, { passive: false, capture: true });

cropInputLayer.addEventListener('pointermove', event => {
  if (!cropMode) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  cropPointerMove(event);
}, { passive: false, capture: true });

cropInputLayer.addEventListener('pointerup', event => {
  if (!cropMode) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  cropPointerUp(event);
}, { passive: false, capture: true });

cropInputLayer.addEventListener('pointercancel', event => {
  if (!cropMode) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  cropPointerUp(event);
}, { passive: false, capture: true });

['touchstart','touchmove','touchend','gesturestart','gesturechange','gestureend'].forEach(name => {
  cropInputLayer.addEventListener(name, event => {
    if (cropMode) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, { passive: false, capture: true });
});

cropInputLayer.addEventListener('contextmenu', event => {
  if (cropMode) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
});

window.addEventListener('resize', resize);

resize();
updateCropButtons();
setStatus(`ArchaeoPlan v${VERSION} klar.`);

function animate() {
  requestAnimationFrame(animate);
  orbit.update();
  renderer.render(scene, camera);
}

animate();
