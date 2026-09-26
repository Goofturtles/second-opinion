import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, mine, tokens, type SetInfo } from '../lib/api'
import { compareSets, type Verdict } from '../lib/compare'
import { DEMO } from '../lib/demo'
import { DEMO_CODE, MAX_AI_QUESTIONS, MAX_ANSWER, MAX_PROMPT, MAX_QUESTIONS, MAX_TITLE, MAX_TOPIC } from '../lib/limits'
import { AI_DOWNLOAD_NOTE, AI_UNAVAILABLE, aiStatus, explain, writeQuestions } from '../lib/localAI'
import { Panel, PILL_OUTLINE, PILL_SOLID } from './Panel'

// The product itself: start a set (typed from a worksheet, or written by the on-device AI), join
// one, wait for a friend, see where you differ, and then, with answers locked, ask the AI how to
// do any question.

const POLL_MS = 4000
const FIELD =
  'h-11 w-full min-w-0 rounded-xl border border-white/20 bg-white/5 px-3 text-[17px] text-white outline-none transition-colors placeholder:text-white/55 focus:border-white'

type Props = { onClose: () => void; navigate: (hash: string) => void }

const listQuestions = (numbers: number[]) => {
  const labels = numbers.map((n) => `Q${n}`)
  return labels.length <= 1 ? labels.join('') : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}

const headlineFor = (verdicts: Verdict[]) => {
  const differ = verdicts.flatMap((v, i) => (v === 'differ' ? [i + 1] : []))
  return differ.length ? `Recheck ${listQuestions(differ)}.` : 'You match on every question you both answered.'
}

const shareLink = (code: string) => `${location.origin}${location.pathname}#join/${code}`

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

// In 10% steps, so a screen reader isn't handed every single percent.
const describeProgress = (fraction: number) =>
  fraction < 1 ? `Getting Chrome’s AI ready on this device… ${Math.floor(fraction * 10) * 10}%` : 'Thinking…'

/** True once `active` has lasted longer than a moment: the free server may be waking up. */
function useSlow(active: boolean, after = 3000) {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    setSlow(false)
    if (!active) return
    const timer = setTimeout(() => setSlow(true), after)
    return () => clearTimeout(timer)
  }, [active, after])
  return slow
}

function WakingUp({ show }: { show: boolean }) {
  // Always in the page, so the message is announced when it appears.
  return (
    <p aria-live="polite" className={show ? 'mt-3 text-[15px] text-white/70' : ''}>
      {show ? 'Waking the server up. After a quiet spell the first request can take up to a minute.' : ''}
    </p>
  )
}

function ErrorLine({ message }: { message: string }) {
  return message ? (
    <p role="alert" className="mt-4 text-[16px] text-[#ff9aa3]">
      {message}
    </p>
  ) : null
}

/** A number box you can clear and retype, without it snapping to 1 halfway through. */
function CountInput({
  label,
  value,
  max,
  onChange,
  onEnter,
}: {
  label: string
  value: number
  max: number
  onChange: (n: number) => void
  onEnter?: () => void
}) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  return (
    <label className="flex w-28 flex-col gap-2 text-[15px] text-white/60">
      {label}
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={max}
        value={text}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10)
          // Past the maximum, show the number actually used.
          setText(n > max ? String(max) : e.target.value)
          if (n >= 1) onChange(Math.min(n, max))
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault() // a count isn't a reason to submit the whole set
            onEnter?.()
          }
        }}
        onBlur={() => setText(String(value))}
        className={FIELD}
      />
    </label>
  )
}

