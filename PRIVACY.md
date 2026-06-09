# Privacy Policy — LMS Loop

_Last updated: 2026-06-09_

LMS Loop ("the extension") is a Chrome extension that helps you progress through an
Open edX–based learning platform. This policy explains what data the extension
touches and where it goes. **In short: your data stays on your device or goes
directly to services you configure — we operate no server that collects it.**

## What the extension stores (locally)

The following are stored using Chrome's local extension storage on your own device:

- **Your settings** — playback speed, theme, language, and which LLM provider you chose.
- **Your LLM API key**, if you enter one. It is kept in local storage and used only to
  call the provider you selected. It is never sent anywhere else.
- **A local knowledge base** of readable text extracted from document lessons, kept on
  your device so you can review it.

This data never leaves your device except as described below.

## Data sent off your device (what we disclose)

The extension transmits data directly from your browser to services **you** enable.
There is no LMS Loop server in between. Two categories of data may leave your device:

- **Website content (page text) → your chosen LLM provider.** When — and only when — you
  have configured an API key and a quiz is encountered, the text of that quiz (content
  read from the lesson page) is sent to the LLM provider you selected (OpenAI, Anthropic,
  or Google Gemini) so it can be solved. No page content is sent if you do not enter an
  API key. We do not receive or store this content; it goes straight to the provider
  under your own account. See that provider's own privacy policy for how they handle it.
- **Personally identifiable information (your email) → the access gate.** For Google
  Sign-In, the extension reads your account's verified email, hashes it (SHA-256), and
  checks the hash against a public allow-list in Firebase. **Your raw email is never
  stored in Firebase** — only the hash is compared, and it is not shared with anyone else.

Document text extracted from non-quiz lessons stays in the local knowledge base on your
device and is **not** transmitted anywhere.

## What we do NOT do

- We run no analytics, no tracking, and no advertising.
- We operate **no server of our own** that receives your data — the only outbound data is
  the two user-enabled flows above, sent directly to the provider/service you chose.
- We do not sell or transfer your data to third parties for any unrelated purpose.

## Permissions, and why they're needed

- **Host access (the LMS site)** — to read each lesson and click Next so the loop can run.
- **`storage`** — to save your settings, key, and local knowledge base.
- **`identity`** — for Google Sign-In on the access gate.
- **`tabs` / `activeTab` / `scripting`** — to run the loop in the tab where you started it.

## Your choices

- You can clear all stored data at any time by removing the extension, or via the
  extension's storage controls.
- Don't enter an API key, and no quiz content is ever sent anywhere.

## Contact

Questions about this policy: open an issue at
https://github.com/bason-labs/bs-lms-loop/issues
