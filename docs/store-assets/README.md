# Chrome Web Store — assets & product details

Everything to fill the dashboard. Graphic PNGs are in this folder; regenerate with
`bash build/render-store-assets.sh` (edits live in `build/make-store-assets.mjs`).

## Graphic assets — what goes where

| Dashboard field | Required | File | Size |
|-----------------|----------|------|------|
| Store icon | ✅ | `icons/icon128.png` | 128×128 |
| Screenshot 1 | ✅ (≥1) | `01-overview.png` | 1280×800 |
| Screenshot 2 | optional | `02-quizzes.png` | 1280×800 |
| Screenshot 3 | optional | `03-signin.png` | 1280×800 |
| Small promo tile | optional | `promo-small.png` | 440×280 |
| Marquee promo tile | optional | `promo-marquee.png` | 1400×560 |

> Screenshots are brand mockups of the actual popup UI. If review prefers literal
> captures, load the unpacked extension and screenshot the live popup at 1280×800.

---

## Product details (copy-paste)

**Name**
```
LMS Loop
```

**Short description** (≤132 chars)
```
Auto-progress your Open edX lessons: play videos to completion, archive docs, and advance — hands-free.
```

**Category:** Productivity  •  **Language:** English (add Vietnamese — popup is bilingual)

**Detailed description**
```
LMS Loop helps you move through an Open edX–based course without babysitting every
lesson. It detects what each lesson is and handles it:

• Videos — plays through until the platform records a real completion, then advances.
• Documents — extracts the readable text into a local knowledge base for review.
• Quizzes — solves them with your own LLM key (OpenAI, Anthropic, or Gemini), or
  skips them when no key is set.

It also navigates from a course overview straight to your first incomplete lesson, and
verifies each unit is marked complete before moving on.

Your data stays yours: settings, any API key, and the extracted knowledge base are kept
locally on your device. No analytics, no tracking, no backend collecting your activity.

Open source, zero dependencies.

Privacy policy: <YOUR_HOSTED_PRIVACY_URL>
Source: https://github.com/bason-labs/bs-lms-loop
```

**Single purpose**
```
Automate progression through an Open edX course by handling each lesson type and
advancing to the next.
```

---

## Privacy practices tab — permission justifications

| Item | Justification |
|------|---------------|
| Host access (`<all_urls>`) | Content scripts must read each lesson and click Next on the Open edX site, including its cross-origin lesson iframe, to advance the course. |
| `api.openai.com`, `api.anthropic.com`, `generativelanguage.googleapis.com` | The background worker sends quiz content to the LLM provider the user configured with their own API key (page CSP blocks these from content scripts). |
| `accounts.google.com`, `www.googleapis.com`, `firestore.googleapis.com` | Google sign-in gate: verify the user's email and check its SHA-256 hash against a public allow-list. Raw email is never stored remotely. |
| `storage` | Save settings, the local-only API key, and the extracted document knowledge base. |
| `identity` | Obtain a Google auth token for the sign-in gate. |
| `tabs`, `activeTab`, `scripting` | Bind the loop to the tab where the user clicked Start and run the logic there. |

- **Remote code:** No — all code is bundled in the package.
- **Data usage:** Authentication email (used locally / hashed). Not sold, not transferred.
