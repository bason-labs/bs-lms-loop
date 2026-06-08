// lib/auth.js — Google sign-in + Firestore whitelist check (ES module: background + popup).
import { FIREBASE_PROJECT_ID } from '../config/app_config.js';

// ---- pure helpers (unit-tested) ----
export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export async function emailHash(email) {
  const data = new TextEncoder().encode(normalizeEmail(email));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function parseUserinfo(json) {
  return json && json.email ? normalizeEmail(json.email) : null;
}

export function whitelistDocUrl(projectId, hash) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/whitelist/${hash}`;
}

export function parseWhitelistDoc(status, json) {
  if (status === 200 && json && json.fields) {
    const active = json.fields.active ? json.fields.active.booleanValue !== false : true;
    return { allowed: active };
  }
  return { allowed: false };
}

// ---- browser-only (chrome.identity + fetch) ----
export function getAuthToken(interactive = true) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      const err = chrome.runtime.lastError;
      if (err || !token) return reject(new Error(err?.message || 'no auth token'));
      resolve(token);
    });
  });
}

export async function getGoogleEmail(interactive = true) {
  const token = await getAuthToken(interactive);
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    chrome.identity.removeCachedAuthToken?.({ token });
    throw new Error(`userinfo HTTP ${res.status}`);
  }
  return parseUserinfo(await res.json());
}

export async function checkAccess(interactive = true) {
  const email = await getGoogleEmail(interactive);
  if (!email) return { allowed: false, email: null };
  const hash = await emailHash(email);
  const res = await fetch(whitelistDocUrl(FIREBASE_PROJECT_ID, hash));
  const json = await res.json().catch(() => null);
  return { ...parseWhitelistDoc(res.status, json), email };
}

export function signOut() {
  return new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (chrome.runtime.lastError || !token) return resolve();
      chrome.identity.removeCachedAuthToken({ token }, () => {
        fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`).finally(resolve);
      });
    });
  });
}
