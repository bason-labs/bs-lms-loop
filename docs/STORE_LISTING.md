# Chrome Web Store — Listing Copy

Paste these into the Developer Dashboard fields. Edit to taste before submitting.

---

## Name
LMS Loop

## Summary (≤ 132 chars)
Auto-progress your Open edX lessons: play videos to completion, archive docs, and advance — hands-free.

## Category
Productivity

## Language
English (add Vietnamese — the popup is already localized EN/VI)

---

## Detailed description

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

Built for Open edX–based platforms. Open source, zero dependencies.

Privacy policy: <YOUR_HOSTED_PRIVACY_URL>
Source: https://github.com/bason-labs/bs-lms-loop

---

## Permission justifications (Privacy practices tab)

Copy each justification next to its permission in the dashboard.

| Item | Justification to paste |
|------|------------------------|
| Host access (`<all_urls>`) | Content scripts must read each lesson and click Next on the Open edX site, including its cross-origin lesson iframe, to advance the course. (To narrow review scope, scope this to your LMS domain instead — see docs/DEPLOY.md.) |
| `api.openai.com`, `api.anthropic.com`, `generativelanguage.googleapis.com` | The background service worker sends quiz content to the LLM provider the user configured with their own API key. Page CSP blocks these calls from content scripts, so they run in the background. |
| `accounts.google.com`, `www.googleapis.com`, `firestore.googleapis.com` | Google Sign-In access gate: verify the user's email and check its SHA-256 hash against a public allow-list in Firestore. Raw email is never stored remotely. |
| `storage` | Save user settings, the (local-only) API key, and the extracted document knowledge base on the user's device. |
| `identity` | Obtain a Google auth token for the sign-in gate. |
| `tabs`, `activeTab`, `scripting` | Bind the loop to the tab where the user clicked Start, and inject/run the progression logic there. |

**Remote code:** No. All code is bundled in the package; no remote scripts are loaded.
**Data usage disclosures:** Authentication info (email, used locally/hashed) — not sold,
not transferred. No data sold to third parties.

---

## Single purpose (required field)
Automate progression through an Open edX course by handling each
lesson type and advancing to the next.

## Screenshots to capture (1280×800)
1. The popup (start controls + speed + theme).
2. The loop running on a lesson (cursor/badge visible).
3. The sign-in gate.
4. (Optional) Quiz-solving or the knowledge base view.
