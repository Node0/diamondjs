/**
 * Acceptance app (Lifecycle Contract §10.5). Hand-written components — one
 * per scenario — mirroring the shapes the record inventories from Turbine:
 * focus on appear, scroll restore, geometry in mounted(), an
 * IntersectionObserver rooted at a scroller, a root-level structural with a
 * hash target, a child whose mounted() throws, in-flight callbacks that
 * outlive a page, and three pages cycled for leaks.
 */
import { Component, DiamondCore, Router } from '@diamondjs/runtime'
import { addSink } from '@diamondjs/primafacie'

const logs = []
addSink((r) => logs.push({ logType: r.logType, message: r.message }))

// Listener counter (A-9).
let listeners = 0
const add = EventTarget.prototype.addEventListener
const remove = EventTarget.prototype.removeEventListener
EventTarget.prototype.addEventListener = function (...a) { listeners++; return add.apply(this, a) }
EventTarget.prototype.removeEventListener = function (...a) { listeners--; return remove.apply(this, a) }

const el = (tag, props = {}, ...children) => {
  const e = document.createElement(tag)
  Object.assign(e, props)
  e.append(...children)
  return e
}
const ifRoot = (when, make) => {
  const anchor = document.createComment('if')
  DiamondCore.if(anchor, [{ when, make }])
  return anchor
}

class HomePage extends Component {
  createTemplate() { return el('div', { className: 'home', textContent: 'home' }) }
}

// A-1: a child three levels deep, under a root-level if, focuses in mounted().
class Leaf extends Component {
  createTemplate() { this.knob = el('button', { className: 'knob', textContent: 'knob' }); return el('div', {}, this.knob) }
  mounted() { this.knob.focus() }
}
class Mid extends Component {
  createTemplate() { const host = el('section'); DiamondCore.child(new Leaf(), host); return el('div', {}, host) }
}
class KnobPage extends Component {
  constructor() { super(); this.state = DiamondCore.reactive({ show: true }) }
  createTemplate() {
    return ifRoot(() => this.state.show, () => { const host = el('div', { className: 'knob-host' }); DiamondCore.child(new Mid(), host); return host })
  }
}

// A-2: scrollTop restored in mounted() during a route commit.
class ScrollPage extends Component {
  createTemplate() { this.scroller = el('div', { className: 'scroller' }, el('div', { className: 'tall' })); return this.scroller }
  mounted() { this.scroller.scrollTop = 250 }
}

// A-3 / A-4: geometry read in mounted(), under a visible and a display:none parent.
class Slider extends Component {
  createTemplate() { this.track = el('div', { className: 'track' }); return this.track }
  mounted() { window.__measure = this.track.clientWidth }
}
class MeasurePage extends Component {
  createTemplate() { const h = el('div'); DiamondCore.child(new Slider(), h); return h }
}
class HiddenPage extends Component {
  createTemplate() { const h = el('div', { className: 'hidden' }); DiamondCore.child(new Slider(), h); return h }
}

// A-5: an IntersectionObserver rooted at the component's own scroller, created in mounted().
class Viewer extends Component {
  createTemplate() {
    this.list = el('div', { className: 'list' })
    this.sentinel = el('div', { className: 'sentinel' })
    this.scroller = el('div', { className: 'scroller viewer' }, this.list, this.sentinel)
    return this.scroller
  }
  mounted() {
    this.observer = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) this.renderBatch() },
      { root: this.scroller }
    )
    this.observer.observe(this.sentinel)
    this.registerCleanup(() => this.observer.disconnect())
  }
  renderBatch() {
    for (let i = 0; i < 20; i++) this.list.append(el('p', { textContent: `row ${this.list.children.length}` }))
  }
}
class ViewerPage extends Component {
  createTemplate() { const h = el('div'); DiamondCore.child(new Viewer(), h); return h }
}

// A-6: a page whose template root is a structural, with a hash target far down.
class AboutPage extends Component {
  constructor() { super(); this.state = DiamondCore.reactive({ ready: true }) }
  createTemplate() {
    return ifRoot(() => this.state.ready, () =>
      el('div', { className: 'about' }, el('div', { className: 'spacer' }), el('h2', { id: 'x', textContent: 'target' }))
    )
  }
}

