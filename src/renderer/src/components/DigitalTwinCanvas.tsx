import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import type {
  DigitalTwinComponent,
  DigitalTwinDashboard,
  DigitalTwinLayerKey,
  DigitalTwinLayerState,
  DigitalTwinViewMode
} from '@shared/types'

interface DigitalTwinCanvasProps {
  dashboard: DigitalTwinDashboard | null
  background: 'white' | 'gray'
  viewMode: DigitalTwinViewMode
  transparentMode: boolean
  xrayMode: boolean
  selectedComponentId?: string | null
  focusComponentIds?: string[]
  focusDamageMarkerIds?: string[]
  onSelectComponent?: (component: DigitalTwinComponent | null) => void
}

const interiorLayers = new Set<DigitalTwinLayerKey>(['interior', 'electrical', 'glass', 'upholstery'])
const exteriorLayers = new Set<DigitalTwinLayerKey>(['exterior', 'engine', 'chassis', 'suspension', 'glass'])

export function DigitalTwinCanvas({
  dashboard,
  background,
  viewMode,
  transparentMode,
  xrayMode,
  selectedComponentId,
  focusComponentIds = [],
  focusDamageMarkerIds = [],
  onSelectComponent
}: DigitalTwinCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const selectRef = useRef(onSelectComponent)

  useEffect(() => {
    selectRef.current = onSelectComponent
  }, [onSelectComponent])

  useEffect(() => {
    const mount = mountRef.current

    if (!mount) {
      return undefined
    }

    const host = mount
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(background === 'gray' ? '#eeeeec' : '#ffffff')

    const camera = new THREE.PerspectiveCamera(42, host.clientWidth / host.clientHeight, 0.1, 120)
    camera.position.set(5.5, 2.8, 6.8)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(host.clientWidth, host.clientHeight)
    host.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.enablePan = true
    controls.target.set(0, 1.1, 0)

    scene.add(new THREE.HemisphereLight('#ffffff', '#8a8a80', 1.4))
    const keyLight = new THREE.DirectionalLight('#ffffff', 2.4)
    keyLight.position.set(4, 7, 6)
    const rimLight = new THREE.DirectionalLight('#dfe8ff', 1.1)
    rimLight.position.set(-6, 4, -5)
    scene.add(keyLight, rimLight)
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(4.2, 64),
      new THREE.MeshBasicMaterial({ color: '#d9d9d2', transparent: true, opacity: 0.55 })
    )
    floor.rotation.x = -Math.PI / 2
    scene.add(floor, new THREE.GridHelper(8, 16, '#c4c4bb', '#dcdcd4'))

    const modelGroup = new THREE.Group()
    const markerGroup = new THREE.Group()
    scene.add(modelGroup, markerGroup)

    let disposed = false

    const activeLayers = resolveActiveLayers(dashboard?.layers ?? [], viewMode)
    const layerByKey = new Map((dashboard?.layers ?? []).map((layer) => [layer.layer, layer]))

    if (dashboard?.model?.status === 'ready' && dashboard.model.modelUrl) {
      if (dashboard.model.modelUrl.toLowerCase().endsWith('.obj')) {
        const loader = new OBJLoader()
        loader.load(
          dashboard.model.modelUrl,
          (object) => {
            if (disposed) {
              disposeObject(object)
              return
            }

            prepareLoadedModel(object, activeLayers, layerByKey, transparentMode, xrayMode)
            modelGroup.add(object)
            frameObject(camera, controls, object)
          },
          undefined,
          () => {
            if (!disposed) {
              markerGroup.add(buildLoadErrorMarker())
            }
          }
        )
      } else {
        const loader = new GLTFLoader()
        loader.load(
          dashboard.model.modelUrl,
          (gltf) => {
            if (disposed) {
              disposeObject(gltf.scene)
              return
            }

            prepareLoadedModel(gltf.scene, activeLayers, layerByKey, transparentMode, xrayMode)
            modelGroup.add(gltf.scene)
            frameObject(camera, controls, gltf.scene)
          },
          undefined,
          () => {
            if (!disposed) {
              markerGroup.add(buildLoadErrorMarker())
            }
          }
        )
      }
    }

    const componentsByMesh = new Map<string, DigitalTwinComponent>()

    for (const component of dashboard?.components ?? []) {
      if (!activeLayers.has(component.layer)) {
        continue
      }

      const layer = dashboard?.layers.find((item) => item.layer === component.layer)

      if (layer && !layer.visible) {
        continue
      }

      const marker = buildComponentMarker(
        component,
        layer,
        selectedComponentId === component.id || focusComponentIds.includes(component.id),
        transparentMode,
        xrayMode
      )
      componentsByMesh.set(marker.uuid, component)
      markerGroup.add(marker)
    }

    for (const marker of dashboard?.damageMarkers ?? []) {
      const layer = inferMarkerLayer(marker.damageType)
      const layerState = dashboard?.layers.find((item) => item.layer === layer)

      if (!activeLayers.has(layer) || layerState?.visible === false) {
        continue
      }

      markerGroup.add(
        buildDamageMarker(
          marker.position,
          marker.severity === 'pending' ? '#cc2f2f' : '#f06b2f',
          focusDamageMarkerIds.includes(marker.id)
        )
      )
    }

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()

    function handlePointerDown(event: PointerEvent): void {
      const bounds = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1
      pointer.y = -(((event.clientY - bounds.top) / bounds.height) * 2 - 1)
      raycaster.setFromCamera(pointer, camera)

      const hits = raycaster.intersectObjects(markerGroup.children, true)
      const hit = hits.find((candidate) => findComponentMarker(candidate.object, componentsByMesh))

      if (hit) {
        const component = findComponentMarker(hit.object, componentsByMesh)
        selectRef.current?.(component ?? null)
      } else {
        selectRef.current?.(null)
      }
    }

    renderer.domElement.addEventListener('pointerdown', handlePointerDown)

    function resize(): void {
      camera.aspect = host.clientWidth / host.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(host.clientWidth, host.clientHeight)
    }

    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(host)

    let frame = 0
    function animate(): void {
      frame = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }

    animate()

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown)
      controls.dispose()
      disposeObject(scene)
      renderer.dispose()
      host.removeChild(renderer.domElement)
    }
  }, [background, dashboard, focusComponentIds, focusDamageMarkerIds, selectedComponentId, transparentMode, viewMode, xrayMode])

  return <div ref={mountRef} className="three-viewport" />
}