function AnswerGrid({
  answers,
  prompts,
  onChange,
  focusFirst = false,
}: {
  answers: string[]
  prompts?: string[]
  onChange: (index: number, value: string) => void
  focusFirst?: boolean
}) {
  const firstRef = useRef<HTMLInputElement>(null)
  // The button that led here is gone, so focus would fall to the page: start at Q1 instead.
  useEffect(() => {
    if (focusFirst && (!document.activeElement || document.activeElement === document.body)) firstRef.current?.focus()
  }, [])
  return (
    <ol className={prompts ? 'mt-6 space-y-4' : 'mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3'}>
      {answers.map((answer, i) =>
        prompts ? (
          <li key={i} className="grid grid-cols-[2.25rem_1fr] gap-x-3 gap-y-2 sm:grid-cols-[2.5rem_1fr_9rem] sm:items-center">
            <span aria-hidden="true" className="pt-1 text-[15px] text-white/60 sm:pt-0">
              Q{i + 1}
            </span>
            <label htmlFor={`answer-${i}`} className="text-[16px] leading-snug text-white">
              <span className="sr-only">Q{i + 1}: </span>
              {prompts[i]}
            </label>
            <input
              ref={i === 0 ? firstRef : undefined}
              id={`answer-${i}`}
              value={answer}
              onChange={(event) => onChange(i, event.target.value)}
              maxLength={MAX_ANSWER}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="your answer"
              className={`${FIELD} col-start-2 sm:col-start-auto`}
            />
          </li>
        ) : (
          <li key={i} className="flex items-center gap-3">
            <label htmlFor={`answer-${i}`} className="w-9 shrink-0 text-[15px] text-white/60">
              Q{i + 1}
            </label>
            <input
              ref={i === 0 ? firstRef : undefined}
              id={`answer-${i}`}
              value={answer}
              onChange={(event) => onChange(i, event.target.value)}
              maxLength={MAX_ANSWER}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              className={FIELD}
            />
          </li>
        ),
      )}
    </ol>
  )
}

/** Asks before Chrome's first multi-GB model download instead of starting it silently. */
function DownloadConsent({ onYes, onNo, yes }: { onYes: () => void; onNo: () => void; yes: string }) {
  const yesRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    // Whatever asked for the AI gets focus back once this is answered and disappears.
    const opener = document.activeElement
    yesRef.current?.focus()
    return () => {
      const lost = !document.activeElement || document.activeElement === document.body
      if (lost && opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])
  return (
    <div className="mt-3">
      <p className="text-[15px] text-white/80">{AI_DOWNLOAD_NOTE}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button ref={yesRef} type="button" onClick={onYes} className={PILL_SOLID}>
          {yes}
        </button>
        <button type="button" onClick={onNo} className={PILL_OUTLINE}>
          Not now
        </button>
      </div>
    </div>
  )
}

