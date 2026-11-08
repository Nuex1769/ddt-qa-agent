import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

export type SceneDrink = {
  id: string
  glass: 'highball' | 'rocks' | 'pint' | 'coupe'
  liquid: string
  garnish: 'lime' | 'orange' | 'yuzu' | 'berry' | 'none'
  mint: boolean
  ice: boolean
  bubbles: boolean
  foam: boolean
  body: 'sparkling' | 'spirit' | 'beer' | 'stout'
}

type BuiltGlass = {
  kind: SceneDrink['glass']
  group: THREE.Group
  liquid: THREE.MeshPhysicalMaterial
  ice: THREE.Object3D
  bubbles: THREE.Object3D
  foam: THREE.Object3D
  mint: THREE.Object3D
  garnishes: Partial<Record<SceneDrink['garnish'], THREE.Object3D>>
}

const BODY = {
  sparkling: { transmission: 0.12, roughness: 0.16, thickness: 0.2 },
  spirit: { transmission: 0.06, roughness: 0.2, thickness: 0.28 },
  beer: { transmission: 0.03, roughness: 0.24, thickness: 0.16 },
  stout: { transmission: 0, roughness: 0.42, thickness: 0.08 },
} as const

const BAR_Y = 0.7

export function webglSupported() {
  try {
    if (localStorage.getItem('slow-side-force-flat') === '1') return false
  } catch {
    /* 存储不可用时仍探测画布。 */
  }
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
    if (!gl) return false
    const lose = gl.getExtension('WEBGL_lose_context') as { loseContext?: () => void } | null
    lose?.loseContext?.()
    return true
  } catch {
    return false
  }
}

export class BarScene {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private geos: THREE.BufferGeometry[] = []
  private mats: THREE.Material[] = []
  private textures: THREE.Texture[] = []
  private env: THREE.Texture | null = null
  private glass = new THREE.Group()
  private glasses: BuiltGlass[] = []
  private pickables: THREE.Object3D[] = []
  private platter = new THREE.Group()
  private coasterCanvas = document.createElement('canvas')
  private coasterTexture: THREE.CanvasTexture
  private lookTarget = new THREE.Vector3(0.16, 0.98, -0.18)
  private baseOffset = new THREE.Vector3()
  private offset = new THREE.Vector3()
  private up = new THREE.Vector3(0, 1, 0)
  private raycaster = new THREE.Raycaster()
  private pointer = new THREE.Vector2()
  private observer: ResizeObserver
  private drag: {
    id: number
    x: number
    y: number
    dx: number
    dy: number
    glass: boolean
    active: boolean
  } | null = null
  private raf = 0
  private running = false
  private disposed = false
  private reduced = false
  private music = false
  private yaw = 0
  private targetYaw = 0
  private glassYaw = 0.55
  private focus = 0
  private focusFrom = 0
  private focusTo = 0
  private focusStart = 0
  private focusDur = 0
  private drinkId = ''
  private stamp: string | null = null
  private last = 0
  private pixelRatio: number
  private bubbleHome: { mesh: THREE.Object3D; y: number; phase: number }[] = []
  private onPointerDown: (event: PointerEvent) => void
  private onPointerMove: (event: PointerEvent) => void
  private onPointerUp: (event: PointerEvent) => void
  private onLost: (event: Event) => void

