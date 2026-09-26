import { useEffect, useRef, useState } from 'react'

// The character turns his head towards the cursor.
//
// public/head holds one untouched frame of the original clip, plus how every pixel of his head
// moves at a grid of angles (baked with LivePortrait by tools/build_motion.py). A shader warps the
// frame by that motion, blending the four nearest angles, so any angle in between is continuous,
// sharp, and never doubled. At rest it is the original frame, pixel for pixel.
//
// The eyes are animated on their own: the baked motion is too smooth to carry a pupil. Each eye is
// an "empty" eyeball (eyes.png, iris painted out) with his real iris, cut from the frame, slid
// across it towards the cursor and foreshortened like it's on a ball. The eyes move faster than
// the head, so he glances first and turns after.
//
// He blinks: a lid of his own skin (lids.png) sweeps down over each eye and back up, every few
// seconds, sometimes twice.

const HEAD = './head/'

// Well inside the baked grid (±18° / ±14°). Further than this the quiff folds and the neck
// stretches; the eyes do the rest of the looking.
const MAX_YAW = 12
const MAX_PITCH = 8

// A spring pulls the head towards the cursor. Slightly under critical damping, so it settles with
// a hint of follow-through instead of sliding to a dead stop.
const STIFFNESS = 70
const DAMPING = 14

// The eyes: a much quicker spring, and how far the iris may travel across each eyeball (as a
// share of the eye's radius) before it would tuck out of sight.
const EYE_STIFFNESS = 260
const EYE_DAMPING = 28
const GAZE_X = 0.5
const GAZE_Y = 0.32

// A blink: the lid drops fast, rests a beat, and lifts more slowly. Milliseconds.
const BLINK_CLOSE = 85
const BLINK_HOLD = 40
const BLINK_OPEN = 175
const BLINK_EVERY = [2200, 6000] // random gap between blinks
const DOUBLE_BLINK = 0.18 // chance the next blink follows straight after

// Same framing as the spec's video: object-fit cover, anchored 70% across.
const ANCHOR_X = 0.7
const ANCHOR_Y = 0.5

type Manifest = {
  frame: [number, number]
  region: [number, number, number, number]
  factor: number
  cell: [number, number]
  yaws: number[]
  pitches: number[]
  scales: number[]
  face: [number, number]
  eyes: { white: [number, number, number, number]; iris: [number, number, number, number] }[]
  eyesRect: [number, number, number, number]
}

const VERTEX = `
attribute vec2 aPos;
varying vec2 vPos;
void main() {
  vPos = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5); // 0..1, top-left origin like the frame
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

const FRAGMENT = `
precision highp float;
uniform sampler2D uBase;
uniform sampler2D uMotion;
uniform vec2 uFrame;       // frame size, px
uniform vec4 uRegion;      // x0, y0, x1, y1: where motion is stored, frame px
uniform float uFactor;     // frame px per motion texel
uniform vec2 uCellSize;    // one angle's motion, texels
uniform vec2 uAtlas;       // whole atlas, texels
uniform vec2 uCell00;      // atlas origins of the four nearest angles
uniform vec2 uCell10;
uniform vec2 uCell01;
uniform vec2 uCell11;
uniform vec4 uCellScale;   // frame px per stored unit for each of them
uniform vec2 uFrac;        // how far between them we are
uniform vec2 uCanvas;      // canvas size, device px
uniform float uCoverScale; // device px per frame px
uniform vec2 uCoverOffset; // device px
uniform sampler2D uEmpty;  // both eyeballs with the irises painted out
uniform vec4 uEmptyRect;   // where that texture sits in the frame: x, y, width, height
uniform vec4 uWhite0;      // eye white ellipse: centre x, y, radius x, y (frame px)
uniform vec4 uWhite1;
uniform vec4 uIrisRest0;   // the iris as it is in the frame: centre x, y, radius x, y
uniform vec4 uIrisRest1;
uniform vec2 uIrisNow0;    // where the iris is now
uniform vec2 uIrisNow1;
uniform vec2 uIrisScale0;  // foreshortening now, relative to the frame's
uniform vec2 uIrisScale1;
uniform float uEyesOn;     // 0 = the frame's own eyes, 1 = animated eyes
uniform sampler2D uLids;   // both eyes covered by his skin (same rectangle as uEmpty)
uniform float uBlink;      // 0 open .. 1 closed
varying vec2 vPos;

