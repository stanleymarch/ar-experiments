// knockdown.js — game flow: place a brick pyramid, then pelt it with balls.
//
// The first tap on the tracked floor raises the tower (SLAM anchors it to
// the real world). Every later tap throws a ball from the camera through
// the tapped point; balls bounce, roll, and knock bricks loose. The HUD
// counts how much of the tower has fallen.

import {towerLayout, buildTower} from './tower'

const BALL = {
  radius: 0.14,
  mass: 2.5,   // heavier than a brick: one clean hit reshapes the pyramid
  speed: 10,   // m/s
  max: 24,     // oldest balls are recycled to keep the sim cheap
  color: '#ff5a3c',
}

const KNOCK_DISTANCE_SQ = 0.09 // 30 cm from its spawn spot, or...
const KNOCK_TILT = 0.72        // ...tipped further than ~44°: both count as fallen

const UP = {x: 0, y: 1, z: 0} // reused scratch vector for tilt checks

export const knockdownComponent = {
  init() {
    this.camera = document.getElementById('camera')
    this.prompt = document.getElementById('promptText')
    this.score = document.getElementById('scoreLabel')
    this.resetBtn = document.getElementById('resetBtn')

    this.bricks = []
    this.origins = []
    this.balls = []
    this.placed = false
    this.razed = false
    this.lastCount = -1
    this.nextCountAt = 0

    // The cursor component re-emits every raycast tap on its own entity, so
    // one listener sees taps on the ground and on the bricks alike.
    this.camera.addEventListener('click', (event) => this.onTap(event))
    this.resetBtn.addEventListener('click', (event) => {
      event.stopPropagation()
      this.reset()
    })

    this.setPrompt('Tap the floor to place the tower')
    this.updateScore(0)
  },
  onTap(event) {
    // The raycaster only sees .cantap entities: before placement that is
    // just the ground, so any hit point is a floor point. Afterwards a hit
    // can be the floor, a brick, or a ball — all fine as throw targets.
    // (Taps into empty sky hit nothing: no target, no throw.)
    const point = event.detail.intersection && event.detail.intersection.point
    if (!point) return
    if (!this.placed) {
      this.placeTower(point)
    } else {
      this.throwBall(point)
    }
  },

  placeTower(point) {
    const camPos = new THREE.Vector3()
    this.camera.object3D.getWorldPosition(camPos)
    const yaw = Math.atan2(camPos.x - point.x, camPos.z - point.z) * 180 / Math.PI

    this.bricks = buildTower(this.el.sceneEl, point, yaw)
    // origins are captured lazily in tick(): object3D positions are not yet
    // applied right after appendChild (A-Frame initializes components async).
    this.placed = true
    this.lastCount = -1
    this.setPrompt('Tap anywhere to throw balls')
  },

  throwBall(point) {
    const camPos = new THREE.Vector3()
    this.camera.object3D.getWorldPosition(camPos)

    const dir = point.clone().sub(camPos).normalize()
    const spawn = camPos.clone().addScaledVector(dir, 0.5)
    spawn.y = Math.max(spawn.y - 0.15, BALL.radius + 0.02)

    const el = document.createElement('a-sphere')
    el.setAttribute('class', 'cantap')
    el.setAttribute('position', `${spawn.x} ${spawn.y} ${spawn.z}`)
    el.setAttribute('material', `color: ${BALL.color}; roughness: 0.35; metalness: 0.05`)
    el.setAttribute('shadow', '')
    el.setAttribute('phys-body', `
      shape: sphere; radius: ${BALL.radius}; mass: ${BALL.mass}; material: ball`)
    this.el.sceneEl.appendChild(el)

    // The body exists once the entity has loaded; then it flies.
    el.addEventListener('loaded', () => {
      const body = el.components['phys-body'].body
      body.velocity.set(dir.x * BALL.speed, dir.y * BALL.speed, dir.z * BALL.speed)
      body.angularVelocity.set(
        (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6)
    })

    this.balls.push(el)
    while (this.balls.length > BALL.max) {
      const oldest = this.balls.shift()
      if (oldest.parentNode) oldest.parentNode.removeChild(oldest)
    }
  },

  reset() {
    for (const el of [...this.bricks, ...this.balls]) {
      if (el.parentNode) el.parentNode.removeChild(el)
    }
    this.bricks = []
    this.origins = []
    this.balls = []
    this.placed = false
    this.razed = false
    this.lastCount = -1

    this.setPrompt('Tap the floor to place the tower')
    this.updateScore(0)
  },

  setPrompt(text) {
    this.prompt.textContent = text
    this.prompt.style.opacity = '1'
  },

  updateScore(down) {
    this.score.textContent = `Down ${down} / ${towerLayout().length}`
  },

  tick(time) {
    if (!this.placed || this.razed || time < this.nextCountAt) return
    this.nextCountAt = time + 300

    let down = 0
    for (let i = 0; i < this.bricks.length; i++) {
      const body = this.bricks[i].components['phys-body'] && this.bricks[i].components['phys-body'].body
      if (!body) continue
      let origin = this.origins[i]
      if (!origin) origin = this.origins[i] = body.position.clone()
      const p = body.position
      const dx = p.x - origin.x
      const dy = p.y - origin.y
      const dz = p.z - origin.z

      let knocked = dx * dx + dy * dy + dz * dz > KNOCK_DISTANCE_SQ
      if (!knocked) {
        const up = body.quaternion.vmult(UP) // brick's local up in world space
        knocked = up.y < KNOCK_TILT
      }
      if (knocked) down++
    }

    if (down !== this.lastCount) {
      this.lastCount = down
      this.updateScore(down)
    }
    if (down === this.bricks.length) {
      this.razed = true
      this.setPrompt('Tower down! Reset to build again')
    }
  },
}
