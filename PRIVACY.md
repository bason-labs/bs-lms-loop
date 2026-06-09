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

## Data sent to third parties

The extension sends data directly from your browser to services **you** enable:

- **LLM providers (OpenAI, Anthropic, or Google Gemini)** — only when you configure an
  API key and a quiz is encountered. Quiz content is sent to the provider you chose so
  it can be solved. No LLM calls are made without your API key. See that provider's own
  privacy policy for how they handle the request.
- **Google Sign-In (Google Identity / Firebase)** — used for the access gate. The
  extension reads your account's verified email, hashes it (SHA-256), and checks the
  hash against a public allow-list in Firebase. **Your raw email is never stored in
  Firebase**; only the hash is compared. Your email is not shared with any other party.

## What we do NOT collect

- We run no analytics, no tracking, and no advertising.
- We operate no backend that receives your browsing data, page content, or keys.
- We do not sell or transfer your data to anyone.

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
