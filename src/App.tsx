import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { HeadFollow } from './HeadFollow'
import { DEMO_CODE } from './lib/limits'
import { Faq, HowItWorks, NotCheating, Privacy, Teachers } from './panels/Info'
import { JoinSet, SetView, StartSet } from './panels/Sets'

const NAV_LINKS = [
  { label: 'How it works', href: '#how' },
  { label: 'Privacy', href: '#privacy' },
  { label: 'Teachers', href: '#teachers' },
  { label: 'FAQ', href: '#faq' },
]

const CTA = { label: 'Start a set', href: '#start' }

const PILLS = [
  { label: 'Start a set', href: '#start' },
  { label: 'Join with a code', href: '#join' },
  { label: 'See how it works', href: '#how' },
  { label: "Why this isn't cheating", href: '#cheating' },
]

// The practice set's code: real and joinable, so copying it is the quickest way to try the app.
const SET_CODE = DEMO_CODE

const TYPED_LINE =
  'You and a friend enter your answers. I only show you where you disagree. So, what are we checking tonight?'

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

function useTypewriter(text: string, speed = 38, startDelay = 600) {
  const [displayed, setDisplayed] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (prefersReducedMotion()) {
      setDisplayed(text)
      setDone(true)
      return
    }

    setDisplayed('')
    setDone(false)
    let index = 0
    let interval: ReturnType<typeof setInterval> | undefined

    const timeout = setTimeout(() => {
      interval = setInterval(() => {
        index += 1
        setDisplayed(text.slice(0, index))
        if (index >= text.length) {
          clearInterval(interval)
          setDone(true)
        }
      }, speed)
    }, startDelay)

    return () => {
      clearTimeout(timeout)
      if (interval) clearInterval(interval)
    }
  }, [text, speed, startDelay])

  return { displayed, done }
}

function CopyIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.2" />
      <path d="M8.2 1.5H2.7A1.2 1.2 0 0 0 1.5 2.7v5.5" />
    </svg>
  )
}