vec2 motion(vec2 cell, vec2 local, float scale) {
  // Clamp inside the cell so linear filtering never reads the neighbouring angle.
  vec2 texel = cell + clamp(local, vec2(0.5), uCellSize - 0.5);
  return (texture2D(uMotion, texel / uAtlas).rg * 255.0 - 128.0) * scale;
}

vec3 eye(vec3 color, vec2 q, vec4 white, vec4 irisRest, vec2 irisNow, vec2 irisScale) {
  float inside = 1.0 - smoothstep(0.96, 1.0, length((q - white.xy) / white.zw));
  if (inside <= 0.0) return color;
  vec3 empty = texture2D(uEmpty, (q - uEmptyRect.xy) / uEmptyRect.zw).rgb;
  vec2 rel = (q - irisNow) * irisScale; // back into the iris's shape in the frame
  // A little past the iris: the frame is white there too, so the ring keeps its soft edge.
  float a = 1.0 - smoothstep(1.04, 1.18, length(rel / irisRest.zw));
  vec3 iris = texture2D(uBase, (irisRest.xy + rel) / uFrame).rgb;
  return mix(color, mix(empty, iris, a), inside * uEyesOn);
}

vec3 lid(vec3 color, vec2 q, vec4 white) {
  vec2 n = (q - white.xy) / white.zw; // -1..1 across the eye
  float reach = length(n);
  if (reach > 1.12) return color;
  // The lid's edge sweeps from above the eye to below it, bowed down in the middle like a lid
  // sliding over a ball.
  float edge = -1.15 + 2.3 * uBlink + 0.12 * (1.0 - n.x * n.x) * sin(3.14159 * uBlink);
  float covered = 1.0 - smoothstep(edge - 0.04, edge + 0.02, n.y);
  float onEye = 1.0 - smoothstep(1.04, 1.12, reach);
  vec3 skin = texture2D(uLids, (q - uEmptyRect.xy) / uEmptyRect.zw).rgb;
  skin *= 1.0 - 0.28 * exp(-pow((n.y - edge + 0.03) / 0.035, 2.0)); // the crease at the edge
  float shadow = exp(-pow((n.y - edge - 0.06) / 0.09, 2.0)) * (1.0 - covered); // cast on the eye
  color *= 1.0 - 0.22 * shadow * onEye;
  return mix(color, skin, covered * onEye);
}