function buildComponentMarker(
  component: DigitalTwinComponent,
  layer: DigitalTwinLayerState | undefined,
  selected: boolean,
  transparentMode: boolean,
  xrayMode: boolean
): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(selected ? 0.09 : 0.066, 20, 16)
  const opacity = xrayMode ? 0.94 : transparentMode || (layer?.opacity ?? 1) < 1 ? Math.max(0.22, layer?.opacity ?? 0.34) : 1
  const material = new THREE.MeshStandardMaterial({
    color: component.color,
    emissive: component.color,
    emissiveIntensity: selected ? 0.55 : 0.18,
    roughness: 0.35,
    metalness: 0.05,
    transparent: opacity < 1,
    opacity,
    depthWrite: !xrayMode
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(component.position.x, component.position.y, component.position.z)
  mesh.userData.componentId = component.id
  return mesh
}

function prepareLoadedModel(
  object3d: THREE.Object3D,
  activeLayers: Set<DigitalTwinLayerKey>,
  layerByKey: Map<DigitalTwinLayerKey, DigitalTwinLayerState>,
  transparentMode: boolean,
  xrayMode: boolean
): void {
  object3d.traverse((object) => {
    object.userData.layer = object.userData.layer ?? 'exterior'
    const layerKey = object.userData.layer as DigitalTwinLayerKey
    const layer = layerByKey.get(layerKey)
    object.visible = activeLayers.has(layerKey) && (layer?.visible ?? true)

    if (object instanceof THREE.Mesh) {
      applyMaterialMode(object, transparentMode, xrayMode, layer?.opacity ?? 1)
    }
  })
}

function buildDamageMarker(position: { x: number; y: number; z: number }, color: string, selected: boolean): THREE.Group {
  const group = new THREE.Group()
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(selected ? 0.065 : 0.045, 16, 12),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.45,
      transparent: true,
      opacity: 0.88
    })
  )
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(selected ? 0.13 : 0.095, 0.008, 8, 28),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.72 })
  )
  ring.rotation.x = Math.PI / 2
  group.add(sphere, ring)
  group.position.set(position.x, position.y, position.z)
  return group
}