function Navbar({ open, setOpen }: { open: boolean; setOpen: (open: boolean) => void }) {
  const toggleRef = useRef<HTMLButtonElement>(null)
  const firstLinkRef = useRef<HTMLAnchorElement>(null)

  const close = () => {
    setOpen(false)
    toggleRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    firstLinkRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  useEffect(() => {
    // Rotating a phone to landscape crosses md, which hides both the overlay and the button that
    // closes it. Without this, the menu stays "open" and leaves the page inert.
    const desktop = window.matchMedia('(min-width: 768px)')
    const sync = () => {
      if (!desktop.matches) return
      // An overlay link holding focus is about to be hidden, so let go of it. Only then:
      // browser zoom crosses this width too, and a keyboard user shouldn't lose their place.
      const focused = document.activeElement
      if (focused instanceof HTMLElement && document.getElementById('mobile-menu')?.contains(focused)) {
        focused.blur()
      }
      setOpen(false)
    }
    sync()
    desktop.addEventListener('change', sync)
    return () => desktop.removeEventListener('change', sync)
  }, [setOpen])

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-10 flex items-center justify-between px-5 py-4 sm:px-8 sm:py-5">
        {/* Sits outside <main>, so it stays reachable behind the overlay unless taken out. */}
        <a href="#" tabIndex={open ? -1 : 0} className="flex items-center gap-3">
          <span
            className="text-[21px] tracking-tight text-white sm:text-[26px]"
            style={{ fontFamily: 'var(--font-heading)' }}
          >
            Second Opinion&#174;
          </span>
          <span
            aria-hidden="true"
            className="select-none text-[25px] text-white sm:text-[30px]"
            style={{ letterSpacing: '-0.02em' }}
          >
            &#10035;&#65038;
          </span>
        </a>

        <nav className="hidden items-center text-[23px] text-white md:flex">
          {NAV_LINKS.map((link, i) => (
            <span key={link.href}>
              <a href={link.href} className="transition-opacity hover:opacity-60">
                {link.label}
              </a>
              {i < NAV_LINKS.length - 1 ? (
                <span aria-hidden="true" className="whitespace-pre">
                  ,{' '}
                </span>
              ) : null}
            </span>
          ))}
        </nav>

        <a
          href={CTA.href}
          className="hidden text-[23px] text-white underline underline-offset-2 transition-opacity hover:opacity-60 md:inline"
        >
          {CTA.label}
        </a>

        <button
          ref={toggleRef}
          type="button"
          onClick={() => (open ? close() : setOpen(true))}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls="mobile-menu"
          className="flex flex-col gap-[5px] md:hidden"
        >
          <span
            className="h-[2px] w-6 bg-white transition-transform duration-300"
            style={{ transform: open ? 'translateY(7px) rotate(45deg)' : 'none' }}
          />
          <span
            className="h-[2px] w-6 bg-white transition-opacity duration-300"
            style={{ opacity: open ? 0 : 1 }}
          />
          <span
            className="h-[2px] w-6 bg-white transition-transform duration-300"
            style={{ transform: open ? 'translateY(-7px) rotate(-45deg)' : 'none' }}
          />
        </button>
      </header>

      <nav
        id="mobile-menu"
        aria-label="Menu"
        className="fixed inset-0 z-[9] flex flex-col justify-center gap-8 bg-black/90 px-8 backdrop-blur-md transition-opacity duration-300 md:hidden"
        style={{ opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none' }}
        aria-hidden={!open}
      >
        {NAV_LINKS.map((link, i) => (
          <a
            key={link.href}
            ref={i === 0 ? firstLinkRef : undefined}
            href={link.href}
            tabIndex={open ? 0 : -1}
            onClick={close}
            className="text-[32px] font-medium text-white"
          >
            {link.label}
          </a>
        ))}
        <a
          href={CTA.href}
          tabIndex={open ? 0 : -1}
          onClick={close}
          className="text-[32px] font-medium text-white underline underline-offset-2"
        >
          {CTA.label}
        </a>
      </nav>
    </>
  )
}

function Hero() {
  const { displayed, done } = useTypewriter(TYPED_LINE)
  const [pillsIn, setPillsIn] = useState(false)
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle')
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    const timeout = setTimeout(() => setPillsIn(true), 400)
    return () => clearTimeout(timeout)
  }, [])

  useEffect(() => () => clearTimeout(copiedTimer.current), [])

  const copyCode = async () => {
    let ok = false
    try {
      await navigator.clipboard.writeText(SET_CODE)
      ok = true
    } catch {
      // Clipboard API is denied in embedded webviews and on plain http, so fall back.
      // select() pulls focus into the scratch textarea; hand it back afterwards.
      const returnFocus = document.activeElement
      const scratch = document.createElement('textarea')
      scratch.value = SET_CODE
      scratch.setAttribute('readonly', '')
      scratch.style.position = 'fixed'
      scratch.style.opacity = '0'
      document.body.appendChild(scratch)
      scratch.select()
      try {
        ok = document.execCommand('copy')
      } catch {
        ok = false
      }
      document.body.removeChild(scratch)
      if (returnFocus instanceof HTMLElement) returnFocus.focus()
    }
    setCopied(ok ? 'done' : 'failed')
    clearTimeout(copiedTimer.current)
    copiedTimer.current = setTimeout(() => setCopied('idle'), 1600)
  }

  return (
    <section className="relative z-[1] flex h-screen flex-col justify-end overflow-hidden px-5 pb-12 sm:px-8 md:justify-center md:px-10 md:pb-0">
      <div className="relative z-10 max-w-xl">
        {/* The visible headline is blurred by design and types itself in, so the readable copy
            of it lives here for screen readers and link previews. */}
        <h1 className="sr-only">
          Second Opinion: you and a friend enter your homework answers, and it shows you only the
          questions you disagree on.
        </h1>

        <p
          aria-hidden="true"
          className="mb-5 select-none sm:mb-6"
          style={{
            fontSize: 'clamp(18px, 4vw, 26px)',
            lineHeight: 1.3,
            fontWeight: 400,
            color: '#fff',
            filter: 'blur(4px)',
            pointerEvents: 'none',
          }}
        >
          Hey there, this is Second Opinion,
          <br />
          the check that never shows their answer
        </p>

        <p
          aria-hidden="true"
          className="mb-5 text-white sm:mb-6"
          style={{
            fontSize: 'clamp(18px, 4vw, 26px)',
            lineHeight: 1.35,
            fontWeight: 400,
            minHeight: 54,
          }}
        >
          {displayed}
          {!done && (
            <span className="cursor-blink ml-[2px] inline-block h-[1.1em] w-[2px] bg-white align-middle" />
          )}
        </p>

        <div
          className="flex flex-wrap gap-y-1"
          style={{
            opacity: pillsIn ? 1 : 0,
            transform: pillsIn ? 'translateY(0)' : 'translateY(8px)',
            transition: 'opacity 0.4s ease, transform 0.4s ease',
          }}
        >
          {PILLS.map((pill) => (
            <a
              key={pill.href}
              href={pill.href}
              className="mx-[0.2em] mb-[0.4em] inline-flex items-center justify-center whitespace-nowrap rounded-full border border-black/10 bg-white px-4 py-[0.3em] text-[13px] text-black transition-colors duration-200 hover:bg-black hover:text-white sm:px-5 sm:text-[15px]"
            >
              {pill.label}
            </a>
          ))}

          <button
            type="button"
            onClick={copyCode}
            aria-label={`Copy set code ${SET_CODE}`}
            className="mx-[0.2em] mb-[0.4em] inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full border border-white bg-transparent px-4 py-[0.3em] text-[13px] text-white transition-colors duration-200 hover:bg-white hover:text-black sm:gap-3 sm:px-5 sm:text-[15px]"
          >
            <span>
              Set code: <span className="underline underline-offset-1">{SET_CODE}</span>
            </span>
            <CopyIcon />
          </button>
        </div>

        {/* Outside the button: a live region inside an aria-label'd control is skipped by
            several screen readers. */}
        <span className="sr-only" aria-live="polite">
          {copied === 'done'
            ? `Copied set code ${SET_CODE}`
            : copied === 'failed'
              ? `Couldn't copy. The set code is ${SET_CODE}.`
              : ''}
        </span>
      </div>
    </section>
  )
}

