# Second Opinion

**Check homework with a friend without copying.** You and a friend each type your own answers to the same homework. Second Opinion shows you only *which question numbers you disagree on*. It never shows either of you the other's answers.

Live: https://goofturtles.github.io/second-opinion/

Built for the [CSC Back-to-School Hackathon](https://csc-back-to-school.devpost.com/).

## How it works

1. **Start a set.** Name the homework, type your answers, or press **Make a set with AI** to have practice questions written for you. You get a five-letter code.
2. **Send the code to one friend.** They type their own answers.
3. **See where you differ.** Both of you see "Recheck Q2 and Q4". You never see their answers, so the fixing is still yours.
4. **Learn the ones you missed.** Once answers are locked, tap any question to have the AI built into Chrome walk you through how to do it.

Want to try it alone? Use the practice set **4K2P9**, where a pretend friend has already answered.

## Why it isn't cheating

- No response from the server ever contains anyone's answers, only a verdict per question.
- Answers lock as soon as they're submitted, so nobody can change one and re-check to fish for the other person's answer.
- A set holds exactly two people, and it's deleted 48 hours after it's made.
- The AI explanations only unlock after both answers are locked in.

## The AI

"Make a set with AI" and "how to do it" use **Chrome's built-in AI (Gemini Nano, through the Prompt API)**. It runs on your own device, is free, and nothing you type is sent anywhere. It needs desktop Chrome 148 or newer on hardware that can run it. The first time, Chrome downloads the model (a few GB), and the page asks before starting that download. In other browsers the rest of the site still works, and the AI buttons explain what's needed.

## The character

The character's head follows your cursor, his eyes track it, and he blinks. The face is a single frame from the AI-generated hero video that came with the design spec (I didn't make that artwork). It was re-posed at 63 head angles with [LivePortrait](https://github.com/KwaiVGI/LivePortrait) in ComfyUI, and the difference between the poses was baked into a motion map that a small WebGL shader uses to warp the frame live. The scripts are in `tools/`.

## Run it yourself

Needs Node 24 or newer.

```bash
npm install
npm run dev        # site + API on http://localhost:3532
npm test           # API, comparison and text-cleanup tests
npm run build && npm start   # production server on http://localhost:3533
```

The production server (`server/index.ts`) reads these environment variables, all optional:

| Variable | What it does |
| --- | --- |
| `PORT` | Port to listen on (default 3533) |
| `DATA_FILE` | Keep sets in a JSON file across restarts |
| `REDIS_URL` | Keep sets in Redis/Key Value instead (for hosts whose disk is wiped on restart) |
| `TRUST_PROXY=n` | Rate-limit by the visitor's address as reported by the *n* proxies in front (3 on Render) |
| `ALLOWED_ORIGINS` | Comma-separated sites allowed to call the API from another origin |

The live site is on GitHub Pages; the API runs on Render's free plan, so the first request after a quiet spell can take up to a minute while it wakes. The practice set, the character and the AI all work without it.

## Made with

React, TypeScript, Vite and Tailwind CSS, with a small Node server. The code was written with help from **Claude Code** (Anthropic's AI coding assistant), which I directed and tested throughout. The on-device AI features use Chrome's built-in Gemini Nano.