function buildLoadErrorMarker(): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.18, 0.18),
    new THREE.MeshBasicMaterial({ color: '#cc2f2f' })
  )
}

function findComponentMarker(
  object: THREE.Object3D,
  componentsByMesh: Map<string, DigitalTwinComponent>
): DigitalTwinComponent | null {
  let cursor: THREE.Object3D | null = object

  while (cursor) {
    const componentId = cursor.userData.componentId as string | undefined
    const component = componentId
      ? [...componentsByMesh.values()].find((candidate) => candidate.id === componentId) ?? null
      : componentsByMesh.get(cursor.uuid) ?? null

    if (component) {
      return component
    }

    cursor = cursor.parent
  }

  return null
}

function resolveActiveLayers(layers: DigitalTwinLayerState[], viewMode: DigitalTwinViewMode): Set<DigitalTwinLayerKey> {
  const visibleLayers = new Set(layers.filter((layer) => layer.visible).map((layer) => layer.layer))

  if (viewMode === 'interior') {
    return intersectLayers(visibleLayers, interiorLayers)
  }

  if (viewMode === 'exterior') {
    return intersectLayers(visibleLayers, exteriorLayers)
  }

  return visibleLayers
}

function intersectLayers(source: Set<DigitalTwinLayerKey>, filter: Set<DigitalTwinLayerKey>): Set<DigitalTwinLayerKey> {
  return new Set([...source].filter((layer) => filter.has(layer)))
}

function inferMarkerLayer(value: string): DigitalTwinLayerKey {
  const normalized = value.toLowerCase()

  if (normalized.includes('interior') || normalized.includes('asiento') || normalized.includes('tapicer')) {
    return 'interior'
  }

  if (normalized.includes('electrico') || normalized.includes('faro') || normalized.includes('radio')) {
    return 'electrical'
  }

  return 'exterior'
}

function applyMaterialMode(mesh: THREE.Mesh, transparentMode: boolean, xrayMode: boolean, layerOpacity: number): void {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]

  for (const material of materials) {
    const baseOpacity = (material.userData.baseOpacity ??= material.opacity)
    material.transparent = transparentMode || xrayMode || layerOpacity < 1 || baseOpacity < 1
    material.opacity = xrayMode ? 0.22 : transparentMode ? 0.34 : Math.min(layerOpacity, baseOpacity)
    material.depthWrite = !xrayMode
    material.needsUpdate = true
  }
}

function frameObject(camera: THREE.PerspectiveCamera, controls: OrbitControls, object: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(object)
  const sphere = box.getBoundingSphere(new THREE.Sphere())

  if (!Number.isFinite(sphere.radius) || sphere.radius === 0) {
    return
  }

  controls.target.copy(sphere.center)
  camera.position.set(sphere.center.x + sphere.radius * 1.25, sphere.center.y + sphere.radius * 0.42, sphere.center.z + sphere.radius * 1.35)
  camera.near = Math.max(0.05, sphere.radius / 100)
  camera.far = sphere.radius * 12
  camera.updateProjectionMatrix()
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose()
      const materials = Array.isArray(child.material) ? child.material : [child.material]

      for (const material of materials) {
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) {
            value.dispose()
          }
        }

        material.dispose()
      }
    }
  })
}