// Panels open from the URL hash (#how, #start, #join/ABCDE, #set/ABCDE...), so every button is a
// plain link, the back button closes a panel, and a friend's link opens straight onto their set.
type Route = { name: string; code?: string }
const parseRoute = (hash: string): Route => {
  const [name = '', code] = hash.replace(/^#\/?/, '').split('/')
  return { name, code: code?.toUpperCase() }
}

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash))

  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute(location.hash))
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const closePanel = useCallback(() => {
    history.replaceState(null, '', location.pathname + location.search)
    setRoute({ name: '' })
  }, [])
  const navigate = useCallback((hash: string) => {
    location.hash = hash
  }, [])

  const props = { onClose: closePanel, navigate }
  const panels: Record<string, () => ReactNode> = {
    how: () => <HowItWorks {...props} />,
    cheating: () => <NotCheating {...props} />,
    privacy: () => <Privacy {...props} />,
    teachers: () => <Teachers {...props} />,
    faq: () => <Faq {...props} />,
    start: () => <StartSet {...props} withAi={route.code === 'AI'} />,
    join: () => <JoinSet {...props} initialCode={route.code} />,
    set: () => (route.code ? <SetView {...props} code={route.code} /> : null),
  }
  const panel = Object.hasOwn(panels, route.name) ? panels[route.name]() : null

  return (
    <>
      <HeadFollow />
      {/* While a panel is open, everything behind it is out of reach. */}
      <div inert={panel ? true : undefined}>
        <Navbar open={menuOpen} setOpen={setMenuOpen} />
      </div>
      {/* Keeps the hero out of the tab order while the overlay menu or a panel covers it. */}
      <main inert={menuOpen || panel ? true : undefined}>
        <Hero />
      </main>
      <div key={`${route.name}/${route.code ?? ''}`}>{panel}</div>
    </>
  )
}