/** "How do I do this one?": a worked solution from the AI on this device. */
function HowTo({ number, prompt, myAnswer }: { number: number; prompt?: string; myAnswer?: string }) {
  const [question, setQuestion] = useState(prompt ?? '')
  const [text, setText] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [askDownload, setAskDownload] = useState(false)
  const [declined, setDeclined] = useState(false)
  const abort = useRef<AbortController | null>(null)

  // Closing the row stops the model, so the next question doesn't queue behind this one.
  useEffect(() => () => abort.current?.abort(), [])

  // A typed question: say straight away if this browser can't do it, before any typing.
  useEffect(() => {
    if (!prompt) aiStatus().then((state) => state === 'unavailable' && setError(AI_UNAVAILABLE))
  }, [])

  const run = async (downloadOk = false) => {
    if (!question.trim() || busy) return
    // Made before the first await, so closing the row at any moment stops this run, and a newer
    // run (a double click) replaces it instead of racing it.
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    const current = () => abort.current === controller && !controller.signal.aborted
    setError('')
    setText('')
    setDeclined(false)
    const state = await aiStatus()
    if (!current()) return
    if (state === 'unavailable') return setError(AI_UNAVAILABLE)
    if (state === 'downloadable' && !downloadOk) return setAskDownload(true)
    setAskDownload(false)
    setBusy(true)
    setStatus('Thinking…')
    try {
      await explain(
        question.trim(),
        myAnswer || undefined,
        (t) => {
          if (!current()) return
          setStatus('')
          setText(t)
        },
        { signal: controller.signal, onProgress: (f) => current() && setStatus(describeProgress(f)) },
      )
    } catch (e) {
      if (current()) setError((e as Error).message)
    }
    if (!current()) return
    setStatus('')
    setBusy(false)
  }

  // A question we already know gets worked straight away.
  useEffect(() => {
    if (prompt) run()
    // Only when the row opens; a typed question runs from its button.
  }, [])

  return (
    <div className="mt-2 rounded-2xl border border-white/15 bg-white/[0.04] p-4 sm:p-5">
      {prompt ? (
        <p className="text-[16px] leading-snug text-white">
          <span className="text-white/60">Q{number}. </span>
          {prompt}
        </p>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="sr-only" htmlFor={`question-${number}`}>
            Question {number}
          </label>
          <input
            id={`question-${number}`}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            maxLength={MAX_PROMPT}
            placeholder={`Type question ${number} from your sheet`}
            className={FIELD}
          />
          <button type="button" onClick={() => run()} disabled={!question.trim()} aria-disabled={busy || undefined} className={PILL_SOLID}>
            Show me how
          </button>
        </div>
      )}
      {askDownload ? <DownloadConsent
          yes="Download and show me"
          onYes={() => run(true)}
          onNo={() => {
            setAskDownload(false)
            setDeclined(true)
          }}
        /> : null}
      {/* Announced once when done, not re-read with every streamed word. */}
      <p aria-live="polite" className="sr-only">
        {busy ? 'Working it out…' : text ? 'The worked solution is ready, below.' : ''}
      </p>
      <div aria-busy={busy} className={prompt ? 'mt-3' : ''}>
        {status ? <p className="text-[16px] text-white/70">{status}</p> : null}
        {text ? <p className="whitespace-pre-line text-[16px] leading-relaxed text-white/90">{text}</p> : null}
      </div>
      <ErrorLine message={error} />
      {prompt && !busy && (error ? error !== AI_UNAVAILABLE : declined) ? (
        <button type="button" onClick={() => run()} className={`${PILL_OUTLINE} mt-3`}>
          Try again
        </button>
      ) : null}
      {text && !busy ? (
        <p className="mt-3 text-[14px] text-white/60">
          Worked out on your device by Chrome’s built-in AI. It can make mistakes, so check each step.
        </p>
      ) : null}
    </div>
  )
}

function Result({
  verdicts,
  prompts,
  myAnswers,
  friendName,
  onNew,
}: {
  verdicts: Verdict[]
  prompts?: string[]
  myAnswers?: string[] | null
  friendName?: string
  onNew: () => void
}) {
  const [open, setOpen] = useState<number | null>(null)
  const headRef = useRef<HTMLHeadingElement>(null)
  const differ = verdicts.some((v) => v === 'differ')
  // The button that led here is gone; start from the verdict rather than the top of the page.
  useEffect(() => {
    if (!document.activeElement || document.activeElement === document.body) headRef.current?.focus()
  }, [])
  const friend = friendName ?? 'your friend'
  return (
    <div>
      <h3
        ref={headRef}
        tabIndex={-1}
        className="text-[30px] leading-[1.15] tracking-tight text-white outline-none sm:text-[38px]"
        style={{ fontFamily: 'var(--font-heading)' }}
      >
        {headlineFor(verdicts)}
      </h3>
      <p className="mt-4">
        {differ
          ? `On each flagged question one of you slipped: maybe you, maybe ${friend}. You'll never see their answer, so the fixing is yours.`
          : "Matching isn't proof you're right: if you both made the same mistake, it won't be flagged."}{' '}
        Answers are locked now, so tap any question to see how it’s done.
      </p>
      <ol className="mt-6 divide-y divide-white/10 border-y border-white/10">
        {verdicts.map((verdict, i) => {
          const isOpen = open === i
          const answer = myAnswers?.[i]
          return (
            <li key={i} className="py-2">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : i)}
                aria-expanded={isOpen}
                className="grid w-full grid-cols-[2.25rem_1fr_auto] items-start gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-white/5 sm:grid-cols-[2.5rem_1fr_auto] sm:items-center"
              >
                <span className="pt-0.5 text-[15px] text-white/60 sm:pt-0">Q{i + 1}</span>
                <span className="min-w-0">
                  <span className="block text-[16px] leading-snug text-white">{prompts?.[i] ?? `Question ${i + 1}`}</span>
                  <span className="mt-0.5 block text-[14px] text-white/60">
                    {answer ? `You put ${answer}` : 'You left it blank'} · {isOpen ? 'hide' : 'how to do it'}
                  </span>
                </span>
                <span
                  className={`rounded-full px-3 py-1 text-[14px] ${
                    verdict === 'differ'
                      ? 'bg-[#d4192e] text-white'
                      : verdict === 'blank'
                        ? 'border border-dashed border-white/40 text-white/70'
                        : 'border border-white/30 text-white/80'
                  }`}
                >
                  {verdict === 'differ' ? 'recheck' : verdict === 'blank' ? 'blank' : 'match'}
                </span>
              </button>
              {isOpen ? <HowTo number={i + 1} prompt={prompts?.[i]} myAnswer={answer} /> : null}
            </li>
          )
        })}
      </ol>
      <div className="mt-8 flex flex-wrap gap-2">
        <button type="button" onClick={onNew} className={PILL_SOLID}>
          Start a new set
        </button>
      </div>
    </div>
  )
}

