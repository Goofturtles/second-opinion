import { Panel, PILL_OUTLINE, PILL_SOLID } from './Panel'

// The reading panels behind the nav links and the "how" / "cheating" pills. Every claim here is
// something the app actually does (see server/api.ts); keep them in step.

type Props = { onClose: () => void }

function Actions() {
  return (
    <div className="mt-10 flex flex-wrap gap-2">
      <a href="#start" className={PILL_SOLID}>
        Start a set
      </a>
      <a href="#join" className={PILL_OUTLINE}>
        Join with a code
      </a>
      <a href="#start/ai" className={PILL_OUTLINE}>
        Make a set with AI
      </a>
    </div>
  )
}

const STEPS = [
  ['Make a set', 'Name it after the homework, like “Ch. 7, p. 212”, and type your answers. You get a five-letter code.'],
  ['Send the code to one friend', 'Just one. They type their own answers to the same questions, on their own device.'],
  ['See only where you differ', 'Second Opinion lines the two sets up and tells you both the question numbers that don’t match. Nothing else, ever.'],
]

export function HowItWorks({ onClose }: Props) {
  return (
    <Panel title="How it works" onClose={onClose}>
      <ol className="space-y-8">
        {STEPS.map(([title, body], i) => (
          <li key={title} className="flex gap-5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-[15px] leading-none text-black">
              {i + 1}
            </span>
            <div>
              <p className="text-[21px] leading-snug text-white" style={{ fontFamily: 'var(--font-heading)' }}>
                {title}
              </p>
              <p className="mt-1">{body}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-10 border-t border-white/15 pt-6 text-[16px]">
        Answers that mean the same thing count as the same: 3/4 and 0.75 match, so do “x = 5” and 5. Everything
        else has to match exactly, so a wrong sign gets flagged.
      </p>
      <Actions />
    </Panel>
  )
}

export function NotCheating({ onClose }: Props) {
  return (
    <Panel title="Why this isn’t cheating" onClose={onClose}>
      <p>
        <span className="text-white">What happens now:</span> someone posts a photo of the whole page in the group
        chat, and half the class copies it, mistakes included.
      </p>
      <p className="mt-5">
        <span className="text-white">With Second Opinion:</span> nobody ever sees anybody’s answers. You get
        “recheck Q3”, and you still have to find the mistake yourself.
      </p>
      <p className="mt-5">
        It can’t tell who’s right, and that’s on purpose. A flag means “look again”, not “copy your friend”.
      </p>
      <p className="mt-5">
        And it can’t be gamed: answers lock the moment you submit them, and a set holds exactly two people, so
        nobody can change an answer and re-check to work out what the other person put. The “how to do it”
        help only appears after that lock.
      </p>
      <Actions />
    </Panel>
  )
}

export function Privacy({ onClose }: Props) {
  return (
    <Panel title="Privacy" onClose={onClose}>
      <dl className="space-y-6">
        {[
          ['What’s kept', 'The set’s name, its questions if they were written out (practice and AI-written sets), and each person’s answers, only so they can be compared.'],
          ['Who sees answers', 'Nobody. The comparison happens on the server, and the only thing it ever sends back is which question numbers differ. Your friend never receives your answers, and you never receive theirs.'],
          ['For how long', 'Sets are deleted 48 hours after they’re made.'],
          ['What isn’t asked for', 'No account, no name, no email. A set is just a code.'],
          ['The AI', 'Writing questions and showing how to do one both use the AI built into Chrome, on your own device. What you ask it never goes to Second Opinion or anywhere else. Questions it writes for a set are saved with the set, like any other question.'],
        ].map(([term, detail]) => (
          <div key={term}>
            <dt className="text-white">{term}</dt>
            <dd className="mt-1">{detail}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  )
}

export function Teachers({ onClose }: Props) {
  return (
    <Panel title="For teachers" onClose={onClose}>
      <p>You can’t stop students checking with each other. You can change what they share.</p>
      <ul className="mt-6 space-y-4">
        {[
          'Students never see each other’s answers, only which question numbers differ.',
          'The fixing still happens in their own head: a flag says where, never what.',
          'It works with any worksheet or textbook page. Nothing to set up, nothing to grade, no student accounts.',
        ].map((point) => (
          <li key={point} className="border-t border-white/15 pt-4">
            {point}
          </li>
        ))}
      </ul>
    </Panel>
  )
}

const FAQS = [
  ['Can I see what my friend put?', 'No. Not before you answer, not after. You only ever see question numbers.'],
  ['What if we’re both wrong?', 'If you made the same mistake, it won’t be flagged. Matching isn’t proof you’re right; it only means you agree.'],
  ['Can I change an answer after checking?', 'No. Answers lock when you submit, so nobody can change one and re-check to work out the other person’s answer.'],
  ['Does it work for essays?', 'No. It’s for short answers: numbers, single words, equations and multiple-choice letters.'],
  ['Does 0.75 count as the same as 3/4?', 'Yes. Fractions, decimals and mixed numbers become the same number first, and “x = 5” counts as 5. Rounded answers don’t match exact ones, so 0.33 and 1/3 get flagged.'],
  ['Why only one friend?', 'Two people are enough to catch a slip, and few enough that it never turns into an answer-sharing group.'],
  ['Can the AI just give me the answer?', 'Only after you’ve both submitted. Answers are locked by then, so it’s a tutor for afterwards, not a way to fix an answer before comparing.'],
  ['No worksheet to check?', 'Tap “Make questions with AI” when you start a set: type a topic and it writes practice questions for both of you.'],
  ['Can I try it alone?', 'Yes: join with the code 4K2P9. It’s a practice set with a pretend friend who got one question wrong.'],
]

export function Faq({ onClose }: Props) {
  return (
    <Panel title="FAQ" onClose={onClose}>
      <div className="divide-y divide-white/15 border-y border-white/15">
        {FAQS.map(([q, a]) => (
          <details key={q} className="group py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-white [&::-webkit-details-marker]:hidden">
              {q}
              <span
                aria-hidden="true"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/30 text-[16px] leading-none transition-transform duration-300 group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <p className="mt-2">{a}</p>
          </details>
        ))}
      </div>
    </Panel>
  )
}
