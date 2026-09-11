// sea-battle.js — «Морской бой»: советский перископный автомат в AR.
//
// Прототип — электромеханический автомат «Морской бой» (Серпуховский
// радиотехнический завод, 1974): игрок смотрит в перископ, корабли ходят
// по морю на цепи слева-направо, поворотом перископа выбирается одна из
// восьми трасс торпеды, кнопка «Пуск» на рукоятке запускает «торпеду» —
// бегущий огонёк лампочек. Попадание — вспышка, «ТОРПЕДИРОВАНО», счёт.
// Игра: 15 коп. = 10 пусков; 10 из 10 — призовая игра.
//
// AR-переложение: тап по полу опускает «акваторию» в реальный мир — тёмное
// море с волнами, корабли ходят по трём дальностям, как на цепи. Тап по
// морю — пуск торпеды: из точки у игрока по поверхности бежит зелёный
// трассер с хвостом «лампочек». Наводить нужно с упреждением — корабли
// движутся. Сцена в SLAM-мире XR8 (`scale: absolute`, 1 unit = 1 метр),
// реальный пол — плоскость y = 0.

// --- Параметры боя (в локальных координатах акватории) ---------------------
const SEA = {
  width: 1.8,        // ширина моря по X
  nearZ: 0.9,        // ближний край (к игроку)
  farZ: -1.5,        // дальний край (горизонт)
  lanes: [
    {z: 0.15, speed: 0.11, dir: 1, ships: ['small', 'small', 'big']},
    {z: -0.30, speed: 0.075, dir: -1, ships: ['mid', 'mid', 'small']},
    {z: -0.75, speed: 0.05, dir: 1, ships: ['big', 'mid']},
  ],
}

const SHIP_TYPES = {
  big: {decks: 3, name: 'ЛИДЕР'},
  mid: {decks: 2, name: 'СТРЕЛА'},
  small: {decks: 1, name: 'КАТЕР'},
}

const TORPEDO = {
  speed: 0.55,       // м/с по поверхности
  radius: 0.02,      // допуск попадания (расширение AABB корпуса)
  trailEvery: 90,    // мс между «лампочками» хвоста
  maxRun: 6,         // с: страховка от вечного бегуна
}

const LAUNCHES = 10  // пусков за игру — как за 15 копеек
const PRIZE_LAUNCHES = 3

// --- Звук: WebAudio-«пьезодинамик» автомата ---------------------------------
function makeBeeper() {
  const Ctx = window.AudioContext || window.webkitAudioContext
  const ctx = Ctx ? new Ctx() : null
  return {
    resume() { if (ctx && ctx.state === 'suspended') ctx.resume() },
    tone(freq, dur, type = 'square', gain = 0.12) {
      if (!ctx) return
      const osc = ctx.createOscillator()
      const amp = ctx.createGain()
      osc.type = type
      osc.frequency.value = freq
      amp.gain.setValueAtTime(gain, ctx.currentTime)
      amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur)
      osc.connect(amp).connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + dur)
    },
    launch() { this.tone(520, 0.08); this.tone(660, 0.1, 'square', 0.08) },
    expire() { this.tone(240, 0.14, 'triangle', 0.07) },
    hit() { this.tone(110, 0.35, 'square', 0.16); this.tone(55, 0.5, 'sawtooth', 0.1) },
    sink() { [392, 330, 262, 196].forEach((f, i) =>
      setTimeout(() => this.tone(f, 0.16, 'square', 0.12), i * 110)) },
    prize() { [523, 659, 784, 1047, 1319].forEach((f, i) =>
      setTimeout(() => this.tone(f, 0.16, 'square', 0.12), i * 120)) },
    over() { [330, 262, 220, 175].forEach((f, i) =>
      setTimeout(() => this.tone(f, 0.22, 'sawtooth', 0.1), i * 170)) },
  }
}