/** Writes a practice set on the device from a topic. A div, not a <form>: it once sat inside the
 * "Start a set" form, where a nested form is silently dropped (and its button submitted the set). */
function AiQuestions({
  onQuestions,
  onCancel,
  focusTopic,
}: {
  onQuestions: (questions: string[]) => void
  onCancel: () => void
  focusTopic: boolean
}) {
  const [topic, setTopic] = useState('')
  const [count, setCount] = useState(8)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [askDownload, setAskDownload] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const topicRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Only when opened by a tap: on a link's first render the panel is still claiming focus.
    if (focusTopic) topicRef.current?.focus()
    // Say straight away if this browser can't do it, before anyone types a topic.
    aiStatus().then((state) => state === 'unavailable' && setError(AI_UNAVAILABLE))
    // Cancel or closing the panel stops the model, so a late reply can't replace the form.
    return () => abort.current?.abort()
  }, [])

  const run = async (downloadOk = false) => {
    if (busy || !topic.trim()) return
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setError('')
    const state = await aiStatus()
    if (controller.signal.aborted) return
    if (state === 'unavailable') return setError(AI_UNAVAILABLE)
    if (state === 'downloadable' && !downloadOk) return setAskDownload(true)
    setAskDownload(false)
    setBusy(true)
    setStatus('Writing questions…')
    try {
      const questions = await writeQuestions(topic.trim(), count, {
        signal: controller.signal,
        onProgress: (f) => !controller.signal.aborted && setStatus(f < 1 ? describeProgress(f) : 'Writing questions…'),
      })
      if (!controller.signal.aborted) onQuestions(questions)
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message)
    }
    if (controller.signal.aborted) return
    setStatus('')
    setBusy(false)
  }

  return (
    <div role="group" aria-label="Make a set with AI" className="mt-4 rounded-2xl border border-white/15 bg-white/[0.04] p-4 sm:p-5">
      <div className="flex flex-wrap gap-3">
        <label className="flex min-w-0 flex-1 basis-56 flex-col gap-2 text-[15px] text-white/60">
          Topic
          <input
            ref={topicRef}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault() // don't submit the set
                run()
              }
            }}
            maxLength={MAX_TOPIC}
            placeholder="e.g. solving linear equations, grade 9"
            className={FIELD}
          />
        </label>
        <CountInput label="How many" value={count} max={MAX_AI_QUESTIONS} onChange={setCount} onEnter={() => run()} />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => run()} disabled={!topic.trim()} aria-disabled={busy || undefined} className={PILL_SOLID}>
          {busy ? 'Writing…' : 'Write questions'}
        </button>
        <button type="button" onClick={onCancel} className="text-[15px] text-white/60 underline underline-offset-2 hover:text-white">
          Cancel
        </button>
      </div>
      {askDownload ? <DownloadConsent yes="Download and write" onYes={() => run(true)} onNo={() => setAskDownload(false)} /> : null}
      <p className="mt-3 text-[15px] text-white/60">
        <span aria-live="polite">{status}</span>
        {status ? null : 'Uses the AI built into Chrome, so nothing you type leaves this device.'}
      </p>
      <ErrorLine message={error} />
    </div>
  )
}

