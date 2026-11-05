import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { runInNewContext } from "node:vm"

const client = await readFile(new URL("../client.js", import.meta.url), "utf8")

// React and the browser are external boundaries; exercise the registered
// component's handlers without claiming this is a rendered browser test.
function mountDuck() {
  const hooks = []
  const effects = []
  const listeners = new Map()
  let hookIndex = 0
  let mounted = false
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children }, children }),
    useState(initial) {
      const index = hookIndex++
      if (!mounted) hooks[index] = initial
      return [hooks[index], next => { hooks[index] = typeof next === "function" ? next(hooks[index]) : next }]
    },
    useRef(current) {
      const index = hookIndex++
      if (!mounted) hooks[index] = { current }
      return hooks[index]
    },
    useEffect: effect => { if (!mounted) effects.push(effect) },
  }
  const browser = {
    innerWidth: 800,
    innerHeight: 600,
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: name => listeners.delete(name),
    __ModuleLoader__: {
      load(module) {
        module.factory(name => {
          assert.equal(name, "react")
          return react
        }).apply({ slots: {
          inject: (_name, register) => register(),
          register: (_options, Component) => { duckComponent = Component },
        } })
      },
    },
  }
  let duckComponent
  runInNewContext(client, { window: browser })
  // The drag implementation measures the visible fixed wrapper via its bounds.
  const element = {
    getBoundingClientRect: () => ({ left: 100, top: 150, width: 88, height: 102 }),
  }
  function duckProps() {
    hookIndex = 0
    const tree = duckComponent()
    const overlay = tree.children.find(child => child.props?.role === "group")
    overlay.props.ref.current = element
    return overlay.props
  }
  duckProps()
  mounted = true
  const cleanup = effects.map(effect => effect())
  return {
    duckProps,
    listeners,
    start(overrides = {}) {
      duckProps().onPointerDown({
        button: 0, pointerId: 1, clientX: 120, clientY: 180,
        currentTarget: element, preventDefault() {}, ...overrides,
      })
    },
    emit(name, overrides = {}) {
      listeners.get(name)({ pointerId: 1, buttons: 1, clientX: 320, clientY: 380, ...overrides })
    },
    resize(width, height) {
      browser.innerWidth = width
      browser.innerHeight = height
      listeners.get("resize")()
    },
    unmount: () => cleanup.forEach(dispose => dispose()),
  }
}

const duck = mountDuck()
const sprite = duck.duckProps().children.find(child => child.type === "img")
const png = await readFile(new URL("../assets/donald-duck.png", import.meta.url))
assert.equal(sprite.props.src, `data:image/png;base64,${png.toString("base64")}`, "overlay must use the selected PNG bytes")
assert.equal(sprite.props.draggable, false, "native image dragging must not replace pointer dragging")
assert.ok(sprite.props.className.includes("donald-duck-bob"), "sprite must retain hovering")
const position = () => {
  const { left, top } = duck.duckProps().style
  return [Number.parseFloat(left), Number.parseFloat(top)]
}

duck.start({ button: 2 })
assert.equal(duck.duckProps().style, undefined, "right click must not start dragging")
duck.start()
assert.deepEqual(position(), [100, 150], "grabbing must preserve the current position")
duck.emit("pointermove")
assert.deepEqual(position(), [300, 350], "Dragging must produce finite coordinates and preserve the grab offset")
duck.emit("pointermove", { pointerId: 2 })
assert.deepEqual(position(), [300, 350], "another pointer must not move the duck")
duck.start({ pointerId: 2, clientX: 500, clientY: 500 })
duck.emit("pointermove")
assert.deepEqual(position(), [300, 350], "a second pointerdown must not steal an active drag")

for (const [clientX, clientY, expected] of [
  [-100, -100, [0, 0]],
  [900, 700, [712, 498]],
]) {
  duck.emit("pointermove", { clientX, clientY })
  assert.deepEqual(position(), expected, "drag must keep the entire duck within the window")
}

for (const endEvent of ["pointerup", "pointercancel", "blur"]) {
  duck.start()
  duck.emit("pointermove")
  duck.emit(endEvent)
  duck.emit("pointermove", { clientX: 500, clientY: 500 })
  assert.deepEqual(position(), [300, 350], `${endEvent} must end dragging`)
  assert.ok(!duck.duckProps().className.includes("is-dragging"))
}

duck.start()
duck.emit("pointermove")
duck.emit("pointermove", { buttons: 0, clientX: 500, clientY: 500 })
assert.deepEqual(position(), [300, 350], "returning after release outside the window must not move the duck")
assert.ok(!duck.duckProps().className.includes("is-dragging"))

duck.resize(400, 300)
assert.deepEqual(position(), [300, 198], "shrinking the window must bring a placed duck back into view")
duck.resize(40, 40)
assert.deepEqual(position(), [0, 0], "a window smaller than the sprite must not produce negative coordinates")
duck.resize(800, 600)
assert.deepEqual(position(), [0, 0], "growing the window must not move an already visible duck")
assert.equal(duck.duckProps().tabIndex, 0, "the duck must be reachable by keyboard")

for (const [key, shiftKey, expected] of [
  ["ArrowLeft", false, [90, 150]],
  ["ArrowRight", false, [110, 150]],
  ["ArrowUp", false, [100, 140]],
  ["ArrowDown", true, [100, 180]],
]) {
  let prevented = false
  duck.duckProps().onKeyDown({ key, shiftKey, preventDefault() { prevented = true } })
  assert.deepEqual(position(), expected, "arrow keys must move relative to the displayed browser bounds")
  assert.equal(prevented, true, "movement keys must not scroll the page")
}

duck.resize(100, 100)
duck.duckProps().onKeyDown({ key: "ArrowRight", preventDefault() {} })
assert.deepEqual(position(), [12, 0], "keyboard movement must stay within viewport bounds")
duck.duckProps().onKeyDown({ key: "Tab", preventDefault() { assert.fail("Tab must retain normal focus navigation") } })
assert.deepEqual(position(), [12, 0], "non-movement keys must leave placement unchanged")
duck.unmount()
assert.equal(duck.listeners.size, 0, "unmount must remove window listeners")
console.log("Donald Duck sprite interaction regression checks passed.")
