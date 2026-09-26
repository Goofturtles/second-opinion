import { MAX_PROMPT } from './limits'

// Chrome's built-in AI (Gemini Nano, through the Prompt API): free, private, and it runs on the
// device, so nothing typed here leaves it. Desktop Chrome 148+ only; anywhere else aiStatus()
// reports 'unavailable' and the page says so instead of failing.

export type AiStatus = 'unavailable' | 'downloadable' | 'downloading' | 'available'

type Session = {
  prompt(input: string, options?: { responseConstraint?: object; signal?: AbortSignal }): Promise<string>
  promptStreaming(input: string, options?: { signal?: AbortSignal }): ReadableStream<string>
  destroy(): void
}
type Monitor = { addEventListener(type: 'downloadprogress', listener: (event: { loaded: number }) => void): void }
type LanguageModelApi = {
  availability(options?: object): Promise<AiStatus>
  create(options?: object): Promise<Session>
}

const model = () => (globalThis as { LanguageModel?: LanguageModelApi }).LanguageModel
const LANGUAGES = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] }

export const AI_UNAVAILABLE =
  'This needs the AI built into Chrome on a computer (Chrome 148 or newer, on hardware that can run it). This browser can’t use it.'
export const AI_DOWNLOAD_NOTE = 'The first time, Chrome downloads its AI model (a few GB, once). After that it works offline.'

export async function aiStatus(): Promise<AiStatus> {
  const lm = model()
  if (!lm) return 'unavailable'
  try {
    return await lm.availability(LANGUAGES)
  } catch {
    return 'unavailable'
  }
}

/** Turns what went wrong into something a student can act on. `started` is whether the model
 * had already opened: after that, "not supported" is about the request (a reply in a language it
 * doesn't do, say), not the browser. */
function friendly(error: unknown, started: boolean): Error {
  const e = error as { name?: string; message?: string }
  if (e?.name === 'AbortError') return Object.assign(new Error('Stopped.'), { name: 'AbortError' })
  if (e?.name === 'NotAllowedError') return new Error('Chrome wants a tap to start its AI. Try the button again.')
  if (e?.name === 'NotSupportedError' && started) {
    return new Error('The AI couldn’t answer that. It only works in English, so try wording it in English.')
  }
  if (e?.name === 'NotSupportedError' || e?.name === 'OperationError') return new Error(AI_UNAVAILABLE)
  if (e?.name === 'QuotaExceededError') return new Error('That was too long for the AI. Try a shorter question.')
  if (error instanceof SyntaxError) return new Error('The AI’s reply came out garbled. Try again.')
  return new Error(e?.message && e.message.length < 140 ? e.message : 'The AI couldn’t do that. Try again.')
}

/** A fresh session. The first time, Chrome downloads the model; onProgress gets 0..1. */
async function open(system: string, signal?: AbortSignal, onProgress?: (fraction: number) => void) {
  const lm = model()
  if (!lm) throw new Error(AI_UNAVAILABLE)
  return lm.create({
    ...LANGUAGES,
    signal,
    initialPrompts: [{ role: 'system', content: system }],
    monitor(m: Monitor) {
      m.addEventListener('downloadprogress', (event) => onProgress?.(event.loaded))
    },
  })
}

// The model tends to answer in Markdown and LaTeX even when asked not to; students should see
// "3/4", not "$\frac{3}{4}$" or "**Step 1**". Every rule must keep the maths meaning the same:
// the text becomes the question both people see.
const SYMBOLS: Record<string, string> = {
  times: '×', div: '÷', cdot: '·', cdots: '…', ldots: '…', dots: '…', pm: '±',
  le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', infty: '∞', degree: '°',
  pi: 'π', theta: 'θ', alpha: 'α', beta: 'β',
}
// A fraction's top or bottom keeps its brackets unless it's a single number or name.
const group = (part: string) => (/^[A-Za-z0-9.²³]+$/.test(part) ? part : `(${part})`)