export function StartSet({ onClose, navigate, withAi = false }: Props & { withAi?: boolean }) {
  const [title, setTitle] = useState('')
  const [count, setCount] = useState(10)
  // Answers for every possible question, so shrinking the count and growing it back loses nothing.
  const [answers, setAnswers] = useState<string[]>(() => Array(MAX_QUESTIONS).fill(''))
  const [prompts, setPrompts] = useState<string[] | undefined>()
  // 'link' when opened from #start/ai, 'tap' when the button was pressed (only then is the
  // topic box focused straight away).
  const [aiOpen, setAiOpen] = useState<false | 'link' | 'tap'>(withAi ? 'link' : false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const slow = useSlow(busy)
  const visible = answers.slice(0, count)
  const aiButtonRef = useRef<HTMLButtonElement>(null)
  const noteRef = useRef<HTMLParagraphElement>(null)
  const focusNext = useRef<'ai-button' | 'note' | null>(null)

  // What had focus (the AI box, or "Use my own worksheet") gets swapped out; hand focus on.
  useEffect(() => {
    const target = focusNext.current === 'ai-button' ? aiButtonRef.current : focusNext.current === 'note' ? noteRef.current : null
    focusNext.current = null
    target?.focus()
  })

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const created = await api.create(title, visible, prompts)
      tokens.set(created.code, created.token)
      mine.set(created.code, visible)
      navigate(`set/${created.code}`)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Panel title="Start a set" onClose={onClose}>
      <p>Name the homework and type your answers. You’ll get a code to send to one friend.</p>
      {!prompts ? (
        aiOpen ? (
          <AiQuestions
            focusTopic={aiOpen === 'tap'}
            onCancel={() => {
              focusNext.current = 'ai-button'
              setAiOpen(false)
            }}
            onQuestions={(questions) => {
              focusNext.current = 'note'
              setPrompts(questions)
              setCount(questions.length)
              setAnswers(Array(MAX_QUESTIONS).fill(''))
              setAiOpen(false)
              setTitle((current) => (current.trim() ? current : 'AI practice set'))
            }}
          />
        ) : (
          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
            <button ref={aiButtonRef} type="button" onClick={() => setAiOpen('tap')} className={PILL_SOLID}>
              Make a set with AI
            </button>
            <span className="text-[15px] text-white/60">No worksheet? It writes the questions for both of you.</span>
          </div>
        )
      ) : null}
      <form onSubmit={onSubmit} className="mt-8">
        <div className="flex flex-wrap gap-4">
          <label className="flex min-w-0 flex-1 basis-56 flex-col gap-2 text-[15px] text-white/60">
            Homework
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={MAX_TITLE} placeholder="Ch. 7, page 212" className={FIELD} />
          </label>
          {!prompts ? <CountInput label="Questions" value={count} max={MAX_QUESTIONS} onChange={setCount} /> : null}
        </div>
        {prompts ? (
          <p ref={noteRef} tabIndex={-1} className="mt-6 text-[15px] text-white/60 outline-none">
            {prompts.length} questions written by Chrome’s built-in AI. Read them before you answer: it can slip.{' '}
            <button
              type="button"
              onClick={() => {
                focusNext.current = 'ai-button'
                setPrompts(undefined)
                setCount(10)
              }}
              className="text-white underline underline-offset-2 hover:opacity-70"
            >
              Use my own worksheet instead
            </button>
          </p>
        ) : null}
        <AnswerGrid answers={visible} prompts={prompts} onChange={(i, v) => setAnswers((prev) => prev.map((a, j) => (j === i ? v : a)))} />
        <ErrorLine message={error} />
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <button type="submit" disabled={visible.every((a) => !a.trim())} aria-disabled={busy || undefined} className={PILL_SOLID}>
            {busy ? 'Creating…' : 'Create set'}
          </button>
          <span className="text-[15px] text-white/60">Answers lock once the set is made.</span>
        </div>
        <WakingUp show={slow} />
      </form>
    </Panel>
  )
}