void main() {
  vec2 src = (vPos * uCanvas - uCoverOffset) / uCoverScale;
  vec2 offset = vec2(0.0);
  if (all(greaterThan(src, uRegion.xy)) && all(lessThan(src, uRegion.zw))) {
    vec2 local = (src - uRegion.xy) / uFactor;
    offset = mix(
      mix(motion(uCell00, local, uCellScale.x), motion(uCell10, local, uCellScale.y), uFrac.x),
      mix(motion(uCell01, local, uCellScale.z), motion(uCell11, local, uCellScale.w), uFrac.x),
      uFrac.y
    );
  }
  vec2 q = src + offset; // where this pixel comes from in the frame
  vec3 color = texture2D(uBase, q / uFrame).rgb;
  if (uEyesOn > 0.0) {
    color = eye(color, q, uWhite0, uIrisRest0, uIrisNow0, uIrisScale0);
    color = eye(color, q, uWhite1, uIrisRest1, uIrisNow1, uIrisScale1);
  }
  if (uBlink > 0.0) {
    color = lid(color, q, uWhite0);
    color = lid(color, q, uWhite1);
  }
  gl_FragColor = vec4(color, 1.0);
}`

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

function loadImage(src: string) {
  const image = new Image()
  image.src = src
  return image.decode().then(() => image)
}

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader')
  return shader
}

function texture(gl: WebGLRenderingContext, image: HTMLImageElement, raw: boolean) {
  const tex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, tex)
  // Motion is data, not a picture: no colour management may touch its bytes.
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, raw ? gl.NONE : gl.BROWSER_DEFAULT_WEBGL)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return tex
}

export function HeadFollow() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    // Reduced motion, or no WebGL: the still frame underneath is the whole experience.
    if (!canvas || prefersReducedMotion()) return
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false })
    if (!gl) return

    let disposed = false
    let teardown = () => {}

    Promise.all([
      fetch(HEAD + 'motion.json').then((r) => r.json() as Promise<Manifest>),
      loadImage(HEAD + 'base.jpg'),
      loadImage(HEAD + 'motion.webp'),
      loadImage(HEAD + 'eyes.png'),
      loadImage(HEAD + 'lids.png'),
    ])
      .then(([m, base, motionImage, eyesImage, lidsImage]) => {
        if (disposed) return
        const program = gl.createProgram()!
        const shaders = [compile(gl, gl.VERTEX_SHADER, VERTEX), compile(gl, gl.FRAGMENT_SHADER, FRAGMENT)]
        shaders.forEach((shader) => gl.attachShader(program, shader))
        gl.linkProgram(program)
        shaders.forEach((shader) => gl.deleteShader(shader)) // freed along with the program
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link')
        gl.useProgram(program)

        const buffer = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
        const aPos = gl.getAttribLocation(program, 'aPos')
        gl.enableVertexAttribArray(aPos)
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

        // Uniform locations, looked up once rather than on every frame.
        const locations = new Map<string, WebGLUniformLocation | null>()
        const u = (name: string) => {
          if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name))
          return locations.get(name) ?? null
        }
        const textures = [base, motionImage, eyesImage, lidsImage].map((image, unit) => {
          gl.activeTexture(gl.TEXTURE0 + unit)
          return texture(gl, image, image === motionImage)
        })
        gl.uniform1i(u('uBase'), 0)
        gl.uniform1i(u('uMotion'), 1)
        gl.uniform1i(u('uEmpty'), 2)
        gl.uniform1i(u('uLids'), 3)
        gl.uniform4f(u('uEmptyRect'), ...m.eyesRect)
        m.eyes.forEach((e, k) => {
          gl.uniform4f(u(`uWhite${k}`), ...e.white)
          gl.uniform4f(u(`uIrisRest${k}`), ...e.iris)
        })

        // Each eye's gaze as a position across its eyeball: -1..1 of the white's radius.
        const eyes = m.eyes.map((e) => {
          const restU = (e.iris[0] - e.white[0]) / e.white[2]
          const restV = (e.iris[1] - e.white[1]) / e.white[3]
          return { e, restU, restV, u: restU, v: restV, vu: 0, vv: 0, toU: restU, toV: restV }
        })
        // How squashed a disc looks at that position on a ball.
        const squash = (t: number) => Math.sqrt(Math.max(0.2, 1 - t * t))
        let eyesOn = 0
        let blink = 0 // 0 open .. 1 closed, set each frame from blinkStart
        let blinkStart = -1 // performance.now() when the current blink began; -1 when none
        let blinkTimer: ReturnType<typeof setTimeout> | undefined
        const blinkAt = (elapsed: number) => {
          if (elapsed < BLINK_CLOSE) return (elapsed / BLINK_CLOSE) ** 2
          if (elapsed < BLINK_CLOSE + BLINK_HOLD) return 1
          const t = (elapsed - BLINK_CLOSE - BLINK_HOLD) / BLINK_OPEN
          return t >= 1 ? 0 : 1 - (1 - (1 - t) ** 2)
        }
        const BLINK_TOTAL = BLINK_CLOSE + BLINK_HOLD + BLINK_OPEN
        gl.uniform2f(u('uFrame'), m.frame[0], m.frame[1])
        gl.uniform4f(u('uRegion'), ...m.region)
        gl.uniform1f(u('uFactor'), m.factor)
        gl.uniform2f(u('uCellSize'), m.cell[0], m.cell[1])
        gl.uniform2f(u('uAtlas'), motionImage.naturalWidth, motionImage.naturalHeight)

        const cols = m.yaws.length
        const rows = m.pitches.length
        const yawSpan = m.yaws[cols - 1] - m.yaws[0]
        const pitchSpan = m.pitches[rows - 1] - m.pitches[0]

        // Where the face sits on screen, and the size of the box it's framed in, in CSS px.
        const face = { x: 0, y: 0 }
        const view = { w: 0, h: 0 }

        const layout = () => {
          // The canvas's own box, the same one the still frame underneath fills. The window size
          // can disagree with it on phones (pinch-zoom, collapsing toolbars).
          const w = canvas.clientWidth || window.innerWidth
          const h = canvas.clientHeight || window.innerHeight
          const scale = Math.max(w / m.frame[0], h / m.frame[1])
          // No sharper than the frame itself: past one canvas pixel per source pixel a phone's
          // 3x screen only multiplies the work (about 2.5x fewer pixels on an iPhone).
          const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2, 1 / scale))
          view.w = w
          view.h = h
          canvas.width = Math.round(w * dpr)
          canvas.height = Math.round(h * dpr)
          gl.viewport(0, 0, canvas.width, canvas.height)
          const ox = (w - m.frame[0] * scale) * ANCHOR_X
          const oy = (h - m.frame[1] * scale) * ANCHOR_Y
          gl.uniform2f(u('uCanvas'), canvas.width, canvas.height)
          gl.uniform1f(u('uCoverScale'), scale * dpr)
          gl.uniform2f(u('uCoverOffset'), ox * dpr, oy * dpr)
          face.x = m.face[0] * scale + ox
          face.y = m.face[1] * scale + oy
        }

        const draw = (yaw: number, pitch: number) => {
          const gx = ((yaw - m.yaws[0]) / yawSpan) * (cols - 1)
          const gy = ((pitch - m.pitches[0]) / pitchSpan) * (rows - 1)
          const i = Math.min(Math.floor(gx), cols - 2)
          const j = Math.min(Math.floor(gy), rows - 2)
          const cell = (ci: number, cj: number) => [ci * m.cell[0], cj * m.cell[1]] as const
          gl.uniform2f(u('uCell00'), ...cell(i, j))
          gl.uniform2f(u('uCell10'), ...cell(i + 1, j))
          gl.uniform2f(u('uCell01'), ...cell(i, j + 1))
          gl.uniform2f(u('uCell11'), ...cell(i + 1, j + 1))
          gl.uniform4f(
            u('uCellScale'),
            m.scales[j * cols + i],
            m.scales[j * cols + i + 1],
            m.scales[(j + 1) * cols + i],
            m.scales[(j + 1) * cols + i + 1],
          )
          gl.uniform2f(u('uFrac'), gx - i, gy - j)
          gl.uniform1f(u('uEyesOn'), eyesOn)
          gl.uniform1f(u('uBlink'), blink)
          eyes.forEach((g, k) => {
            const [cx, cy, rx, ry] = g.e.white
            gl.uniform2f(u(`uIrisNow${k}`), cx + g.u * rx, cy + g.v * ry)
            gl.uniform2f(u(`uIrisScale${k}`), squash(g.restU) / squash(g.u), squash(g.restV) / squash(g.v))
          })
          gl.drawArrays(gl.TRIANGLES, 0, 3)
        }

        const head = { yaw: 0, pitch: 0, vYaw: 0, vPitch: 0, toYaw: 0, toPitch: 0 }
        let raf = 0
        let last = 0
        let lost = false // context lost: the still frame has taken over for good

        const tick = (now: number) => {
          const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60
          last = now
          head.vYaw += (STIFFNESS * (head.toYaw - head.yaw) - DAMPING * head.vYaw) * dt
          head.vPitch += (STIFFNESS * (head.toPitch - head.pitch) - DAMPING * head.vPitch) * dt
          head.yaw += head.vYaw * dt
          head.pitch += head.vPitch * dt
          let eyesSettled = true
          for (const g of eyes) {
            g.vu += (EYE_STIFFNESS * (g.toU - g.u) - EYE_DAMPING * g.vu) * dt
            g.vv += (EYE_STIFFNESS * (g.toV - g.v) - EYE_DAMPING * g.vv) * dt
            g.u += g.vu * dt
            g.v += g.vv * dt
            const moving = [g.toU - g.u, g.toV - g.v, g.vu, g.vv].some((d) => Math.abs(d) > 0.001)
            if (moving) eyesSettled = false
          }
          const blinking = blinkStart >= 0 && now - blinkStart < BLINK_TOTAL
          blink = blinking ? blinkAt(now - blinkStart) : 0
          if (!blinking) blinkStart = -1
          const settled =
            !blinking &&
            eyesSettled &&
            Math.abs(head.toYaw - head.yaw) < 0.01 &&
            Math.abs(head.toPitch - head.pitch) < 0.01 &&
            Math.abs(head.vYaw) < 0.01 &&
            Math.abs(head.vPitch) < 0.01
          if (settled) {
            head.yaw = head.toYaw
            head.pitch = head.toPitch
            head.vYaw = head.vPitch = 0
            for (const g of eyes) {
              g.u = g.toU
              g.v = g.toV
              g.vu = g.vv = 0
            }
          }
          draw(head.yaw, head.pitch)
          if (settled) {
            raf = 0
            last = 0
          } else {
            raf = requestAnimationFrame(tick)
          }
        }
        const kick = () => {
          if (!raf && !lost) raf = requestAnimationFrame(tick)
        }

        // Aim at a point on screen. The reach on each side is the distance from his face to that
        // edge, so the full turn lands at the screen edge whichever side of the page he's on.
        const lookAt = (x: number, y: number) => {
          const { w, h } = view
          const dx = x - face.x
          const dy = y - face.y
          const reachX = Math.max(dx < 0 ? face.x : w - face.x, w * 0.3)
          const reachY = Math.max(dy < 0 ? face.y : h - face.y, h * 0.3)
          const aimX = Math.max(-1, Math.min(1, dx / reachX))
          const aimY = Math.max(-1, Math.min(1, dy / reachY))
          head.toYaw = aimX * MAX_YAW
          head.toPitch = aimY * MAX_PITCH
          for (const g of eyes) {
            g.toU = aimX * GAZE_X
            g.toV = aimY * GAZE_Y
          }
          eyesOn = 1 // from the first move on, the eyes are the animated ones
          kick()
        }
        const rest = () => {
          head.toYaw = 0
          head.toPitch = 0
          for (const g of eyes) {
            g.toU = g.restU
            g.toV = g.restV
          }
          kick()
        }

        // Touch: a tap aims too, and a lifted finger holds the look for a moment before he turns
        // back to the viewer, so a quick tap is still visible.
        let restTimer: ReturnType<typeof setTimeout> | undefined
        const onPointerMove = (event: PointerEvent) => {
          // A hovering mouse or pen (no buttons down) overrides a pending touch return-to-rest.
          if (event.buttons === 0) clearTimeout(restTimer)
          lookAt(event.clientX, event.clientY)
        }
        const onPointerDown = (event: PointerEvent) => {
          if (event.pointerType === 'mouse') return
          clearTimeout(restTimer)
          lookAt(event.clientX, event.clientY)
        }
        const onPointerEnd = (event: PointerEvent) => {
          if (event.pointerType === 'mouse') return
          clearTimeout(restTimer)
          restTimer = setTimeout(rest, 1200)
        }
        // Blinks keep coming whether or not anyone moves the mouse: that's what makes him alive.
        const scheduleBlink = (gap?: number) => {
          clearTimeout(blinkTimer)
          const [min, max] = BLINK_EVERY
          blinkTimer = setTimeout(() => {
            blinkStart = performance.now()
            kick()
            scheduleBlink(Math.random() < DOUBLE_BLINK ? BLINK_TOTAL + 120 : undefined)
          }, gap ?? min + Math.random() * (max - min))
        }

        const onResize = () => {
          if (lost) return
          layout()
          draw(head.yaw, head.pitch)
        }
        const resizeObserver = new ResizeObserver(onResize)
        // No preventDefault: the browser doesn't try to restore the context, whose program and
        // textures would be gone. The still frame underneath simply stays.
        const onContextLost = () => {
          lost = true
          clearTimeout(blinkTimer)
          cancelAnimationFrame(raf)
          raf = 0
          setReady(false)
        }

        layout()
        draw(0, 0)
        setReady(true)
        scheduleBlink()

        if (import.meta.env.DEV) {
          // Lets a test draw an exact pose and read the spring, without waiting on animation frames.
          Object.assign(window, {
            __headFollow: {
              draw,
              head,
              face,
              eyes,
              setEyesOn: (on: number) => (eyesOn = on),
              blinkNow: () => blink,
              setBlink: (b: number) => {
                clearTimeout(blinkTimer) // a test holding a blink pose shouldn't be interrupted
                blink = b
                draw(head.yaw, head.pitch)
              },
            },
          })
        }

        window.addEventListener('pointermove', onPointerMove, { passive: true })
        window.addEventListener('pointerdown', onPointerDown, { passive: true })
        window.addEventListener('pointerup', onPointerEnd)
        window.addEventListener('pointercancel', onPointerEnd)
        window.addEventListener('blur', rest)
        document.documentElement.addEventListener('mouseleave', rest)
        resizeObserver.observe(canvas)
        // The observer misses a pixel-density-only change (window dragged to another screen);
        // the window's resize event covers it.
        window.addEventListener('resize', onResize)
        canvas.addEventListener('webglcontextlost', onContextLost)

        teardown = () => {
          cancelAnimationFrame(raf)
          clearTimeout(restTimer)
          clearTimeout(blinkTimer)
          window.removeEventListener('pointermove', onPointerMove)
          window.removeEventListener('pointerdown', onPointerDown)
          window.removeEventListener('pointerup', onPointerEnd)
          window.removeEventListener('pointercancel', onPointerEnd)
          window.removeEventListener('blur', rest)
          document.documentElement.removeEventListener('mouseleave', rest)
          resizeObserver.disconnect()
          window.removeEventListener('resize', onResize)
          canvas.removeEventListener('webglcontextlost', onContextLost)
          // Hand the GPU memory back (matters on hot reload in dev; the page never unmounts it).
          textures.forEach((tex) => gl.deleteTexture(tex))
          gl.deleteBuffer(buffer)
          gl.deleteProgram(program)
        }
      })
      .catch((error) => {
        // Anything missing or unsupported: stay on the still frame rather than show a broken canvas.
        console.warn('Head follow disabled:', error)
      })

    return () => {
      disposed = true
      teardown()
    }
  }, [])

  return (
    <>
      <img
        src={HEAD + 'base.jpg'}
        alt=""
        aria-hidden="true"
        className="fixed inset-0 z-0 h-full w-full object-cover"
        style={{ objectPosition: `${ANCHOR_X * 100}% ${ANCHOR_Y * 100}%` }}
      />
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="fixed inset-0 z-0 h-full w-full"
        style={{ opacity: ready ? 1 : 0 }}
      />
    </>
  )
}