export const seaBattleComponent = {
  init() {
    this.camera = document.getElementById('camera')
    this.ground = document.getElementById('ground')
    this.prompt = document.getElementById('promptText')
    this.hint = document.getElementById('hint')
    this.torpsLabel = document.getElementById('torpsLabel')
    this.hitsLabel = document.getElementById('hitsLabel')
    this.resetBtn = document.getElementById('resetBtn')
    this.torpedoed = document.getElementById('torpedoed')
    this.gameOver = document.getElementById('gameOver')
    this.overSub = document.getElementById('overSub')
    this.prizeFlash = document.getElementById('prizeFlash')

    this.raycaster = new THREE.Raycaster()
    this.root = null
    this.shipEls = []     // a-entity с ship-hull
    this.torpedoes = []   // {el, vel(THREE.Vector3), born, lastTrail}
    this.fx = []
    this.placed = false
    this.over = false
    this.prizeMode = false
    this.launched = 0
    this.hits = 0
    this.beeper = makeBeeper()

    const canvas = this.el.sceneEl.canvas
    if (canvas) {
      canvas.addEventListener('pointerup', (e) => this.onTap(e))
    } else {
      this.el.sceneEl.addEventListener('loaded', () => {
        this.el.sceneEl.canvas.addEventListener('pointerup', (e) => this.onTap(e))
      }, {once: true})
    }
    this.resetBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      this.reset()
    })

    this.updateHud()
  },

  onTap(event) {
    this.beeper.resume()
    if (this.over) {
      this.reset()
      return
    }
    const point = this.raycastSea(event)
    if (!this.placed) {
      if (point) this.deploySea(point)
      return
    }
    if (point && this.launched < this.totalLaunches()) this.launchTorpedo(point)
  },

  // Мировая точка тапа: луч из трекаемой камеры в пол или в корабли.
  raycastSea(event) {
    const camera = this.el.sceneEl.camera
    if (!camera) return null
    const rect = event.target.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -(((event.clientY - rect.top) / rect.height) * 2 - 1))
    this.raycaster.setFromCamera(ndc, camera)
    const objects = [this.ground.object3D,
      ...this.shipEls.map((el) => el.object3D)]
    const hit = this.raycaster.intersectObjects(objects, true)[0]
    return hit ? hit.point.clone() : null
  },

  totalLaunches() {
    return LAUNCHES + (this.prizeMode ? PRIZE_LAUNCHES : 0)
  },

  // --- Развертывание акватории ------------------------------------------------
  deploySea(point) {
    const camPos = new THREE.Vector3()
    this.camera.object3D.getWorldPosition(camPos)
    const yaw = Math.atan2(camPos.x - point.x, camPos.z - point.z) * 180 / Math.PI

    this.root = document.createElement('a-entity')
    this.root.setAttribute('position', `${point.x} 0 ${point.z}`)
    this.root.setAttribute('rotation', `0 ${yaw} 0`)
    this.el.sceneEl.appendChild(this.root)

    this.buildSea()

    // «Опустили монету» — корабли сразу пошли, как на цепи автомата.
    this.shipEls = []
    for (const lane of SEA.lanes) this.populateLane(lane)

    this.placed = true
    this.prompt.classList.add('hidden')
    this.hint.classList.remove('hidden')
  },

  buildSea() {
    const depth = SEA.nearZ - SEA.farZ
    const centerZ = (SEA.nearZ + SEA.farZ) / 2

    // Мягкая процедурная поверхность: без прямоугольной кромки и без
    // z-fighting с shadow-plane реального пола.
    const water = document.createElement('a-entity')
    water.setAttribute('position', `0 0.025 ${centerZ}`)
    water.setAttribute('sea-surface', `width: ${SEA.width}; depth: ${depth}`)
    this.root.appendChild(water)
  },

  // Корабли «на цепи»: по слоту на lanes.ships, равномерно по ширине моря.
  populateLane(lane) {
    const n = lane.ships.length
    lane.ships.forEach((type, i) => {
      const x = -SEA.width / 2 + (i + 0.5) * SEA.width / n
      this.spawnShip(SHIP_TYPES[type], x, lane)
    })
  },

  spawnShip(spec, x, lane) {
    const el = document.createElement('a-entity')
    el.setAttribute('position', `${x} 0 ${lane.z}`)
    // A-Frame применяет атрибут position асинхронно, а tick уже двигает
    // object3D — выставляем обе точки сразу, чтобы не было скачка.
    el.object3D.position.set(x, 0, lane.z)
    // +X — нос; корабль смотрит по ходу движения.
    el.setAttribute('rotation', `0 ${lane.dir > 0 ? 0 : 180} 0`)
    el.setAttribute('ship-hull', `decks: ${spec.decks}; name: ${spec.name}`)
    el.classList.add('ship')
    this.root.appendChild(el)
    el.addEventListener('loaded', () => { el.dataset.laneZ = lane.z })
    this.shipEls.push(el)
    return el
  },

  // --- Пуск торпеды -------------------------------------------------------------
  // Трасса: от точки у игрока (ближний край, центр) по поверхности к курсу,
  // заданному тапом. Наводиться нужно с упреждением — корабли идут.
  launchTorpedo(targetWorld) {
    this.launched++
    this.updateHud()
    this.beeper.launch()

    const local = this.root.object3D.worldToLocal(targetWorld.clone())
    const origin = new THREE.Vector3(0, 0.015, SEA.nearZ - 0.05)
    const dir = new THREE.Vector3(local.x, 0, local.z).sub(
      new THREE.Vector3(origin.x, 0, origin.z))
    // Тап «за спину» не разворачивает торпеду: ведём вперёд по Z.
    if (dir.z > -0.05) dir.z = -0.05
    dir.normalize()

    const el = document.createElement('a-entity')
    el.setAttribute('position', `${origin.x} ${origin.y} ${origin.z}`)
    // Тот же синхронный старт: первый tick идёт из точки пуска, не из нуля.
    el.object3D.position.copy(origin)
    // Цилиндр-трассер лежит по X; доворачиваем на курс.
    const heading = Math.atan2(dir.z, dir.x)
    el.setAttribute('torpedo', '')
    el.setAttribute('rotation', `0 ${-heading * 180 / Math.PI} 0`)
    this.root.appendChild(el)

    this.torpedoes.push({
      el,
      vel: dir.multiplyScalar(TORPEDO.speed),
      born: performance.now(),
      lastTrail: 0,
    })
  },

  // --- Эффекты -------------------------------------------------------------------
  trailDotAt(localPos) {
    const el = document.createElement('a-sphere')
    el.setAttribute('radius', '0.006')
    el.setAttribute('position', `${localPos.x} 0.008 ${localPos.z}`)
    el.setAttribute('material', `
      color: #7dff9a; emissive: #3dff70; emissiveIntensity: 1.6;
      transparent: true; opacity: 0.95`)
    el.setAttribute('animation__fade', `
      property: material.opacity; from: 0.95; to: 0; dur: 1100; easing: easeInQuad`)
    this.root.appendChild(el)
    this.fx.push({el, until: performance.now() + 1150})
  },

  splashAt(localPos) {
    const el = document.createElement('a-entity')
    el.setAttribute('position', `${localPos.x} 0.005 ${localPos.z}`)
    el.setAttribute('splash-fx', '')
    this.root.appendChild(el)
    this.fx.push({el, until: performance.now() + 800})
  },

  explosionAt(localPos) {
    const el = document.createElement('a-entity')
    el.setAttribute('position', `${localPos.x} 0.04 ${localPos.z}`)
    el.setAttribute('explosion-fx', '')
    this.root.appendChild(el)
    this.fx.push({el, until: performance.now() + 1000})
  },

  flashTorpedoed() {
    this.torpedoed.classList.remove('hidden')
    clearTimeout(this._torpTimer)
    this._torpTimer = setTimeout(() => this.torpedoed.classList.add('hidden'), 1400)
  },

  // --- Попадания --------------------------------------------------------------------
  hitShipAt(localPos) {
    const world = this.root.object3D.localToWorld(localPos.clone())
    for (const el of this.shipEls) {
      if (el.isSunk || !el.object3D) continue
      const box = new THREE.Box3().setFromObject(el.object3D)
      box.expandByScalar(TORPEDO.radius)
      if (box.containsPoint(world)) return el
    }
    return null
  },

  sinkShip(el) {
    el.isSunk = true
    el.addState('sunk')
    this.beeper.sink()
    this.hits++
    this.updateHud()
    this.flashTorpedoed()

    // Цепь не останавливается: через паузу на место погибшего приходит новый.
    setTimeout(() => {
      if (!this.root) return
      const pos = el.object3D.position
      const typeKeys = Object.keys(SHIP_TYPES)
      const spec = SHIP_TYPES[typeKeys[Math.floor(Math.random() * typeKeys.length)]]
      const laneZ = pos.z
      const lane = SEA.lanes.reduce((best, l) =>
        Math.abs(l.z - laneZ) < Math.abs(best.z - laneZ) ? l : best)
      const entryX = lane.dir > 0 ? -SEA.width / 2 - 0.05 : SEA.width / 2 + 0.05
      const i = this.shipEls.indexOf(el)
      if (i >= 0) this.shipEls.splice(i, 1)
      if (el.parentNode) el.parentNode.removeChild(el)
      if (!this.over) this.spawnShip(spec, entryX, lane)
    }, 2500)
  },

  finish() {
    this.over = true
    this.hint.classList.add('hidden')
    this.overSub.textContent = `Поражено кораблей: ${this.hits}`
    this.gameOver.classList.remove('hidden')
    this.beeper.over()
  },

  // Приз: 10 попаданий из 10 пусков — как в автомате за чистую работу.
  maybePrize() {
    if (this.prizeMode || this.over) return false
    if (this.launched >= LAUNCHES && this.hits >= LAUNCHES) {
      this.prizeMode = true
      this.prizeFlash.classList.remove('hidden')
      setTimeout(() => this.prizeFlash.classList.add('hidden'), 2200)
      this.beeper.prize()
      return true
    }
    return false
  },

  reset() {
    for (const t of this.torpedoes) {
      if (t.el.parentNode) t.el.parentNode.removeChild(t.el)
    }
    for (const f of this.fx) {
      if (f.el.parentNode) f.el.parentNode.removeChild(f.el)
    }
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root)
    this.torpedoes = []
    this.fx = []
    this.shipEls = []
    this.root = null
    this.placed = false
    this.over = false
    this.prizeMode = false
    this.launched = 0
    this.hits = 0
    this.gameOver.classList.add('hidden')
    this.prizeFlash.classList.add('hidden')
    this.torpedoed.classList.add('hidden')
    this.hint.classList.add('hidden')
    this.prompt.classList.remove('hidden')
    this.updateHud()
  },

  updateHud() {
    const left = Math.max(this.totalLaunches() - this.launched, 0)
    this.torpsLabel.textContent = 'ТОРПЕДЫ ' + left
    this.hitsLabel.textContent = 'ПОРАЖЕНО ' + this.hits
  },

  tick(time, deltaMs) {
    if (!this.placed) return
    const dt = Math.min(deltaMs, 100) / 1000
    const now = performance.now()

    // Корабли «на цепи»: равномерно по своей линии, выход за край — вход
    // с противоположной стороны, как замкнутая цепь автомата.
    for (const el of this.shipEls) {
      if (el.isSunk) continue
      const laneZ = el.object3D.position.z
      const lane = SEA.lanes.reduce((best, l) =>
        Math.abs(l.z - laneZ) < Math.abs(best.z - laneZ) ? l : best)
      const p = el.object3D.position
      p.x += lane.speed * lane.dir * dt
      if (lane.dir > 0 && p.x > SEA.width / 2 + 0.05) p.x = -SEA.width / 2 - 0.05
      if (lane.dir < 0 && p.x < -SEA.width / 2 - 0.05) p.x = SEA.width / 2 + 0.05
    }

    // Торпеды: бег по поверхности, хвост «лампочек», попадание/расход.
    for (let i = this.torpedoes.length - 1; i >= 0; i--) {
      const t = this.torpedoes[i]
      const p = t.el.object3D.position
      p.addScaledVector(t.vel, dt)

      if (now - t.lastTrail > TORPEDO.trailEvery) {
        t.lastTrail = now
        this.trailDotAt(p)
      }

      const ship = this.hitShipAt(p)
      if (ship) {
        this.explosionAt(p)
        this.beeper.hit()
        this.sinkShip(ship)
        if (t.el.parentNode) t.el.parentNode.removeChild(t.el)
        this.torpedoes.splice(i, 1)
        continue
      }

      // Дальний край или бок моря — трасса погасла.
      if (p.z < SEA.farZ || Math.abs(p.x) > SEA.width / 2 + 0.1 ||
          now - t.born > TORPEDO.maxRun * 1000) {
        this.splashAt(p)
        this.beeper.expire()
        if (t.el.parentNode) t.el.parentNode.removeChild(t.el)
        this.torpedoes.splice(i, 1)
      }
    }

    // Чистка эффектов.
    for (let i = this.fx.length - 1; i >= 0; i--) {
      if (now > this.fx[i].until) {
        const el = this.fx[i].el
        if (el.parentNode) el.parentNode.removeChild(el)
        this.fx.splice(i, 1)
      }
    }

    // Конец игры: пуски исчерпаны, торпеды в воде закончились, приза нет.
    if (!this.over && this.torpedoes.length === 0) {
      if (this.launched >= this.totalLaunches()) {
        if (!this.maybePrize()) this.finish()
      }
    }
  },
}