export function JoinSet({ onClose, navigate, initialCode }: Props & { initialCode?: string }) {
  const [code, setCode] = useState((initialCode ?? '').toUpperCase())
  const [info, setInfo] = useState<SetInfo | null>(null)
  const [answers, setAnswers] = useState<string[]>([])
  const [verdicts, setVerdicts] = useState<Verdict[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const slow = useSlow(busy)
  const latest = useRef(0)

  const find = async (value: string) => {
    // A newer search, or picking the practice set, wins over a slow reply still on its way.
    const search = ++latest.current
    setError('')
    // The practice set lives in the page: instant, and it works while the server is asleep.
    if (value === DEMO_CODE) {
      setBusy(false)
      setInfo({ code: DEMO.code, title: DEMO.title, count: DEMO.prompts.length, full: false, demo: true, friendName: DEMO.friendName, prompts: DEMO.prompts })
      setAnswers(Array(DEMO.prompts.length).fill(''))
      return
    }
    // Already in this set on this device (the creator opening their own link, or the friend
    // tapping it again): go to the result instead of a form that would take someone's place.
    if (tokens.get(value)) return navigate(`set/${value}`)
    setBusy(true)
    try {
      const found = await api.info(value)
      if (search !== latest.current) return
      setInfo(found)
      setAnswers(Array(found.count).fill(''))
    } catch (e) {
      if (search !== latest.current) return
      setError((e as Error).message)
    }
    setBusy(false)
  }

  useEffect(() => {
    if (initialCode && initialCode.length === 5) find(initialCode.toUpperCase())
    // Only the code the panel was opened with; typing a new one goes through the form.
  }, [])

  const onFind = (event: FormEvent) => {
    event.preventDefault()
    if (code.length === 5 && !busy) find(code)
  }

  const onCompare = async (event: FormEvent) => {
    event.preventDefault()
    if (!info || busy) return
    if (info.demo) return setVerdicts(compareSets(answers, DEMO.answers))
    setBusy(true)
    setError('')
    try {
      const joined = await api.join(info.code, answers)
      mine.set(info.code, answers)
      if (joined.token) tokens.set(info.code, joined.token)
      navigate(`set/${info.code}`)
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }

  return (
    <Panel title={info ? info.title : 'Join with a code'} onClose={onClose}>
      <p aria-live="polite" className="sr-only">
        {verdicts ? `Result: ${headlineFor(verdicts)}` : ''}
      </p>
      {verdicts ? (
        <Result verdicts={verdicts} prompts={info?.prompts} myAnswers={answers} friendName={info?.friendName} onNew={() => navigate('start')} />
      ) : info ? (
        info.full ? (
          <p>This set already has two people. Ask whoever sent it to start a new one.</p>
        ) : (
          <form onSubmit={onCompare}>
            <p>
              {info.demo
                ? `A practice set: ${info.friendName} has already answered. Type yours, then compare.`
                : `${info.count} question${info.count === 1 ? '' : 's'}. Type your own answers, then compare.`}
            </p>
            <AnswerGrid
              focusFirst
              answers={answers}
              prompts={info.prompts}
              onChange={(i, v) => setAnswers((prev) => prev.map((a, j) => (j === i ? v : a)))}
            />
            <ErrorLine message={error} />
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button type="submit" disabled={answers.every((a) => !a.trim())} aria-disabled={busy || undefined} className={PILL_SOLID}>
                {busy ? 'Comparing…' : 'Compare'}
              </button>
              <span className="text-[15px] text-white/60">You’ll only see question numbers, never their answers.</span>
            </div>
            <WakingUp show={slow} />
          </form>
        )
      ) : (
        <form onSubmit={onFind}>
          <p>Type the five-letter code your friend sent you.</p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))}
              aria-label="Set code"
              placeholder="ABCDE"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="h-14 w-44 rounded-xl border border-white/20 bg-white/5 px-4 text-center text-[26px] tracking-[0.2em] text-white outline-none placeholder:text-white/40 focus:border-white"
            />
            <button type="submit" disabled={code.length !== 5} aria-disabled={busy || undefined} className={PILL_SOLID}>
              {busy ? 'Finding…' : 'Find set'}
            </button>
          </div>
          <ErrorLine message={error} />
          <WakingUp show={slow} />
          <p className="mt-8 text-[16px] text-white/60">
            Trying it alone?{' '}
            <button
              type="button"
              onClick={() => {
                setCode(DEMO_CODE)
                find(DEMO_CODE)
              }}
              className="text-white underline underline-offset-2 hover:opacity-70"
            >
              Use the practice set {DEMO_CODE}
            </button>
            , where a pretend friend has already answered.
          </p>
        </form>
      )}
    </Panel>
  )
}

