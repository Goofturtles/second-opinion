// End-to-end check of every button, with real "people" in separate browser contexts.
//   node tools/verify_app.cjs OUT_DIR [url]
// Needs the dev server (the API runs inside it). Exits non-zero on any failure.
//
// Headless Chrome has no on-device model, so AI contexts get a stand-in LanguageModel that
// records what it was asked. That checks the page's side (what it sends, how it shows the
// reply); the real model is checked by hand in desktop Chrome.

const path = require('path')
const fs = require('fs')
const { chromium } = require(path.resolve(__dirname, '../../mathboard/node_modules/playwright-core'))

const OUT = process.argv[2]
const URL = process.argv[3] || 'http://localhost:3532/'
const failures = []
const check = (ok, message) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`)
  if (!ok) failures.push(message)
}

const FAKE_AI = (state) => {
  window.__ai = []
  window.LanguageModel = {
    availability: async () => state,
    create: async (options) => ({
      prompt: async (input) => {
        window.__ai.push({ system: options.initialPrompts[0].content, input })
        await new Promise((r) => setTimeout(r, window.__aiDelay || 0))
        const n = Number(/Write (\d+)/.exec(input)?.[1] ?? 3)
        return JSON.stringify({ questions: Array.from({ length: n }, (_, i) => `AI question ${i + 1}: what is ${i + 2} × 3?`) })
      },
      promptStreaming: (input, streamOptions) => {
        window.__ai.push({ system: options.initialPrompts[0].content, input })
        window.__signal = streamOptions?.signal
        const parts = ['1. Find 10% of 80: that is 8.\n', '2. 15% is 10% + 5%, so 8 + 4.\n', 'Answer: 12']
        return new ReadableStream({
          async start(controller) {
            for (const part of parts) {
              await new Promise((r) => setTimeout(r, 30))
              controller.enqueue(part)
            }
            controller.close()
          },
        })
      },
      destroy() {},
    }),
  }
}

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  const person = async ({ ai = false, ...options } = {}) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options })
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    if (ai) await context.addInitScript(FAKE_AI, ai === true ? 'available' : ai)
    const page = await context.newPage()
    page.on('pageerror', (e) => failures.push(`page error: ${e}`))
    page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && failures.push(`console: ${m.text()}`))
    page.on('response', (r) => {
      if (r.status() >= 400 && !r.url().includes('/api/')) failures.push(`${r.status()} ${r.url()}`)
    })
    await page.goto(URL)
    await page.waitForSelector('h1', { state: 'attached' })
    return page
  }
  const dialogTitle = (page) => page.locator('[role=dialog] h2').innerText()
  const headline = (page) => page.getByText(/^(Recheck .*\.|You match on every question you both answered\.)$/).first().innerText()
  const button = (name) => `role=button[name="${name}"]`
  const layoutProblems = (page) =>
    page.evaluate(() => {
      const problems = []
      if (document.documentElement.scrollWidth > innerWidth) problems.push(`page scrolls sideways (${document.documentElement.scrollWidth}px)`)
      for (const el of document.querySelectorAll('body *')) {
        const style = getComputedStyle(el)
        // Line clamps and screen-reader-only text are clipped on purpose.
        if (style.webkitLineClamp !== 'none' || el.classList.contains('sr-only') || !el.getClientRects().length) continue
        const clipsY = /hidden|clip/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1
        const wide = el.closest('[role=dialog]') && el.getBoundingClientRect().right > innerWidth + 1
        if (clipsY || wide) problems.push(`${clipsY ? 'clipped' : 'past the edge'}: <${el.tagName.toLowerCase()} class="${el.className}">`)
      }
      return problems
    })

  // --- every information link opens its panel, and Escape closes it ---
  const a = await person({ ai: true })
  for (const [link, title] of [
    ['header nav >> text=How it works', 'How it works'],
    ['header nav >> text=Privacy', 'Privacy'],
    ['header nav >> text=Teachers', 'For teachers'],
    ['header nav >> text=FAQ', 'FAQ'],
    ['main >> text=See how it works', 'How it works'],
    ["main >> text=Why this isn't cheating", 'Why this isn’t cheating'],
    ['main >> text=Join with a code', 'Join with a code'],
  ]) {
    await a.click(link)
    const got = await dialogTitle(a)
    check(got === title, `"${link.split('>> text=')[1]}" opens "${title}"`)
    await a.keyboard.press('Escape')
    check((await a.locator('[role=dialog]').count()) === 0 && !(await a.evaluate(() => location.hash)), '  Escape closes it')
  }

  // --- "Make a set with AI" from an info panel opens Start a set with the AI box ready ---
  await a.click('header nav >> text=How it works')
  await a.click('[role=dialog] >> text=Make a set with AI')
  await a.waitForSelector('input[placeholder^="e.g."]', { timeout: 3000 }).catch(() => {})
  check((await dialogTitle(a)) === 'Start a set' && (await a.locator('input[placeholder^="e.g."]').isVisible()), '"Make a set with AI" link opens Start a set with the topic box ready')
  await a.keyboard.press('Escape')

  // --- the question count can shrink and grow back without losing answers ---
  await a.click('header >> text=Start a set')
  await a.fill('#answer-7', 'kept')
  await a.fill('input[type=number]', '3')
  await a.fill('input[type=number]', '10')
  check((await a.inputValue('#answer-7')) === 'kept', 'shrinking the question count and growing it back keeps Q8’s answer')
  await a.keyboard.press('Escape')

  // --- person A makes an AI practice set ---
  await a.click('header >> text=Start a set')
  await a.click(button('Make a set with AI'))
  await a.fill('input[placeholder^="e.g."]', 'multiplication')
  await a.getByLabel('How many').fill('4')
  await a.click(button('Write questions'))
  await a.waitForSelector('text=AI question 4')
  check((await a.locator('#answer-3').count()) === 1 && (await a.locator('#answer-4').count()) === 0, 'AI wrote 4 questions and there are 4 answer boxes')
  const writerCall = await a.evaluate(() => window.__ai.at(-1))
  check(writerCall.input.includes('multiplication') && writerCall.input.includes('4'), 'the AI was asked for 4 questions about the topic')
  for (const [i, v] of ['6', '9', '12', 'fifteen'].entries()) await a.fill(`#answer-${i}`, v)
  await a.screenshot({ path: path.join(OUT, 'ai-start.png') })
  await a.click(button('Create set'))
  await a.waitForFunction(() => location.hash.startsWith('#set/'))
  const code = (await a.evaluate(() => location.hash)).split('/')[1]
  check(/^[A-Z2-9]{5}$/.test(code), `AI set created with code ${code}`)
  await a.click(button('Copy link'))
  const link = await a.evaluate(() => navigator.clipboard.readText())

  // --- the creator opening their own link goes to their set, not a blank form ---
  await a.goto(link)
  await a.waitForFunction(() => location.hash.startsWith('#set/'))
  check(true, 'creator opening their own share link lands on the set, not a join form')

  // --- person B joins: sees the questions, answers, compares ---
  const b = await person({ ai: true })
  await b.goto(link)
  await b.waitForSelector('#answer-3')
  check((await b.locator('text=AI question 2').count()) === 1, 'the friend sees the AI-written questions')
  for (const [i, v] of ['6', '8', '12', '15'].entries()) await b.fill(`#answer-${i}`, v)
  await b.click(button('Compare'))
  await b.waitForSelector('text=Recheck')
  check((await headline(b)) === 'Recheck Q2 and Q4.', `friend sees "${await headline(b)}"`)
  check(!/fifteen/.test(await b.content()), 'friend’s page contains none of the creator’s answers')
  check((await b.locator('text=You put 8').count()) === 1, 'the result shows the friend their own answer')
  await b.screenshot({ path: path.join(OUT, 'result-rows.png') })

  // --- tapping a question shows how to do it, from the on-device AI ---
  await b.click('text=AI question 2')
  await b.waitForSelector('text=Answer: 12')
  const tutorCall = await b.evaluate(() => window.__ai.at(-1))
  check(tutorCall.input.includes('AI question 2') && tutorCall.input.includes("student's answer: 8"), 'the AI got the question text and the student’s own answer')
  check((await b.locator('text=It can make mistakes').count()) === 1, 'the explanation carries the "can make mistakes" note')
  await b.screenshot({ path: path.join(OUT, 'how-to.png') })

  // --- closing a question while it's being explained stops the model ---
  await b.click('text=AI question 4')
  await b.waitForFunction(() => window.__ai.at(-1).input.includes('AI question 4'))
  await b.click('text=AI question 4')
  check(await b.evaluate(() => window.__signal?.aborted === true), 'closing a question mid-explanation aborts the AI')

  // --- person A's waiting screen updates on its own, with the questions ---
  await a.waitForSelector('text=Recheck', { timeout: 10000 })
  check((await headline(a)) === 'Recheck Q2 and Q4.', 'creator’s screen updates by itself')
  check((await a.locator('text=You put fifteen').count()) === 1, 'creator sees their own answers next to the questions')

  // --- a third person is refused ---
  const c = await person()
  await c.goto(`${URL}#join/${code}`)
  await c.waitForSelector('text=already has two people')
  check(true, 'a third person is told the set already has two people')

  // --- practice set, no AI in this browser: rows show questions; "how" explains what's missing ---
  await c.goto(URL)
  await c.click('main >> text=Join with a code')
  const apiCalls = []
  c.on('request', (r) => r.url().includes('/api/') && apiCalls.push(r.url()))
  await c.click('text=Use the practice set')
  await c.waitForSelector('#answer-5')
  for (const [i, v] of ['5', '3/4', '10', '2', '9', '-24'].entries()) await c.fill(`#answer-${i}`, v)
  await c.click(button('Compare'))
  await c.waitForSelector('text=Recheck')
  check((await headline(c)) === 'Recheck Q6.', `practice set gives "${await headline(c)}"`)
  check((await c.locator('text=15% of 80').count()) === 1, 'practice result shows the question text')
  check(apiCalls.length === 0, `the practice set runs without the server (${apiCalls.length} API calls)`)
  await c.click('text=−4 × −6')
  await c.waitForSelector('text=built into Chrome')
  check(true, 'without on-device AI, "how to do it" says what’s needed instead of failing')

  // --- a paper-homework set: "how to do it" asks for the question first ---
  const d = await person({ ai: true })
  await d.click('header >> text=Start a set')
  await d.fill('input[type=number]', '2')
  await d.fill('#answer-0', '7')
  await d.fill('#answer-1', '3')
  await d.click(button('Create set'))
  await d.waitForFunction(() => location.hash.startsWith('#set/'))
  const paperLink = `${URL}#join/${(await d.evaluate(() => location.hash)).split('/')[1]}`
  const e = await person({ ai: true })
  await e.goto(paperLink)
  await e.waitForSelector('#answer-1')
  await e.fill('#answer-0', '7')
  await e.fill('#answer-1', '4')
  await e.click(button('Compare'))
  await e.waitForSelector('text=Recheck')
  await e.click('text=Question 2')
  await e.fill('input[placeholder="Type question 2 from your sheet"]', 'What is 15% of 80?')
  await e.click(button('Show me how'))
  await e.waitForSelector('text=Answer: 12')
  check(true, 'paper-homework set: typing the question gets a worked solution')

  // --- Chrome's first model download waits for a yes ---
  const f = await person({ ai: 'downloadable' })
  await f.goto(`${URL}#start/ai`)
  await f.fill('input[placeholder^="e.g."]', 'fractions')
  await f.click(button('Write questions'))
  await f.waitForSelector('text=downloads its AI model')
  check((await f.evaluate(() => window.__ai.length)) === 0, 'a model download is explained first, and nothing starts without a yes')
  await f.click(button('Download and write'))
  await f.waitForSelector('text=AI question 3')
  check(true, '"Download and write" goes ahead')

  // --- Cancel while the AI is still writing: its late reply must not replace the form ---
  const g = await person({ ai: true })
  await g.goto(`${URL}#start/ai`)
  await g.evaluate(() => (window.__aiDelay = 1200))
  await g.fill('input[placeholder^="e.g."]', 'fractions')
  await g.click(button('Write questions'))
  await g.click('text=Cancel')
  await g.fill('#answer-0', 'mine')
  await g.fill('input[placeholder="Ch. 7, page 212"]', 'My sheet')
  await g.waitForTimeout(1800)
  check(
    (await g.inputValue('#answer-0')) === 'mine' && (await g.locator('text=AI question').count()) === 0 && (await g.inputValue('input[placeholder="Ch. 7, page 212"]')) === 'My sheet',
    'cancelling mid-write keeps the typed answers and title',
  )
  check(await g.evaluate(() => document.activeElement?.id === 'answer-0' || document.activeElement?.tagName === 'INPUT'), '  focus stays where the person is typing')

  // --- picking the practice set while a slow search is still out wins ---
  const h = await person()
  await h.route('**/api/sets/ZZZZZ', async (route) => {
    await new Promise((r) => setTimeout(r, 1500))
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"No set with that code."}' })
  })
  await h.goto(`${URL}#join`)
  await h.fill('input[aria-label="Set code"]', 'ZZZZZ')
  await h.click(button('Find set'))
  await h.click('text=Use the practice set')
  await h.waitForTimeout(2200)
  check(
    (await h.locator('#answer-5').count()) === 1 && (await h.locator('text=No set with that code').count()) === 0 && (await h.getAttribute(button('Compare'), 'aria-disabled')) === null,
    'a slow search can’t take over, or disable, the practice set',
  )

  // --- names that exist on every object don't open anything, or crash ---
  const k = await person()
  for (const name of ['constructor', 'toString', '__proto__']) {
    await k.goto(`${URL}#${name}`)
    await k.waitForTimeout(150)
  }
  check((await k.locator('[role=dialog]').count()) === 0 && (await k.locator('h1').count()) === 1, '#constructor, #toString and #__proto__ leave the page working')

  // --- the copy pill copies the practice code; phone menu works ---
  await c.keyboard.press('Escape')
  await c.click('main >> text=Set code')
  check((await c.evaluate(() => navigator.clipboard.readText())) === '4K2P9', 'the "Set code" pill copies 4K2P9')
  const phone = await person({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await phone.tap('[aria-controls=mobile-menu]')
  await phone.tap('#mobile-menu >> text=Start a set')
  check((await dialogTitle(phone)) === 'Start a set', 'phone menu "Start a set" opens the form')

  const phoneSize = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, ai: true }
  const p1 = await person(phoneSize)
  let problems = await layoutProblems(p1)
  check(!problems.length, `phone hero: nothing clipped or sideways ${problems.join('; ')}`)
  await p1.screenshot({ path: path.join(OUT, 'phone-hero.png') })
  await p1.goto(`${URL}#start/ai`)
  await p1.fill('input[placeholder^="e.g."]', 'percentages')
  await p1.getByLabel('How many').fill('3')
  await p1.tap(button('Write questions'))
  await p1.waitForSelector('text=AI question 3') // the plain grid already has an #answer-2
  for (const [i, v] of ['6', '9', '12'].entries()) await p1.fill(`#answer-${i}`, v)
  problems = await layoutProblems(p1)
  check(!problems.length, `phone AI set form: nothing clipped or sideways ${problems.join('; ')}`)
  await p1.screenshot({ path: path.join(OUT, 'phone-ai-set.png'), fullPage: true })
  await p1.tap(button('Create set'))
  await p1.waitForFunction(() => location.hash.startsWith('#set/'))
  const phoneCode = (await p1.evaluate(() => location.hash)).split('/')[1]
  const p2 = await person(phoneSize)
  await p2.goto(`${URL}#join/${phoneCode}`)
  await p2.waitForSelector('#answer-2')
  for (const [i, v] of ['6', '8', '12'].entries()) await p2.fill(`#answer-${i}`, v)
  await p2.tap(button('Compare'))
  await p2.waitForSelector('text=Recheck')
  problems = await layoutProblems(p2)
  check(!problems.length, `phone result: nothing clipped or sideways ${problems.join('; ')}`)
  await p2.screenshot({ path: path.join(OUT, 'phone-result.png') })
  await p2.tap('text=AI question 2')
  await p2.waitForSelector('text=Answer: 12')
  problems = await layoutProblems(p2)
  check(!problems.length, `phone how-to: nothing clipped or sideways ${problems.join('; ')}`)
  await p2.screenshot({ path: path.join(OUT, 'phone-how-to.png') })

  console.log(failures.length ? `\n${failures.length} FAILED:\n- ${failures.join('\n- ')}` : '\nall passed')
  await browser.close()
  process.exit(failures.length ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