// A-7: a child whose mounted() throws, under a structural on a live page.
class BoomChild extends Component {
  createTemplate() { return el('div', { className: 'boom-child', textContent: 'should be gone' }) }
  mounted() { throw new Error('child mounted boom') }
}
class BoomPage extends Component {
  constructor() { super(); this.state = DiamondCore.reactive({ show: true, clicks: 0 }) }
  createTemplate() {
    const btn = el('button', { className: 'clicker' })
    DiamondCore.bind(btn, 'textContent', () => `clicks ${this.state.clicks}`)
    DiamondCore.on(btn, 'click', () => this.state.clicks++)
    const anchor = document.createComment('if')
    const root = el('div', {}, btn, anchor)
    DiamondCore.if(anchor, [{ when: () => this.state.show, make: () => { const h = el('div', { className: 'branch' }); DiamondCore.child(new BoomChild(), h); return h } }])
    return root
  }
}

// A-8: an in-flight rAF and fetch bound to the mount generation.
window.__afterUnmount = { raf: 0, fetch: 0 }
class InflightPage extends Component {
  createTemplate() { return el('div', { className: 'inflight', textContent: 'inflight' }) }
  mounted() {
    requestAnimationFrame(this.whileMounted(() => { window.__afterUnmount.raf++ }))
    fetch('/slow').then(this.whileMounted(() => { window.__afterUnmount.fetch++ }))
  }
}

// A-9: three pages with bindings, listeners, structurals, a debounce and a child, cycled for leaks.
class Row extends Component {
  constructor(label) { super(); this.label = label }
  createTemplate() { const b = el('button'); DiamondCore.bind(b, 'textContent', () => this.label); DiamondCore.on(b, 'click', () => {}); return b }
}
const cyclePage = (name) => class CyclePage extends Component {
  constructor() {
    super()
    window.app.refs.push(new WeakRef(this)) // instance census (A-9): collected instances deref to undefined
    this.state = DiamondCore.reactive({ items: Array.from({ length: 50 }, (_, i) => ({ id: i })), on: true, text: name })
    this.ping = this.debounce(() => { this.state.text = `${name}!` }, 50)
  }
  createTemplate() {
    const root = el('div', { className: `cycle ${name}` })
    const h = el('h1'); DiamondCore.bind(h, 'textContent', () => this.state.text); DiamondCore.on(h, 'click', () => this.ping())
    const list = el('ul'); const ra = document.createComment('repeat'); list.append(ra)
    DiamondCore.repeat(ra, () => this.state.items, (item) => { const li = el('li', { textContent: String(item.id) }); const host = el('span'); DiamondCore.child(new Row(`r${item.id}`), host); li.append(host); return li })
    const ia = document.createComment('if'); root.append(h, list, ia)
    DiamondCore.if(ia, [{ when: () => this.state.on, make: () => el('p', { textContent: 'on' }) }])
    return root
  }
  mounted() { this.registerCleanup(DiamondCore.effect(() => { void this.state.text })) }
}

// A-10: a cleanup that throws on departure faults the instance.
class FaultyPage extends Component {
  constructed() { window.app.faulty = this }
  createTemplate() {
    this.registerCleanup(() => { throw new Error('cleanup boom') })
    return el('div', { className: 'faulty', textContent: 'faulty' })
  }
}

const routes = {
  home: { path: '', component: HomePage, outlet: 'main' },
  knob: { path: 'knob', component: KnobPage, outlet: 'main' },
  scroll: { path: 'scroll', component: ScrollPage, outlet: 'main' },
  measure: { path: 'measure', component: MeasurePage, outlet: 'main' },
  hidden: { path: 'hidden', component: HiddenPage, outlet: 'main' },
  viewer: { path: 'viewer', component: ViewerPage, outlet: 'main' },
  about: { path: 'about', component: AboutPage, outlet: 'main' },
  boom: { path: 'boom', component: BoomPage, outlet: 'main' },
  inflight: { path: 'inflight', component: InflightPage, outlet: 'main' },
  p1: { path: 'p1', component: cyclePage('p1'), outlet: 'main' },
  p2: { path: 'p2', component: cyclePage('p2'), outlet: 'main' },
  p3: { path: 'p3', component: cyclePage('p3'), outlet: 'main' },
  faulty: { path: 'faulty', component: FaultyPage, outlet: 'main' },
  'not-found': { path: '*', component: HomePage, outlet: 'main' },
}

const outlet = document.createElement('outlet')
outlet.setAttribute('name', 'main')
document.body.prepend(outlet)
const router = new Router(routes)
window.app = { router, logs, listeners: () => listeners, faulty: null, refs: [] }
await router.start()
window.app.ready = true