export function SetView({ onClose, navigate, code }: Props & { code: string }) {
  const token = tokens.get(code)
  const [info, setInfo] = useState<SetInfo | null>(null)
  const [verdicts, setVerdicts] = useState<Verdict[] | null>(null)
  const [error, setError] = useState('')
  const [trouble, setTrouble] = useState(false)
  const [copied, setCopied] = useState('')
  const slow = useSlow(!info && !error && Boolean(token))

  useEffect(() => {
    if (!token) return
    let stop = false
    let timer: ReturnType<typeof setTimeout>
    let delay = POLL_MS
    const check = async () => {
      try {
        const result = await api.result(code, token)
        if (stop) return
        setInfo(result)
        setTrouble(false)
        delay = POLL_MS
        if (result.ready) return setVerdicts(result.verdicts)
      } catch (e) {
        if (stop) return
        const status = (e as { status?: number }).status
        // A wrong link or an expired set won't fix itself; anything else (a dropped connection,
        // the phone switching apps, a busy or sleeping server) is worth waiting out.
        if (status === 403 || status === 404) return setError((e as Error).message)
        setTrouble(true)
        delay = Math.min(delay * 2, 30_000)
      }
      timer = setTimeout(check, delay)
    }
    check()
    return () => {
      stop = true
      clearTimeout(timer)
    }
  }, [code, token])

  const onCopy = async (what: 'link' | 'code') => {
    if (await copy(what === 'link' ? shareLink(code) : code)) {
      setCopied(what)
      setTimeout(() => setCopied(''), 1600)
    }
  }

  if (!token) {
    return (
      <Panel title="Join with a code" onClose={onClose}>
        <p>This link is for the two people in set {code}. If a friend sent it to you, join with the code instead.</p>
        <div className="mt-8">
          <a href={`#join/${code}`} className={PILL_SOLID}>
            Join set {code}
          </a>
        </div>
      </Panel>
    )
  }

  return (
    <Panel title={info?.title ?? 'Your set'} onClose={onClose}>
      {/* One live region that stays mounted, so the result arriving is actually announced. */}
      <p aria-live="polite" className="sr-only">
        {verdicts ? `Result: ${headlineFor(verdicts)}` : info ? 'Waiting for your friend’s answers.' : ''}
      </p>
      {error ? (
        <ErrorLine message={error} />
      ) : verdicts ? (
        <Result verdicts={verdicts} prompts={info?.prompts} myAnswers={mine.get(code)} onNew={() => navigate('start')} />
      ) : (
        <div>
          <p>Send this code to one friend. They type their own answers, and you’ll both see where you differ.</p>
          <p className="mt-6 text-[52px] leading-none tracking-[0.16em] text-white sm:text-[72px]" style={{ fontFamily: 'var(--font-heading)' }}>
            {code}
          </p>
          <p aria-live="polite" className="sr-only">
            {copied ? `${copied === 'link' ? 'Link' : 'Code'} copied.` : ''}
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <button type="button" onClick={() => onCopy('link')} className={PILL_SOLID}>
              {copied === 'link' ? 'Link copied' : 'Copy link'}
            </button>
            <button type="button" onClick={() => onCopy('code')} className={PILL_OUTLINE}>
              {copied === 'code' ? 'Code copied' : 'Copy code'}
            </button>
          </div>
          <p className="mt-8 flex items-center gap-3 text-[16px] text-white/70">
            <span aria-hidden="true" className="inline-block h-2 w-2 animate-pulse rounded-full bg-white" />
            {trouble ? 'Reconnecting…' : info ? 'Waiting for your friend’s answers…' : 'Loading…'}
          </p>
          <WakingUp show={slow} />
          <p className="mt-3 text-[15px] text-white/60">Only one friend can join. The code lasts 48 hours.</p>
        </div>
      )}
    </Panel>
  )
}
