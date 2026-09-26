// Drives the page in real headless Chrome (real animation frames, real mouse) and checks the head
// and the eyes.
//   node tools/verify_head.cjs OUT_DIR [url]
// Needs the dev server (the __headFollow test hook only exists in dev builds). Borrows
// playwright-core from a sibling project and uses the installed Chrome, so nothing is downloaded.

const path = require('path')
const fs = require('fs')
const { chromium } = require(path.resolve(__dirname, '../../mathboard/node_modules/playwright-core'))

const OUT = process.argv[2]
const URL = process.argv[3] || 'http://localhost:3532/'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const W = 1440
const H = 900

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  })
  const page = await browser.newPage({ viewport: { width: W, height: H } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`))
  await page.goto(URL)
  await page.waitForFunction(() => getComputedStyle(document.querySelector('canvas')).opacity === '1', null, { timeout: 15000 })
  const face = await page.evaluate(() => window.__headFollow.face)

  // Frame px -> screen px, same cover framing as the page (anchored 70% across).
  const scale = Math.max(W / 1920, H / 1080)
  const ox = (W - 1920 * scale) * 0.7
  const oy = (H - 1080 * scale) * 0.5
  const box = (x0, y0, x1, y1) => ({
    x: Math.round(x0 * scale + ox),
    y: Math.round(y0 * scale + oy),
    width: Math.round((x1 - x0) * scale),
    height: Math.round((y1 - y0) * scale),
  })
  const headClip = { x: Math.round(face.x - 330), y: 0, width: 660, height: 900 }
  const eyeClip = box(1230, 400, 1620, 620)

  // Hand-over check: at rest, the animated eyes must look like the frame's own.
  await page.screenshot({ path: path.join(OUT, 'eyes-original.png'), clip: eyeClip })
  await page.evaluate(() => {
    window.__headFollow.setEyesOn(1)
    window.__headFollow.draw(0, 0)
  })
  await page.screenshot({ path: path.join(OUT, 'eyes-animated-rest.png'), clip: eyeClip })

  const shots = [
    ['left', [20, face.y]],
    ['right', [W - 10, face.y]],
    ['up', [face.x, 10]],
    ['down', [face.x, H - 10]],
    ['up-left', [20, 10]],
    ['down-right', [W - 10, H - 10]],
    ['near-face', [face.x - 60, face.y + 20]],
  ]
  for (const [name, point] of shots) {
    await page.mouse.move(point[0], point[1], { steps: 12 })
    await page.waitForTimeout(1200)
    const state = await page.evaluate(() => {
      const h = window.__headFollow
      return {
        yaw: +h.head.yaw.toFixed(2),
        pitch: +h.head.pitch.toFixed(2),
        gaze: h.eyes.map((g) => [+g.u.toFixed(2), +g.v.toFixed(2)]),
      }
    })
    await page.screenshot({ path: path.join(OUT, `${name}.png`), clip: headClip })
    await page.screenshot({ path: path.join(OUT, `${name}-eyes.png`), clip: eyeClip })
    console.log(name, JSON.stringify(state))
  }

  // Smoothness: sweep the cursor across the page and sample the angles on every frame.
  await page.mouse.move(20, face.y)
  await page.waitForTimeout(1200)
  const samplesPromise = page.evaluate(
    () =>
      new Promise((resolve) => {
        const out = []
        const start = performance.now()
        const grab = (now) => {
          const h = window.__headFollow
          out.push([now - start, h.head.yaw, h.eyes[0].u])
          if (now - start < 1500) requestAnimationFrame(grab)
          else resolve(out)
        }
        requestAnimationFrame(grab)
      }),
  )
  await page.mouse.move(W - 10, face.y, { steps: 40 })
  const samples = await samplesPromise
  const step = (k) => Math.max(...samples.slice(1).map((s, i) => Math.abs(s[k] - samples[i][k])))
  const gaps = samples.slice(1).map((s, i) => s[0] - samples[i][0]).sort((a, b) => a - b)
  console.log(
    'sweep:',
    JSON.stringify({
      frames: samples.length,
      medianFrameMs: +gaps[Math.floor(gaps.length / 2)].toFixed(1),
      largestHeadStepDeg: +step(1).toFixed(3),
      largestEyeStep: +step(2).toFixed(3),
    }),
  )
  // Blinking: left alone he must blink on his own (every 2.2-6 s), and each stage of a blink must
  // look right. Natural blinks first, because holding a blink pose stops the timer.
  await page.mouse.move(face.x, face.y - 40)
  await page.waitForTimeout(600)
  const blinks = await page.evaluate(
    () =>
      new Promise((resolve) => {
        let count = 0
        let wasClosed = false
        let deepest = 0
        const start = performance.now()
        const grab = (now) => {
          const b = window.__headFollow.blinkNow()
          deepest = Math.max(deepest, b)
          if (b > 0.5 && !wasClosed) count++
          wasClosed = b > 0.5
          if (now - start < 9000) requestAnimationFrame(grab)
          else resolve({ count, deepest: +deepest.toFixed(2) })
        }
        requestAnimationFrame(grab)
      }),
  )
  console.log('blinks in 9s:', JSON.stringify(blinks))
  for (const b of [0, 0.35, 0.7, 1]) {
    await page.evaluate((v) => window.__headFollow.setBlink(v), b)
    await page.screenshot({ path: path.join(OUT, `blink-${b}.png`), clip: eyeClip })
  }

  // Phone: 2x pixels, touch only. The canvas must match its box, and a tap must aim then return.
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })
  const mobile = await phone.newPage()
  mobile.on('pageerror', (e) => errors.push('phone: ' + e))
  mobile.on('console', (m) => ['error', 'warning'].includes(m.type()) && errors.push('phone ' + m.type() + ': ' + m.text()))
  await mobile.goto(URL)
  await mobile.waitForFunction(() => getComputedStyle(document.querySelector('canvas')).opacity === '1', null, { timeout: 15000 })
  const size = await mobile.evaluate(() => [document.querySelector('canvas').width, document.querySelector('canvas').height])
  await mobile.touchscreen.tap(30, 420)
  await mobile.waitForTimeout(700)
  const afterTap = await mobile.evaluate(() => ({ yaw: +window.__headFollow.head.yaw.toFixed(2), gaze: +window.__headFollow.eyes[0].u.toFixed(2) }))
  await mobile.waitForTimeout(2200)
  const afterHold = await mobile.evaluate(() => +window.__headFollow.head.yaw.toFixed(2))
  console.log('phone:', JSON.stringify({ canvas: size, afterTap, yawAfterHold: afterHold }))

  // GPU context loss: the canvas must hide (still frame shows) and nothing may keep drawing.
  await mobile.evaluate(() => document.querySelector('canvas').getContext('webgl').getExtension('WEBGL_lose_context').loseContext())
  await mobile.waitForTimeout(300)
  const yawBeforeTap = await mobile.evaluate(() => window.__headFollow.head.yaw)
  await mobile.touchscreen.tap(360, 200)
  await mobile.waitForTimeout(800)
  const lostState = await mobile.evaluate(() => ({
    opacity: getComputedStyle(document.querySelector('canvas')).opacity,
    yaw: window.__headFollow.head.yaw,
  }))
  console.log('context lost ->', JSON.stringify({ canvasOpacity: lostState.opacity, yawMoved: lostState.yaw !== yawBeforeTap }))
  await phone.close()

  const failures = [...errors]
  if (lostState.opacity !== '0') failures.push('canvas still showing after context loss')
  if (lostState.yaw !== yawBeforeTap) failures.push('head kept animating after context loss')
  if (afterTap.yaw >= -3) failures.push('tap on the left did not turn the head')
  if (afterHold !== 0) failures.push('head did not return to rest after the tap')
  // 390x844 at 2x would be 780x1688, but the frame only has 1080 rows to show there: the canvas
  // stops at one pixel per source pixel (844 * 1080/844 = 1080 tall).
  if (size[0] !== 499 || size[1] !== 1080) failures.push(`canvas ${size} is not capped at the frame's own resolution`)
  if (blinks.count < 1 || blinks.deepest < 0.99) failures.push(`no full natural blink in 9s: ${JSON.stringify(blinks)}`)
  console.log('failures:', failures.length ? failures : 'none')
  await browser.close()
  if (failures.length) process.exit(1)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