export function plainText(text: string) {
  return (
    text
      // $…$ counts as maths only by pandoc's rule (no space just inside either dollar, no digit
      // straight after the closing one), so "a book costs $12 and a pen costs $3" keeps its money.
      .replace(/\$\$([\s\S]+?)\$\$|\$(?!\s)([^$\n]*?[^\s$])\$(?!\d)/g, (_, display?: string, inline?: string) => display ?? inline ?? '')
      .replace(/\\\(|\\\)|\\\[|\\\]/g, '')
      .replace(/\\(left|right|quad|qquad|displaystyle)\b|\\[,;!]/g, '')
      .replace(/\^\{?\\circ\}?/g, '°')
      // Only a plain 2 or 3 becomes ² or ³; any other power keeps brackets: 2^(3x), x^(2.5).
      .replace(/\^(\{2\}|2(?![\d.]))/g, '²')
      .replace(/\^(\{3\}|3(?![\d.]))/g, '³')
      .replace(/([\^_])\{([^{}]+)\}/g, '$1($2)')
      .replace(/\\text\{([^{}]*)\}/g, '$1')
      .replace(/\\sqrt\{([^{}]+)\}/g, '√($1)')
      .replace(/\\d?frac\{([^{}]+)\}\{([^{}]+)\}/g, (_, top: string, bottom: string) => `${group(top)}/${group(bottom)}`)
      // Known symbols become characters; any other command loses only its backslash (\sin → sin).
      .replace(/\\([a-zA-Z]+)/g, (_, name: string) => SYMBOLS[name] ?? name)
      .replace(/[{}]/g, '')
      .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, '$1$2')
      .replace(/^#{1,6}\s*/gm, '')
      .replace(/^\s*[-*]\s+/gm, '• ')
      .replace(/`([^`]*)`/g, '$1')
  )
}

const WRITER = `You write practice questions for high school students.
Every question has exactly one short correct answer: a number, a single word, a short expression, or a multiple-choice letter.
Keep each question under 180 characters. Write plain text only: no Markdown, no LaTeX.
Never write questions that need a diagram, questions that ask "why" or "explain", or questions that give away their own answer.`

export async function writeQuestions(
  topic: string,
  count: number,
  options: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {},
) {
  let session: Session | undefined
  try {
    session = await open(WRITER, options.signal, options.onProgress)
    const raw = await session.prompt(`Write ${count} different practice questions about: ${topic}`, {
      signal: options.signal,
      responseConstraint: {
        type: 'object',
        properties: {
          questions: { type: 'array', items: { type: 'string', maxLength: MAX_PROMPT }, minItems: count, maxItems: count },
        },
        required: ['questions'],
        additionalProperties: false,
      },
    })
    // Questions the server would cut short are dropped, so both people always see the same text.
    const questions = (JSON.parse(raw).questions as unknown[])
      .map((q) => plainText(String(q)).trim())
      .filter((q) => q && q.length <= MAX_PROMPT)
    if (!questions.length) throw new Error('The AI didn’t write any usable questions. Try a more specific topic.')
    return questions.slice(0, count)
  } catch (error) {
    throw friendly(error, Boolean(session))
  } finally {
    session?.destroy()
  }
}

const TUTOR = `You are a patient tutor for high school students.
Show how to solve the question step by step, in plain words. Number each step and keep it short.
If the student's answer is given and it is wrong, first say in one sentence what probably went wrong.
Finish with a line that starts with "Answer:". If you are not sure, say so.
Write plain text only: no Markdown, no LaTeX. Write maths like 3/4, x², √81.`

/** Streams a worked solution; onText gets the whole (cleaned) text so far on every update. */
export async function explain(
  question: string,
  studentAnswer: string | undefined,
  onText: (text: string) => void,
  options: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {},
) {
  let session: Session | undefined
  try {
    session = await open(TUTOR, options.signal, options.onProgress)
    const ask = `Question: ${question}\n${studentAnswer ? `The student's answer: ${studentAnswer}\n` : ''}Show how to do it.`
    const reader = session.promptStreaming(ask, { signal: options.signal }).getReader()
    let text = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      text += value // Chrome 148+ streams only the new part each time
      onText(plainText(text))
    }
    if (!text.trim()) throw new Error('The AI didn’t reply. Try again.')
    return plainText(text)
  } catch (error) {
    throw friendly(error, Boolean(session))
  } finally {
    session?.destroy()
  }
}
