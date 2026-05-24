// script.js - frontend logic
const api = path => `/api/${path.replace(/^\/+/, '')}`;
let currentQuestion = null;
let seenGuest = JSON.parse(localStorage.getItem('seen_questions') || '[]');
let user = null;

async function init() {
  await fetchMe();
  setupDarkMode();
  document.getElementById('darkToggle').addEventListener('click', toggleDark);
  document.getElementById('btnA').addEventListener('click', () => vote('a'));
  document.getElementById('btnB').addEventListener('click', () => vote('b'));
  document.getElementById('skipBtn').addEventListener('click', skip);
  document.getElementById('shareBtn').addEventListener('click', share);
  if (!user) {
    loadRandomGuest();
  } else {
    loadRandomUser();
    document.getElementById('authLink').textContent = 'Logout';
    document.getElementById('authLink').href = '#';
    document.getElementById('authLink').addEventListener('click', async (e) => {
      e.preventDefault();
      await fetch('/api/logout', { method: 'POST' });
      location.reload();
    });
  }
}

async function fetchMe() {
  try {
    const res = await fetch('/api/me');
    const data = await res.json();
    user = data.user;
  } catch (e) {
    user = null;
  }
}

function setupDarkMode() {
  const root = document.documentElement;
  const saved = user ? null : localStorage.getItem('dark_mode');
  if (user) {
    if (user.dark_mode) root.setAttribute('data-theme', 'dark');
  } else if (saved === '1') {
    root.setAttribute('data-theme', 'dark');
  }
}

async function toggleDark() {
  const root = document.documentElement;
  const isDark = root.getAttribute('data-theme') === 'dark';
  if (isDark) {
    root.removeAttribute('data-theme');
    if (user) await fetch('/api/darkmode', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ enabled: 0 }) });
    else localStorage.setItem('dark_mode', '0');
  } else {
    root.setAttribute('data-theme', 'dark');
    if (user) await fetch('/api/darkmode', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ enabled: 1 }) });
    else localStorage.setItem('dark_mode', '1');
  }
}

async function loadRandomGuest() {
  const res = await fetch('/api/random', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ seen: seenGuest })
  });
  const data = await res.json();
  if (data.status === 'complete') {
    showComplete();
    return;
  }
  renderQuestion(data.question);
}

async function loadRandomUser() {
  const res = await fetch('/api/random', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({}) });
  const data = await res.json();
  if (data.status === 'complete') {
    showComplete();
    return;
  }
  renderQuestion(data.question);
}

function renderQuestion(q) {
  currentQuestion = q;
  document.getElementById('category').textContent = q.category || 'General';
  document.getElementById('questionText').textContent = `${q.option_a} OR ${q.option_b}`;
  document.getElementById('btnA').textContent = q.option_a;
  document.getElementById('btnB').textContent = q.option_b;
  updatePercent(q.votes_a || 0, q.votes_b || 0);
}

function updatePercent(a, b) {
  const total = (a + b) || 1;
  const pA = Math.round((a / total) * 100);
  const pB = 100 - pA;
  const elA = document.getElementById('percentA');
  const elB = document.getElementById('percentB');
  elA.style.width = pA + '%';
  elB.style.width = pB + '%';
  elA.textContent = pA + '%';
  elB.textContent = pB + '%';
}

async function vote(choice) {
  if (!currentQuestion) return;
  const payload = { question_id: currentQuestion.id, choice };
  const res = await fetch('/api/vote', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
  const data = await res.json();
  if (data.success) {
    updatePercent(data.votes.a, data.votes.b);
    markSeen(currentQuestion.id);
    await nextQuestionSmooth();
  }
}

async function skip() {
  if (!currentQuestion) return;
  await fetch('/api/skip', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ question_id: currentQuestion.id }) });
  markSeen(currentQuestion.id);
  await nextQuestionSmooth();
}

function markSeen(id) {
  if (user) return; // server stores progress for logged-in users
  if (!seenGuest.includes(id)) {
    seenGuest.push(id);
    localStorage.setItem('seen_questions', JSON.stringify(seenGuest));
  }
}

async function nextQuestionSmooth() {
  const card = document.getElementById('card');
  card.classList.remove('fade-in');
  card.style.opacity = 0;
  await new Promise(r => setTimeout(r, 220));
  if (user) await loadRandomUser();
  else await loadRandomGuest();
  card.classList.add('fade-in');
}

function showComplete() {
  document.getElementById('questionText').textContent = 'You have seen all questions. Check back later!';
  document.getElementById('btnA').style.display = 'none';
  document.getElementById('btnB').style.display = 'none';
  document.getElementById('skipBtn').style.display = 'none';
}

function share() {
  if (!currentQuestion) return;
  const text = `${currentQuestion.option_a} OR ${currentQuestion.option_b} — Play at ${location.origin}`;
  if (navigator.share) {
    navigator.share({ title: 'Would You Rather', text, url: location.href }).catch(()=>{});
  } else {
    navigator.clipboard.writeText(text).then(()=> alert('Copied to clipboard'));
  }
}

window.addEventListener('load', init);
