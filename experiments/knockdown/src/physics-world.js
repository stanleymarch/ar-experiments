// physics-world.js — a thin bridge between A-Frame and cannon-es.
//
// The scene-level `physics-world` component owns a CANNON.World, steps it on
// the scene tick, and mirrors every registered body's transform onto its
// entity's object3D. Bodies belong to entities placed directly under
// <a-scene>, so object3D transforms are world transforms and no
// local-to-world bookkeeping is needed.

import * as CANNON from 'cannon-es'

// Tuned so the brick tower sleeps quietly until a ball hits it.
export function makeWorld() {
  const world = new CANNON.World({gravity: new CANNON.Vec3(0, -9.82, 0)})
  world.broadphase = new CANNON.SAPBroadphase(world)
  world.allowSleep = true
  world.solver.iterations = 12

  const materials = {
    ground: new CANNON.Material('ground'),
    brick: new CANNON.Material('brick'),
    ball: new CANNON.Material('ball'),
  }

  const contact = (a, b, friction, restitution) =>
    world.addContactMaterial(new CANNON.ContactMaterial(a, b, {friction, restitution}))

  contact(materials.brick, materials.brick, 0.6, 0.01)  // the stack stays put
  contact(materials.brick, materials.ground, 0.55, 0.05) // bricks settle, don't skate
  contact(materials.ball, materials.ground, 0.35, 0.55) // balls bounce and roll
  contact(materials.ball, materials.brick, 0.3, 0.3)    // satisfying impacts

  world.defaultContactMaterial.friction = 0.4
  world.defaultContactMaterial.restitution = 0.15
  world.userData = {materials}
  return world
}

export const physicsWorldComponent = {
  init() {
    this.world = makeWorld()

    // Static floor matching the visual shadow-catcher ground (its top face
    // sits at y = 0; physics and pixels agree on where the real floor is).
    const floor = new CANNON.Body({
      shape: new CANNON.Plane(),
      material: this.world.userData.materials.ground,
    })
    floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0)
    this.world.addBody(floor)

    this.bodies = []
  },

  register(el, body) {
    this.world.addBody(body)
    this.bodies.push({el, body})
  },

  unregister(body) {
    this.world.removeBody(body)
    this.bodies = this.bodies.filter((entry) => entry.body !== body)
  },

  material(name) {
    return this.world.userData.materials[name]
  },

  tick(_time, timeDelta) {
    const dt = Math.min(timeDelta / 1000, 0.05)
    this.world.step(1 / 120, dt, 10)
    for (const {el, body} of this.bodies) {
      if (body.sleepState === CANNON.Body.SLEEPING) continue
      el.object3D.position.copy(body.position)
      el.object3D.quaternion.copy(body.quaternion)
    }
  },
}