  constructor(
    private canvas: HTMLCanvasElement,
    private options: { onSelect: (id: string) => void; onContextLost: () => void },
  ) {
    const compact = window.matchMedia('(max-width: 800px)').matches
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, compact ? 1.5 : 1.75)
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: false,
    })
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.08
    this.renderer.setClearColor(0x101c18, 1)
    this.renderer.setPixelRatio(this.pixelRatio)
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.05, 20)
    this.camera.position.set(0.02, 1.18, 1.42)
    this.baseOffset.copy(this.camera.position).sub(this.lookTarget)
    this.scene.fog = new THREE.Fog(0x14241e, 3.2, 7.4)
    this.scene.environmentIntensity = 0.4
    this.env = this.makeEnvironment()
    this.scene.environment = this.env
    this.addLights()
    this.addRoom()
    this.addGlasses(compact ? 20 : 28)
    this.addBottles()
    this.addRecord()
    this.coasterCanvas.width = 512
    this.coasterCanvas.height = 512
    this.coasterTexture = new THREE.CanvasTexture(this.coasterCanvas)
    this.coasterTexture.colorSpace = THREE.SRGBColorSpace
    this.textures.push(this.coasterTexture)
    this.drawCoaster()
    this.addForeground()
    this.glass.scale.setScalar(1.55)
    this.scene.add(this.glass)
    this.pickables.push(this.glass)
    this.canvas.dataset.glassYaw = this.glassYaw.toFixed(3)
    this.resize()
    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(canvas)
    this.onPointerDown = (event) => this.pointerDown(event)
    this.onPointerMove = (event) => this.pointerMove(event)
    this.onPointerUp = (event) => this.pointerUp(event)
    this.onLost = (event) => {
      event.preventDefault()
      if (this.disposed) return
      this.pause()
      this.options.onContextLost()
    }
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointercancel', this.onPointerUp)
    canvas.addEventListener('webglcontextlost', this.onLost)
    document.fonts?.ready.then(() => {
      if (!this.disposed) {
        this.drawCoaster()
        if (!this.running) this.renderOnce()
      }
    })
  }

  start() {
    this.resume()
    this.canvas.dataset.scene = 'live'
  }

  setReducedMotion(value: boolean) {
    this.reduced = value
    if (value) {
      this.yaw = this.targetYaw
      this.focus = this.focusTo || this.focus
    }
  }

  setMusic(on: boolean) {
    this.music = on
  }

  setDrink(drink: SceneDrink) {
    const changed = this.drinkId !== '' && this.drinkId !== drink.id
    this.drinkId = drink.id
    for (const glass of this.glasses) {
      const active = glass.kind === drink.glass
      glass.group.visible = active
      if (!active) continue
      const look = BODY[drink.body]
      glass.liquid.color.set(drink.liquid)
      glass.liquid.emissive.set(drink.liquid)
      glass.liquid.emissiveIntensity = drink.body === 'stout' ? 0.05 : 0.1
      glass.liquid.transmission = look.transmission
      glass.liquid.roughness = look.roughness
      glass.liquid.thickness = look.thickness
      glass.ice.visible = drink.ice
      glass.bubbles.visible = drink.bubbles
      glass.foam.visible = drink.foam
      glass.mint.visible = drink.mint
      for (const [name, garnish] of Object.entries(glass.garnishes)) {
        garnish.visible = name === drink.garnish
      }
    }
    this.canvas.dataset.drink = drink.id
    if (changed) this.beginFocus()
    if (!this.running) this.renderOnce()
  }

  setStamp(label: string | null) {
    if (label === this.stamp) return
    this.stamp = label
    this.drawCoaster()
    if (!this.running) this.renderOnce()
  }

  nudgeGlass(delta: number) {
    this.glassYaw += delta
    this.glass.rotation.y = this.glassYaw
    this.canvas.dataset.glassYaw = this.glassYaw.toFixed(3)
    if (!this.running) this.renderOnce()
  }

  nudgeYaw(delta: number) {
    this.targetYaw = THREE.MathUtils.clamp(this.targetYaw + delta, -0.38, 0.38)
    if (this.reduced) this.yaw = this.targetYaw
    if (!this.running) this.renderOnce()
  }

  resetYaw() {
    this.targetYaw = 0
    if (this.reduced) this.yaw = 0
    if (!this.running) this.renderOnce()
  }

  resize() {
    const width = this.canvas.clientWidth
    const height = this.canvas.clientHeight
    if (width < 2 || height < 2) return
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setPixelRatio(this.pixelRatio)
    this.renderer.setSize(width, height, false)
    if (!this.running) this.renderOnce()
  }

  resume() {
    if (this.disposed || this.running) return
    this.resize()
    this.running = true
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.frame)
  }

  pause() {
    this.running = false
    cancelAnimationFrame(this.raf)
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.pause()
    this.observer.disconnect()
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerup', this.onPointerUp)
    this.canvas.removeEventListener('pointercancel', this.onPointerUp)
    this.canvas.removeEventListener('webglcontextlost', this.onLost)
    this.geos.forEach((geometry) => geometry.dispose())
    this.mats.forEach((material) => material.dispose())
    this.textures.forEach((texture) => texture.dispose())
    this.env?.dispose()
    this.renderer.dispose()
  }

  private frame = (now: number) => {
    if (!this.running || this.disposed) return
    const dt = Math.min(0.05, (now - this.last) / 1000)
    this.last = now
    if (this.music && !this.reduced) this.platter.rotation.y += dt * 0.65
    if (!this.reduced) {
      const t = now / 1000
      for (const bubble of this.bubbleHome) {
        const parent = bubble.mesh.parent
        if (!parent?.visible) continue
        bubble.mesh.position.y = bubble.y + Math.sin(t * 1.3 + bubble.phase) * 0.007
      }
      if (this.focusDur > 0) {
        const progress = Math.min(1, (now - this.focusStart) / this.focusDur)
        const eased = progress * progress * (3 - 2 * progress)
        this.focus = this.focusFrom + (this.focusTo - this.focusFrom) * eased
      }
      this.yaw += (this.targetYaw - this.yaw) * 0.16
    }
    this.glass.rotation.y = this.glassYaw
    this.updateCamera()
    this.renderer.render(this.scene, this.camera)
    this.canvas.dataset.glassYaw = this.glassYaw.toFixed(3)
    this.raf = requestAnimationFrame(this.frame)
  }

  private beginFocus() {
    if (this.reduced) {
      this.focus = 1
      this.focusTo = 1
      return
    }
    this.focusFrom = 0.2
    this.focus = 0.2
    this.focusTo = 1
    this.focusStart = performance.now()
    this.focusDur = 420
  }

  private renderOnce() {
    if (this.disposed) return
    this.glass.rotation.y = this.glassYaw
    this.updateCamera()
    const width = this.canvas.clientWidth
    if (width < 2) return
    this.renderer.render(this.scene, this.camera)
  }

  private updateCamera() {
    const dist = 1 - this.focus * 0.1
    this.offset.copy(this.baseOffset).multiplyScalar(dist)
    this.offset.applyAxisAngle(this.up, this.yaw)
    this.camera.position.copy(this.lookTarget).add(this.offset)
    this.camera.lookAt(this.lookTarget)
  }

  private pointerDown(event: PointerEvent) {
    if (event.button !== 0) return
    this.drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      dx: 0,
      dy: 0,
      glass: this.hitsGlass(event),
      active: false,
    }
  }

  private pointerMove(event: PointerEvent) {
    const drag = this.drag
    if (!drag || drag.id !== event.pointerId) return
    drag.dx = event.clientX - drag.x
    drag.dy = event.clientY - drag.y
    if (!drag.active) {
      if (Math.hypot(drag.dx, drag.dy) < 7) return
      if (Math.abs(drag.dy) > Math.abs(drag.dx)) {
        this.drag = null
        return
      }
      drag.active = true
      this.canvas.setPointerCapture(event.pointerId)
    }
    if (drag.glass) this.glassYaw += event.movementX * 0.012
    else
      this.targetYaw = THREE.MathUtils.clamp(this.targetYaw - event.movementX * 0.0045, -0.38, 0.38)
    if (this.reduced) this.yaw = this.targetYaw
  }

  private pointerUp(event: PointerEvent) {
    const drag = this.drag
    if (!drag || drag.id !== event.pointerId) return
    this.drag = null
    if (drag.active) {
      if (this.canvas.hasPointerCapture(event.pointerId))
        this.canvas.releasePointerCapture(event.pointerId)
      return
    }
    if (Math.hypot(drag.dx, drag.dy) > 8) return
    const hits = this.cast(event)
    for (const hit of hits) {
      let object: THREE.Object3D | null = hit.object
      while (object) {
        if (typeof object.userData.drinkId === 'string') {
          this.options.onSelect(object.userData.drinkId)
          return
        }
        object = object.parent
      }
    }
  }

  private hitsGlass(event: PointerEvent) {
    return this.cast(event).some((hit) => {
      let object: THREE.Object3D | null = hit.object
      while (object) {
        if (object.userData.glass) return true
        object = object.parent
      }
      return false
    })
  }

  private cast(event: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return []
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)
    return this.raycaster.intersectObjects(this.pickables, true)
  }

  private makeEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()
    return texture
  }

  private addLights() {
    this.scene.add(new THREE.HemisphereLight(0xd5e2d6, 0x3a2618, 0.55))
    const key = new THREE.PointLight(0xffc48a, 28, 6.5, 2)
    key.position.set(0.55, 1.85, 0.55)
    this.scene.add(key)
    const shelf = new THREE.PointLight(0xffb15e, 16, 3.4, 2)
    shelf.position.set(0.1, 1.48, -0.45)
    this.scene.add(shelf)
    const fill = new THREE.DirectionalLight(0xc9ddd0, 0.38)
    fill.position.set(-1.4, 1.4, 1.2)
    this.scene.add(fill)
    const bulb = new THREE.Mesh(
      this.geo(new THREE.SphereGeometry(0.028, 12, 10)),
      this.mat(new THREE.MeshBasicMaterial({ color: 0xffe0b8 })),
    )
    bulb.position.copy(key.position)
    const shade = new THREE.Mesh(
      this.geo(new THREE.ConeGeometry(0.07, 0.06, 16, 1, true)),
      this.mat(
        new THREE.MeshStandardMaterial({
          color: 0xb8894a,
          metalness: 0.72,
          roughness: 0.32,
          side: THREE.DoubleSide,
        }),
      ),
    )
    shade.position.set(key.position.x, key.position.y + 0.045, key.position.z)
    shade.rotation.x = Math.PI
    this.scene.add(bulb, shade)
  }

  private addRoom() {
    const wood = this.woodMaterial()
    const wall = new THREE.Mesh(
      this.geo(new THREE.PlaneGeometry(4.4, 2.4)),
      this.mat(new THREE.MeshStandardMaterial({ color: 0x1a332b, roughness: 0.94 })),
    )
    wall.position.set(0, 1.45, -1.28)
    const wainscot = new THREE.Mesh(
      this.geo(new THREE.BoxGeometry(4.2, 0.7, 0.04)),
      this.mat(new THREE.MeshStandardMaterial({ color: 0x12241e, roughness: 0.9 })),
    )
    wainscot.position.set(0, 0.72, -1.25)
    const rail = new THREE.Mesh(
      this.geo(new THREE.BoxGeometry(3.4, 0.015, 0.02)),
      this.mat(
        new THREE.MeshStandardMaterial({ color: 0xc6a15a, metalness: 0.65, roughness: 0.35 }),
      ),
    )
    rail.position.set(0, 1.08, -1.22)
    const bar = new THREE.Mesh(this.geo(new THREE.BoxGeometry(2.5, 0.08, 1.12)), wood)
    bar.position.set(0.05, BAR_Y - 0.04, 0.08)
    const front = new THREE.Mesh(
      this.geo(new THREE.BoxGeometry(2.5, 0.42, 0.06)),
      this.mat(new THREE.MeshStandardMaterial({ color: 0x2a1810, roughness: 0.78 })),
    )
    front.position.set(0.05, BAR_Y - 0.28, 0.62)
    const brass = new THREE.Mesh(
      this.geo(new THREE.CylinderGeometry(0.012, 0.012, 2.3, 12)),
      this.mat(
        new THREE.MeshStandardMaterial({ color: 0xc6a15a, metalness: 0.78, roughness: 0.28 }),
      ),
    )
    brass.rotation.z = Math.PI / 2
    brass.position.set(0.05, BAR_Y + 0.02, 0.6)
    const back = new THREE.Mesh(
      this.geo(new THREE.BoxGeometry(2.3, 0.08, 0.46)),
      this.mat(new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 0.7 })),
    )
    back.position.set(0, 0.96, -0.78)
    const floor = new THREE.Mesh(
      this.geo(new THREE.PlaneGeometry(6, 4)),
      this.mat(new THREE.MeshStandardMaterial({ color: 0x0e1613, roughness: 1 })),
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.y = 0
    const shelfMat = this.mat(new THREE.MeshStandardMaterial({ color: 0x5a3a24, roughness: 0.62 }))
    const shelf = new THREE.Mesh(this.geo(new THREE.BoxGeometry(2.05, 0.035, 0.2)), shelfMat)
    shelf.position.set(0.05, 1.22, -0.92)
    const upper = new THREE.Mesh(this.geo(new THREE.BoxGeometry(1.55, 0.028, 0.16)), shelfMat)
    upper.position.set(-0.02, 1.58, -0.98)
    const glow = new THREE.Mesh(
      this.geo(new THREE.PlaneGeometry(1.9, 0.42)),
      this.mat(new THREE.MeshBasicMaterial({ color: 0xffc27a })),
    )
    glow.position.set(0.05, 1.4, -1.12)
    this.scene.add(wall, wainscot, rail, bar, front, brass, back, floor, shelf, upper, glow)
  }

  private addGlasses(segments: number) {
    this.glass.userData.glass = true
    this.glass.position.set(0.46, BAR_Y + 0.006, 0.08)
    const shell = this.mat(
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        roughness: 0.05,
        metalness: 0,
        transmission: 0.45,
        thickness: 0.08,
        ior: 1.45,
        transparent: true,
        opacity: 0.2,
        side: THREE.DoubleSide,
        depthWrite: false,
        clearcoat: 1,
        clearcoatRoughness: 0.08,
        envMapIntensity: 0.8,
      }),
    )
    const specs: {
      kind: SceneDrink['glass']
      profile: [number, number][]
      liquid: [number, number, number]
      rim: number
    }[] = [
      {
        kind: 'highball',
        profile: [
          [0, 0],
          [0.004, 0.034],
          [0.02, 0.038],
          [0.19, 0.042],
          [0.22, 0.05],
          [0.226, 0.046],
          [0.214, 0.034],
          [0.02, 0.028],
          [0.006, 0],
        ],
        liquid: [0.026, 0.11, 0.07],
        rim: 0.22,
      },
      {
        kind: 'rocks',
        profile: [
          [0, 0],
          [0.004, 0.055],
          [0.016, 0.062],
          [0.09, 0.068],
          [0.104, 0.074],
          [0.11, 0.07],
          [0.1, 0.058],
          [0.02, 0.05],
          [0.008, 0],
        ],
        liquid: [0.046, 0.045, 0.04],
        rim: 0.1,
      },
      {
        kind: 'pint',
        profile: [
          [0, 0],
          [0.006, 0.04],
          [0.02, 0.046],
          [0.14, 0.052],
          [0.19, 0.066],
          [0.204, 0.072],
          [0.196, 0.056],
          [0.02, 0.038],
          [0.008, 0],
        ],
        liquid: [0.034, 0.11, 0.075],
        rim: 0.2,
      },
      {
        kind: 'coupe',
        profile: [
          [0, 0.016],
          [0.012, 0.028],
          [0.06, 0.01],
          [0.078, 0.014],
          [0.1, 0.04],
          [0.128, 0.074],
          [0.136, 0.07],
          [0.12, 0.055],
          [0.09, 0.016],
          [0.078, 0],
        ],
        liquid: [0.05, 0.028, 0.108],
        rim: 0.13,
      },
    ]
    for (const spec of specs) {
      const group = new THREE.Group()
      group.visible = false
      const mesh = new THREE.Mesh(this.geo(this.lathe(spec.profile, segments)), shell)
      mesh.renderOrder = 3
      const liquidMat = this.mat(
        new THREE.MeshPhysicalMaterial({
          color: 0xffffff,
          roughness: 0.12,
          metalness: 0,
          transmission: 0.5,
          thickness: 0.3,
          ior: 1.33,
          transparent: true,
        }),
      )
      const liquid = new THREE.Mesh(
        this.geo(
          new THREE.CylinderGeometry(
            spec.liquid[0],
            spec.liquid[0] * 0.92,
            spec.liquid[1],
            segments,
          ),
        ),
        liquidMat,
      )
      liquid.position.y = spec.liquid[2]
      liquid.renderOrder = 1
      const ice = this.iceCluster(spec.kind)
      const bubbles = this.bubbleCluster(spec.kind)
      const foam = new THREE.Mesh(
        this.geo(new THREE.SphereGeometry(spec.kind === 'pint' ? 0.05 : 0.04, 16, 12)),
        this.mat(new THREE.MeshStandardMaterial({ color: 0xf3ead4, roughness: 0.96 })),
      )
      foam.scale.y = 0.42
      foam.position.y = spec.liquid[2] + spec.liquid[1] / 2 + 0.004
      foam.visible = false
      const garnishes = {
        lime: this.citrus(0x8fb83a, 0xd6e07a, spec.rim),
        yuzu: this.citrus(0xd7b43a, 0xf3e2a2, spec.rim),
        orange: this.peel(spec.rim),
        berry: this.berries(spec.rim),
      }
      const mint = this.mintLeaf(spec.rim)
      group.add(
        mesh,
        liquid,
        ice,
        bubbles,
        foam,
        garnishes.lime,
        garnishes.yuzu,
        garnishes.orange,
        garnishes.berry,
        mint,
      )
      this.glass.add(group)
      this.glasses.push({
        kind: spec.kind,
        group,
        liquid: liquidMat,
        ice,
        bubbles,
        foam,
        mint,
        garnishes,
      })
    }
  }

  private addBottles() {
    const specs: { id?: string; x: number; h: number; color: number; shelf: number }[] = [
      { x: -0.78, h: 0.22, color: 0x2f6a48, shelf: 1.22 },
      { id: 'lime', x: -0.52, h: 0.3, color: 0xb6c86a, shelf: 1.22 },
      { id: 'pomelo', x: -0.28, h: 0.26, color: 0xf0c25a, shelf: 1.22 },
      { id: 'old', x: -0.02, h: 0.2, color: 0xe07a32, shelf: 1.22 },
      { id: 'juniper', x: 0.24, h: 0.32, color: 0xe7f3ec, shelf: 1.22 },
      { id: 'berry', x: 0.5, h: 0.18, color: 0xd45a86, shelf: 1.22 },
      { x: 0.74, h: 0.24, color: 0x8a4a2e, shelf: 1.22 },
      { x: -0.42, h: 0.18, color: 0xc4893a, shelf: 1.58 },
      { x: -0.16, h: 0.2, color: 0xf0eadc, shelf: 1.58 },
      { x: 0.12, h: 0.16, color: 0x3d7a58, shelf: 1.58 },
    ]
    for (const spec of specs) {
      const group = this.bottle(spec.color, spec.h)
      group.position.set(spec.x, spec.shelf + 0.02 + spec.h / 2, spec.shelf > 1.4 ? -0.96 : -0.88)
      if (spec.id) {
        group.userData.drinkId = spec.id
        this.pickables.push(group)
      }
      this.scene.add(group)
    }
    this.tap('wheat', 0.62)
    this.tap('hearth', 0.86)
  }

  private tap(id: string, x: number) {
    const group = new THREE.Group()
    group.userData.drinkId = id
    const metal = this.mat(
      new THREE.MeshStandardMaterial({ color: 0xc6a15a, metalness: 0.75, roughness: 0.3 }),
    )
    const column = new THREE.Mesh(
      this.geo(new THREE.CylinderGeometry(0.012, 0.014, 0.16, 10)),
      metal,
    )
    column.position.y = 0.08
    const handle = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.012, 0.09, 0.016)), metal)
    handle.position.set(0.02, 0.16, 0)
    handle.rotation.z = -0.4
    group.add(column, handle)
    group.position.set(x, 1.0, -0.7)
    this.pickables.push(group)
    this.scene.add(group)
  }

  private addRecord() {
    const wood = this.mat(new THREE.MeshStandardMaterial({ color: 0x3d2918, roughness: 0.68 }))
    const plinth = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.36, 0.045, 0.28)), wood)
    this.platter.add(
      new THREE.Mesh(
        this.geo(new THREE.CylinderGeometry(0.16, 0.16, 0.014, 28)),
        this.mat(
          new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4, metalness: 0.2 }),
        ),
      ),
    )
    const label = new THREE.Mesh(
      this.geo(new THREE.CylinderGeometry(0.048, 0.048, 0.018, 16)),
      this.mat(new THREE.MeshStandardMaterial({ color: 0xe7b15a, roughness: 0.55 })),
    )
    this.platter.add(label)
    this.platter.position.y = 0.03
    const arm = new THREE.Mesh(
      this.geo(new THREE.BoxGeometry(0.09, 0.008, 0.012)),
      this.mat(
        new THREE.MeshStandardMaterial({ color: 0xd7d2c8, metalness: 0.55, roughness: 0.35 }),
      ),
    )
    arm.position.set(0.1, 0.04, 0.02)
    arm.rotation.y = 0.5
    const player = new THREE.Group()
    player.add(plinth, this.platter, arm)
    player.position.set(0.18, 1.02, -0.46)
    this.scene.add(player)
  }

  private addForeground() {
    const coaster = new THREE.Mesh(
      this.geo(new THREE.CylinderGeometry(0.092, 0.092, 0.01, 28)),
      this.mat(
        new THREE.MeshStandardMaterial({
          map: this.coasterTexture,
          color: 0xf3ead7,
          roughness: 0.86,
        }),
      ),
    )
    coaster.position.set(0.46, BAR_Y + 0.008, 0.08)
    const noteTex = this.paperTexture()
    const note = new THREE.Mesh(
      this.geo(new THREE.PlaneGeometry(0.3, 0.2)),
      this.mat(new THREE.MeshStandardMaterial({ map: noteTex, roughness: 0.92 })),
    )
    note.rotation.x = -Math.PI / 2
    note.rotation.z = 0.12
    note.position.set(-0.22, BAR_Y + 0.012, 0.42)
    const tape = new THREE.Mesh(
      this.geo(new THREE.BoxGeometry(0.07, 0.006, 0.028)),
      this.mat(
        new THREE.MeshStandardMaterial({
          color: 0xd9c98a,
          roughness: 0.45,
          transparent: true,
          opacity: 0.88,
        }),
      ),
    )
    tape.position.set(-0.24, BAR_Y + 0.02, 0.34)
    tape.rotation.y = 0.1
    this.scene.add(coaster, note, tape)
  }

  private lathe(profile: [number, number][], segments: number) {
    const points = profile.map(([y, radius]) => new THREE.Vector2(radius, y))
    return new THREE.LatheGeometry(points, segments)
  }

  private iceCluster(kind: SceneDrink['glass']) {
    const group = new THREE.Group()
    const material = this.mat(
      new THREE.MeshStandardMaterial({
        color: 0xd7ebf6,
        roughness: 0.16,
        metalness: 0.02,
        transparent: true,
        opacity: 0.88,
        emissive: 0xc5dced,
        emissiveIntensity: 0.2,
      }),
    )
    const cubes =
      kind === 'rocks'
        ? [{ size: 0.05, x: 0, y: 0.062, z: 0, turn: 0.4 }]
        : [
            { size: 0.03, x: -0.008, y: 0.11, z: 0.004, turn: 0.3 },
            { size: 0.026, x: 0.01, y: 0.132, z: -0.004, turn: 0.8 },
          ]
    if (kind === 'coupe') return group
    for (const cube of cubes) {
      const mesh = new THREE.Mesh(
        this.geo(new RoundedBoxGeometry(cube.size, cube.size, cube.size, 2, cube.size * 0.18)),
        material,
      )
      mesh.position.set(cube.x, cube.y, cube.z)
      mesh.rotation.y = cube.turn
      mesh.rotation.z = 0.2
      group.add(mesh)
    }
    return group
  }

  private bubbleCluster(kind: SceneDrink['glass']) {
    const group = new THREE.Group()
    if (kind === 'rocks') return group
    const material = this.mat(
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        roughness: 0.05,
        transmission: 1,
        thickness: 0.04,
        transparent: true,
      }),
    )
    const spots = [
      [0.008, 0.07, 0.004, 0.004],
      [-0.01, 0.09, 0.002, 0.003],
      [0.004, 0.11, -0.008, 0.0035],
      [-0.004, 0.08, -0.004, 0.0025],
      [0.011, 0.1, 0.001, 0.0028],
    ] as const
    spots.forEach(([x, y, z, radius], index) => {
      const mesh = new THREE.Mesh(this.geo(new THREE.SphereGeometry(radius, 8, 8)), material)
      mesh.position.set(x, y, z)
      group.add(mesh)
      this.bubbleHome.push({ mesh, y, phase: index * 1.3 })
    })
    return group
  }

  private citrus(rindColor: number, fleshColor: number, rim: number) {
    const group = new THREE.Group()
    group.add(
      new THREE.Mesh(
        this.geo(new THREE.TorusGeometry(0.026, 0.005, 8, 16)),
        this.mat(new THREE.MeshStandardMaterial({ color: rindColor, roughness: 0.55 })),
      ),
    )
    const flesh = new THREE.Mesh(
      this.geo(new THREE.CircleGeometry(0.024, 16)),
      this.mat(
        new THREE.MeshStandardMaterial({
          color: fleshColor,
          roughness: 0.72,
          side: THREE.DoubleSide,
        }),
      ),
    )
    flesh.position.z = 0.001
    group.add(flesh)
    group.position.set(0.034, rim, 0.01)
    group.rotation.set(0.4, 0.5, -0.5)
    group.visible = false
    return group
  }

  private peel(rim: number) {
    const group = this.citrus(0xe07a2f, 0xf2c14d, rim)
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.01, rim + 0.01, 0.02),
      new THREE.Vector3(0.045, rim + 0.028, 0),
      new THREE.Vector3(0.02, rim + 0.012, -0.03),
    ])
    group.add(
      new THREE.Mesh(
        this.geo(new THREE.TubeGeometry(curve, 14, 0.005, 6, false)),
        this.mat(new THREE.MeshStandardMaterial({ color: 0xe36a22, roughness: 0.4 })),
      ),
    )
    return group
  }

  private berries(rim: number) {
    const group = new THREE.Group()
    const pick = new THREE.Mesh(
      this.geo(new THREE.CylinderGeometry(0.0015, 0.0015, 0.06, 6)),
      this.mat(new THREE.MeshStandardMaterial({ color: 0x6a5138, roughness: 0.6 })),
    )
    pick.position.y = rim + 0.02
    group.add(pick)
    const berry = this.mat(new THREE.MeshStandardMaterial({ color: 0xb43458, roughness: 0.45 }))
    ;[0, 1, 2].forEach((index) => {
      const mesh = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.008, 10, 8)), berry)
      mesh.position.set((index - 1) * 0.01, rim + 0.045, index === 1 ? 0.006 : 0)
      group.add(mesh)
    })
    group.visible = false
    return group
  }

  private mintLeaf(rim: number) {
    const leaf = new THREE.Mesh(
      this.geo(new THREE.SphereGeometry(0.016, 10, 8)),
      this.mat(new THREE.MeshStandardMaterial({ color: 0x3f8f4e, roughness: 0.6 })),
    )
    leaf.scale.set(1, 0.35, 0.7)
    leaf.position.set(-0.02, rim + 0.01, 0.02)
    leaf.rotation.z = 0.6
    leaf.visible = false
    return leaf
  }

  private bottle(color: number, height: number) {
    const group = new THREE.Group()
    const glass = this.mat(
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.16,
        metalness: 0.05,
        transparent: true,
        opacity: 0.78,
        emissive: color,
        emissiveIntensity: 0.28,
      }),
    )
    const body = new THREE.Mesh(
      this.geo(new THREE.CylinderGeometry(0.032, 0.038, height, 10)),
      glass,
    )
    const neck = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.011, 0.014, 0.09, 8)), glass)
    neck.position.y = height / 2 + 0.04
    const cap = new THREE.Mesh(
      this.geo(new THREE.CylinderGeometry(0.012, 0.012, 0.02, 8)),
      this.mat(
        new THREE.MeshStandardMaterial({ color: 0xc6a15a, metalness: 0.8, roughness: 0.28 }),
      ),
    )
    cap.position.y = height / 2 + 0.09
    group.add(body, neck, cap)
    return group
  }

  private woodMaterial() {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 256
    const context = canvas.getContext('2d')
    if (!context)
      return this.mat(new THREE.MeshStandardMaterial({ color: 0x4a2e1c, roughness: 0.68 }))
    context.fillStyle = '#3d2618'
    context.fillRect(0, 0, 512, 256)
    for (let index = 0; index < 46; index += 1) {
      context.strokeStyle = `rgba(${70 + (index % 5) * 8}, ${36 + (index % 3) * 4}, 22, 0.35)`
      context.lineWidth = 1 + (index % 3)
      context.beginPath()
      const y = (index * 37) % 256
      context.moveTo(0, y)
      context.bezierCurveTo(140, y + 8, 280, y - 6, 512, y + 3)
      context.stroke()
    }
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(2.2, 1.1)
    this.textures.push(texture)
    return this.mat(
      new THREE.MeshStandardMaterial({
        map: texture,
        color: 0x8a6244,
        roughness: 0.62,
        metalness: 0.02,
      }),
    )
  }

  private paperTexture() {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 340
    const context = canvas.getContext('2d')
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    this.textures.push(texture)
    if (!context) return texture
    context.fillStyle = '#f4efe2'
    context.fillRect(0, 0, 512, 340)
    context.strokeStyle = '#e3d3b4'
    context.strokeRect(18, 18, 476, 304)
    context.fillStyle = '#8a7760'
    context.font = '500 28px "Noto Serif SC", serif'
    context.fillText('A NOTE', 48, 86)
    context.fillStyle = '#2c382f'
    context.font = '600 42px "Noto Serif SC", serif'
    context.fillText('为你选酒', 48, 156)
    context.fillStyle = '#6d6458'
    context.font = '400 24px "Noto Serif SC", serif'
    context.fillText('心情写在画面外的纸条上', 48, 214)
    texture.needsUpdate = true
    return texture
  }

  private drawCoaster() {
    const context = this.coasterCanvas.getContext('2d')
    if (!context) return
    context.clearRect(0, 0, 512, 512)
    context.fillStyle = '#f3ead7'
    context.beginPath()
    context.arc(256, 256, 250, 0, Math.PI * 2)
    context.fill()
    context.strokeStyle = '#c4a36a'
    context.lineWidth = 8
    context.beginPath()
    context.arc(256, 256, 214, 0, Math.PI * 2)
    context.stroke()
    context.beginPath()
    context.arc(256, 256, 190, 0, Math.PI * 2)
    context.stroke()
    context.textAlign = 'center'
    context.fillStyle = '#7b6850'
    context.font = '500 28px "Noto Serif SC", serif'
    context.fillText('SLOW SIDE', 256, this.stamp ? 220 : 248)
    context.fillStyle = '#2b2418'
    context.font = '600 40px "Noto Serif SC", serif'
    context.fillText(this.stamp || '杯垫还空着', 256, this.stamp ? 280 : 300, 360)
    if (this.stamp) {
      context.fillStyle = '#8a7760'
      context.font = '400 22px "Noto Serif SC", serif'
      context.fillText('印在杯垫上', 256, 324)
    }
    this.coasterTexture.needsUpdate = true
  }

  private geo<T extends THREE.BufferGeometry>(geometry: T) {
    this.geos.push(geometry)
    return geometry
  }

  private mat<T extends THREE.Material>(material: T) {
    this.mats.push(material)
    return material
  }
}
