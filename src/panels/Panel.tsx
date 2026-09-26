import { useEffect, useId, useRef, type ReactNode } from 'react'

// Full-screen panel in the same language as the spec's mobile menu: black at 90% over a blur.
// A dialog: focus moves in on open and back to whatever opened it on close; Escape closes.

export const PILL =
  'inline-flex items-center justify-center whitespace-nowrap rounded-full px-5 py-[0.35em] text-[15px] transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-40'
export const PILL_SOLID = `${PILL} border border-black/10 bg-white text-black hover:bg-black hover:text-white hover:border-white`
export const PILL_OUTLINE = `${PILL} border border-white bg-transparent text-white hover:bg-white hover:text-black`

export function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const titleId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  // The latest close handler, so a new function from the parent doesn't re-run the effect below
  // (which would yank focus back to the heading on every render).
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    headingRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      // Not while an input method is composing: there Escape cancels the composition.
      if (event.key === 'Escape' && !event.isComposing) closeRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      opener?.focus()
    }
  }, [])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-[20] overflow-y-auto bg-black/90 text-white backdrop-blur-md"
    >
      <button
        type="button"
        onClick={onClose}
        className="fixed right-5 top-4 z-10 text-[18px] underline underline-offset-2 transition-opacity hover:opacity-60 sm:right-8 sm:top-5 sm:text-[23px]"
      >
        Close
      </button>
      <div className="mx-auto max-w-2xl px-8 pb-20 pt-24 sm:pt-28">
        <h2
          id={titleId}
          ref={headingRef}
          tabIndex={-1}
          className="text-[34px] leading-[1.1] tracking-tight outline-none sm:text-[46px]"
          style={{ fontFamily: 'var(--font-heading)' }}
        >
          {title}
        </h2>
        <div className="mt-6 text-[17px] leading-relaxed text-white/75 sm:text-[19px]">{children}</div>
      </div>
    </div>
  )
}
