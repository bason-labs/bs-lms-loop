// admin/admin.js — admin whitelist manager (Firebase modular SDK via CDN).
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, collection, doc, setDoc, deleteDoc, getDocs, serverTimestamp }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// Public web config (safe to commit) — from Firebase console → Project settings → Web app.
const FIREBASE_WEB_CONFIG = {
  apiKey: 'AIzaSyAlRRBg4YglYRfpC31--nWDRN-Bd9Jpd-o',
  authDomain: 'bs-llm-loop.firebaseapp.com',
  projectId: 'bs-llm-loop'
};

const app = initializeApp(FIREBASE_WEB_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = (id) => document.getElementById(id);

const normalizeEmail = (e) => String(e || '').trim().toLowerCase();
async function emailHash(email) {
  const data = new TextEncoder().encode(normalizeEmail(email));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const mask = (email) => email.replace(/^(.).*(@.*)$/, (_, a, b) => `${a}***${b}`);

$('auth-btn').addEventListener('click', async () => {
  if (auth.currentUser) await signOut(auth).catch((e) => { $('msg').textContent = e.message; });
  else signInWithPopup(auth, new GoogleAuthProvider()).catch((e) => { $('msg').textContent = e.message; });
});

onAuthStateChanged(auth, async (user) => {
  $('who').textContent = user ? user.email : '';
  $('auth-btn').textContent = user ? 'Sign out' : 'Sign in';
  $('gate').hidden = !!user;
  $('panel').hidden = !user;
  if (user) { try { await render(); } catch (e) { $('msg').textContent = `Not an admin? ${e.message}`; } }
});

$('add-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const email = normalizeEmail($('email').value);
  if (!email) return;
  $('msg').textContent = '';
  try {
    await setDoc(doc(db, 'whitelist', await emailHash(email)), {
      emailMasked: mask(email), addedBy: auth.currentUser.email, addedAt: serverTimestamp(), active: true
    });
    $('email').value = '';
    await render();
  } catch (e) { $('msg').textContent = e.message; }
});

async function render() {
  const snap = await getDocs(collection(db, 'whitelist'));
  const rows = $('rows');
  rows.innerHTML = '';
  snap.forEach((d) => {
    const v = d.data();
    const tr = document.createElement('tr');
    const when = v.addedAt?.toDate ? v.addedAt.toDate().toLocaleDateString() : '';
    const tdEmail = document.createElement('td');
    tdEmail.textContent = v.emailMasked || '(hidden)';   // textContent — never inject Firestore strings as HTML
    const tdWhen = document.createElement('td');
    tdWhen.textContent = when;
    tr.append(tdEmail, tdWhen);
    const td = document.createElement('td');
    const btn = document.createElement('button');
    btn.className = 'rm'; btn.textContent = 'Remove';
    btn.addEventListener('click', async () => {
      try { await deleteDoc(doc(db, 'whitelist', d.id)); await render(); }
      catch (e) { $('msg').textContent = e.message; }
    });
    td.appendChild(btn); tr.appendChild(td); rows.appendChild(tr);
  });
}
