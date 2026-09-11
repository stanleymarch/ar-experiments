// fx.js — торпеда-трассер, всплеск, взрыв.
//
// Торпеда — оммаж «восьми трассам» автомата: зелёный светящийся беглец
// по поверхности воды с хвостом гаснущих «лампочек» (ими управляет
// sea-battle.js, здесь — только корпус трассера).

export const torpedoComponent = {
  init() {
    const body = document.createElement('a-cylinder')
    body.setAttribute('radius', '0.008')
    body.setAttribute('height', '0.07')
    // Цилиндр по умолчанию стоит по Y; кладём его вдоль X — по курсу.
    body.setAttribute('rotation', '0 0 -90')
    body.setAttribute('material', `
      color: #7dff9a; emissive: #3dff70; emissiveIntensity: 1.8;
      transparent: true; opacity: 0.95`)
    this.el.appendChild(body)

    const glow = document.createElement('a-sphere')
    glow.setAttribute('radius', '0.016')
    glow.setAttribute('position', '0 0 0')
    glow.setAttribute('material', `
      color: #3dff70; emissive: #3dff70; emissiveIntensity: 0.9;
      transparent: true; opacity: 0.35`)
    this.el.appendChild(glow)
  },
}

// Всплеск на излёте трассы: расходящееся кольцо.
export const splashFxComponent = {
  init() {
    const ring = document.createElement('a-ring')
    ring.setAttribute('rotation', '-90 0 0')
    ring.setAttribute('radius-inner', '0.01')
    ring.setAttribute('radius-outer', '0.02')
    ring.setAttribute('material', 'color: #bfe3f5; transparent: true; opacity: 0.9; side: double')
    this.el.appendChild(ring)

    ring.setAttribute('animation__grow', `
      property: scale; from: 0.4 0.4 1; to: 5 5 1; dur: 700; easing: easeOutQuad`)
    ring.setAttribute('animation__fade', `
      property: material.opacity; from: 0.9; to: 0; dur: 700; easing: easeInQuad`)
  },
}

// Взрыв попадания: оранжевая вспышка + чёрный дым.
export const explosionFxComponent = {
  init() {
    const flash = document.createElement('a-sphere')
    flash.setAttribute('radius', '0.03')
    flash.setAttribute('material', 'color: #ff7a1a; transparent: true; opacity: 1; emissive: #ff5500; emissiveIntensity: 2')
    this.el.appendChild(flash)

    const smoke = document.createElement('a-sphere')
    smoke.setAttribute('radius', '0.02')
    smoke.setAttribute('material', 'color: #23262b; transparent: true; opacity: 0.85')
    this.el.appendChild(smoke)

    flash.setAttribute('animation__pop', `
      property: scale; from: 0.5 0.5 0.5; to: 3 3 3; dur: 450; easing: easeOutQuad`)
    flash.setAttribute('animation__fade', `
      property: material.opacity; from: 1; to: 0; dur: 450`)
    smoke.setAttribute('animation__drift', `
      property: position; from: 0 0 0; to: 0 0.12 0; dur: 900; easing: easeOutQuad`)
    smoke.setAttribute('animation__fade', `
      property: material.opacity; from: 0.85; to: 0; dur: 900`)
  },
}
