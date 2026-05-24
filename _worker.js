// _worker.js (Cloudflare Pages compatible version)

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, { env, ctx });
  }
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function handleRequest(request, event) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  // Static files served from root
  const staticFiles = {
    '/': 'index.html',
    '/index.html': 'index.html',
    '/style.css': 'style.css',
    '/script.js': 'script.js',
    '/login.html': 'login.html',
    '/signup.html': 'signup.html',
    '/submit.html': 'submit.html',
    '/stats.html': 'stats.html',
    '/categories.html': 'categories.html',
    '/feed.html': 'feed.html'
  };

  if (method === 'GET' && staticFiles[path]) {
    return serveStatic(staticFiles[path], request);
  }

  // API routes
  if (path.startsWith('/api/')) {
    try {
      if (path === '/api/signup' && method === 'POST') return signup(request, event);
      if (path === '/api/login' && method === 'POST') return login(request, event);
      if (path === '/api/logout' && method === 'POST') return logout(request, event);
      if (path === '/api/me' && method === 'GET') return me(request, event);

      if (path === '/api/random' && method === 'POST') return apiRandom(request, event);
      if (path === '/api/vote' && method === 'POST') return apiVote(request, event);
      if (path === '/api/skip' && method === 'POST') return apiSkip(request, event);
      if (path === '/api/stats' && method === 'GET') return apiStats(request, event);
      if (path === '/api/categories' && method === 'GET') return apiCategories(request, event);

      if (path === '/api/leaderboard' && method === 'GET') return apiLeaderboard(request, event);
      if (path === '/api/darkmode' && method === 'POST') return apiDarkmode(request, event);
      if (path === '/api/progress' && method === 'GET') return apiProgress(request, event);

      if (path === '/api/submit' && method === 'POST') return apiSubmit(request, event);
      if (path === '/api/feed' && method === 'POST') return apiFeed(request, event);

      return jsonResponse({ error: 'Not found' }, 404);
    } catch (err) {
      return jsonResponse({ error: 'Server error', detail: String(err) }, 500);
    }
  }

  return jsonResponse({ error: 'Not found' }, 404);
}

/* -----------------------
   Utilities
   ----------------------- */

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function serveStatic(filename, request) {
  try {
    const res = await fetch(new URL(filename, request.url));
    if (res.ok) return res;
  } catch (e) {}

  const fallback = {
    'index.html': '<!doctype html><meta charset="utf-8"><title>Would You Rather</title><body><h1>App</h1></body>',
    'style.css': 'body{font-family:sans-serif}',
    'script.js': 'console.log("script")',
    'login.html': '<!doctype html><meta charset="utf-8"><title>Login</title>',
    'signup.html': '<!doctype html><meta charset="utf-8"><title>Signup</title>',
    'submit.html': '<!doctype html><meta charset="utf-8"><title>Submit</title>',
    'stats.html': '<!doctype html><meta charset="utf-8"><title>Stats</title>',
    'categories.html': '<!doctype html><meta charset="utf-8"><title>Categories</title>',
    'feed.html': '<!doctype html><meta charset="utf-8"><title>Feed</title>'
  };

  const body = fallback[filename] || '';
  const contentType = filename.endsWith('.css')
    ? 'text/css'
    : filename.endsWith('.js')
    ? 'application/javascript'
    : 'text/html';

  return new Response(body, { headers: { 'Content-Type': contentType } });
}

async function parseJSON(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function makeCookie(name, value, opts = {}) {
  let cookie = `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax`;
  if (opts.maxAge) cookie += `; Max-Age=${opts.maxAge}`;
  if (opts.expires) cookie += `; Expires=${opts.expires.toUTCString()}`;
  return cookie;
}

function hashPassword(password) {
  const data = new TextEncoder().encode(password);
  return crypto.subtle.digest('SHA-256', data).then(buf =>
    Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
  );
}

async function getUserFromSession(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/session=([^;]+)/);
  if (!match) return null;
  const userId = parseInt(match[1], 10);
  if (!userId) return null;
  return await env.DB.prepare('SELECT id, username, dark_mode FROM users WHERE id = ?')
    .bind(userId)
    .first();
}

/* -----------------------
   Auth routes
   ----------------------- */

async function signup(request, event) {
  const env = event.env;
  const body = await parseJSON(request);
  const username = (body.username || '').trim();
  const password = body.password || '';
  if (!username || !password) return jsonResponse({ error: 'Missing username or password' }, 400);

  const password_hash = await hashPassword(password);
  const created_at = new Date().toISOString();

  try {
    const insert = await env.DB.prepare(
      'INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)'
    ).bind(username, password_hash, created_at).run();

    const userId = insert.lastInsertRowid;

    await env.DB.prepare(
      'INSERT INTO user_stats (user_id, total_answered, streak, last_answered_at) VALUES (?, 0, 0, NULL)'
    ).bind(userId).run();

    const cookie = makeCookie('session', String(userId), { maxAge: 60 * 60 * 24 * 30 });

    return new Response(JSON.stringify({ success: true, user: { id: userId, username } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookie }
    });
  } catch {
    return jsonResponse({ error: 'Username already exists' }, 400);
  }
}

async function login(request, event) {
  const env = event.env;
  const body = await parseJSON(request);
  const username = (body.username || '').trim();
  const password = body.password || '';

  if (!username || !password) return jsonResponse({ error: 'Missing username or password' }, 400);

  const row = await env.DB.prepare(
    'SELECT id, password_hash, username FROM users WHERE username = ?'
  ).bind(username).first();

  if (!row) return jsonResponse({ error: 'Invalid credentials' }, 401);

  const hash = await hashPassword(password);
  if (hash !== row.password_hash) return jsonResponse({ error: 'Invalid credentials' }, 401);

  const cookie = makeCookie('session', String(row.id), { maxAge: 60 * 60 * 24 * 30 });

  return new Response(JSON.stringify({ success: true, user: { id: row.id, username: row.username } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookie }
  });
}

async function logout() {
  const cookie = makeCookie('session', '', { maxAge: 0 });
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookie }
  });
}

async function me(request, event) {
  const env = event.env;
  const user = await getUserFromSession(request, env);
  if (!user) return jsonResponse({ user: null });

  const stats = await env.DB.prepare(
    'SELECT total_answered, streak, last_answered_at FROM user_stats WHERE user_id = ?'
  ).bind(user.id).first();

  return jsonResponse({ user: { id: user.id, username: user.username, dark_mode: user.dark_mode || 0, stats } });
}

/* -----------------------
   Questions + Feed
   ----------------------- */

async function apiRandom(request, event) {
  const env = event.env;
  const body = await parseJSON(request);
  const user = await getUserFromSession(request, env);

  let exclude = [];

  if (user) {
    const answered = await env.DB.prepare(
      'SELECT question_id FROM user_answers WHERE user_id = ?'
    ).bind(user.id).all();
    exclude = answered.results.map(r => r.question_id);
  } else {
    exclude = Array.isArray(body.seen) ? body.seen.map(Number) : [];
  }

  let q;
  if (exclude.length === 0) {
    q = await env.DB.prepare('SELECT * FROM questions ORDER BY RANDOM() LIMIT 1').all();
  } else {
    const placeholders = exclude.map(() => '?').join(',');
    q = await env.DB.prepare(
      `SELECT * FROM questions WHERE id NOT IN (${placeholders}) ORDER BY RANDOM() LIMIT 1`
    ).bind(...exclude).all();
  }

  const question = q.results[0];
  if (!question) return jsonResponse({ status: 'complete' });

  await env.DB.prepare(
    'INSERT INTO analytics (question_id, views, skips) VALUES (?, 1, 0) ON CONFLICT(question_id) DO UPDATE SET views = views + 1'
  ).bind(question.id).run().catch(() => {});

  return jsonResponse({ question });
}

async function apiFeed(request, event) {
  const env = event.env;
  const body = await parseJSON(request);
  const limit = Math.min(50, Math.max(1, parseInt(body.limit || 10)));

  const user = await getUserFromSession(request, env);
  let exclude = [];

  if (user) {
    const answered = await env.DB.prepare(
      'SELECT question_id FROM user_answers WHERE user_id = ?'
    ).bind(user.id).all();
    exclude = answered.results.map(r => r.question_id);
  } else {
    exclude = Array.isArray(body.seen) ? body.seen.map(Number) : [];
  }

  let rows;
  if (exclude.length === 0) {
    rows = await env.DB.prepare('SELECT * FROM questions ORDER BY RANDOM() LIMIT ?')
      .bind(limit)
      .all();
  } else {
    const placeholders = exclude.map(() => '?').join(',');
    rows = await env.DB.prepare(
      `SELECT * FROM questions WHERE id NOT IN (${placeholders}) ORDER BY RANDOM() LIMIT ?`
    ).bind(...exclude, limit).all();
  }

  return jsonResponse({ questions: rows.results });
}

/* -----------------------
   Voting + Skipping
   ----------------------- */

async function apiVote(request, event) {
  const env = event.env;
  const body = await parseJSON(request);
  const question_id = parseInt(body.question_id);
  const choice = body.choice === 'a' ? 'a' : 'b';

  if (!question_id) return jsonResponse({ error: 'Missing question_id' }, 400);

  if (choice === 'a') {
    await env.DB.prepare('UPDATE questions SET votes_a = votes_a + 1 WHERE id = ?')
      .bind(question_id)
      .run();
  } else {
    await env.DB.prepare('UPDATE questions SET votes_b = votes_b + 1 WHERE id = ?')
      .bind(question_id)
      .run();
  }

  await env.DB.prepare(
    'INSERT INTO analytics (question_id, views, skips) VALUES (?, 0, 0) ON CONFLICT(question_id) DO NOTHING'
  ).bind(question_id).run().catch(() => {});

  const user = await getUserFromSession(request, env);
  if (user) {
    const created_at = new Date().toISOString();
    await env.DB.prepare(
      'INSERT INTO user_answers (user_id, question_id, choice, created_at) VALUES (?, ?, ?, ?)'
    ).bind(user.id, question_id, choice, created_at).run();

    const stats = await env.DB.prepare(
      'SELECT total_answered, streak, last_answered_at FROM user_stats WHERE user_id = ?'
    ).bind(user.id).first();

    const now = new Date();
    let newStreak = 1;

    if (stats?.last_answered_at) {
      const last = new Date(stats.last_answered_at);
      const diff = Math.floor((now - last) / (1000 * 60 * 60 * 24));

      if (diff === 0) newStreak = stats.streak;
      else if (diff === 1) newStreak = stats.streak + 1;
    }

    await env.DB.prepare(
      'UPDATE user_stats SET total_answered = ?, streak = ?, last_answered_at = ? WHERE user_id = ?'
    ).bind((stats.total_answered || 0) + 1, newStreak, now.toISOString(), user.id).run();
  }

  const q = await env.DB.prepare(
    'SELECT votes_a, votes_b FROM questions WHERE id = ?'
  ).bind(question_id).first();

  const a = q.votes_a || 0;
  const b = q.votes_b || 0;
  const total = a + b || 1;

  return jsonResponse({
    success: true,
    votes: {
      a,
      b,
      percentA: Math.round((a / total) * 100),
      percentB: Math.round((b / total) * 100)
    }
  });
}

async function apiSkip(request, event) {
  const env = event.env;
  const body = await parseJSON(request);
  const question_id = parseInt(body.question_id);

  if (!question_id) return jsonResponse({ error: 'Missing question_id' }, 400);

  await env.DB.prepare(
    'INSERT INTO analytics (question_id, views, skips) VALUES (?, 0, 1) ON CONFLICT(question_id) DO UPDATE SET skips = skips + 1'
  ).bind(question_id).run().catch(() => {});

  return jsonResponse({ success: true });
}

/* -----------------------
   Stats + Categories
   ----------------------- */

async function apiStats(request, event) {
  const env = event.env;
  const q = await env.DB.prepare(
    'SELECT id, option_a, option_b, votes_a, votes_b, category FROM questions ORDER BY id DESC LIMIT 100'
  ).all();
  return jsonResponse({ questions: q.results });
}

async function apiCategories(request, event) {
  const env = event.env;
  const rows = await env.DB.prepare('SELECT DISTINCT category FROM questions').all();
  return jsonResponse({ categories: rows.results.map(r => r.category) });
}

/* -----------------------
   Leaderboard + Darkmode + Progress + Submit
   ----------------------- */

async function apiLeaderboard(request, event) {
  const env = event.env;
  const rows = await env.DB.prepare(
    'SELECT u.id, u.username, s.total_answered, s.streak FROM users u JOIN user_stats s ON u.id = s.user_id ORDER BY s.total_answered DESC, s.streak DESC LIMIT 50'
  ).all();
  return jsonResponse({ leaderboard: rows.results });
}

async function apiDarkmode(request, event) {
  const env = event.env;
  const body = await parseJSON(request);
  const enabled = body.enabled ? 1 : 0;

  const user = await getUserFromSession(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);

  await env.DB.prepare('UPDATE users SET dark_mode = ? WHERE id = ?')
    .bind(enabled, user.id)
    .run();

  return jsonResponse({ success: true, dark_mode: enabled });
}

async function apiProgress(request, event) {
  const env = event.env;
  const user = await getUserFromSession(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);

  const rows = await env.DB.prepare(
    'SELECT question_id, choice, created_at FROM user_answers WHERE user_id = ?'
  ).bind(user.id).all();

  return jsonResponse({
    seen: rows.results.map(r => r.question_id),
    answers: rows.results
  });
}

async function apiSubmit(request, event) {
  const env = event.env;
  const body = await parseJSON(request);

  const option_a = (body.option_a || '').trim();
  const option_b = (body.option_b || '').trim();
  const category = (body.category || 'general').trim();

  if (!option_a || !option_b) return jsonResponse({ error: 'Missing options' }, 400);

  const user = await getUserFromSession(request, env);
  const user_id = user ? user.id : null;

  const created_at = new Date().toISOString();

  await env.DB.prepare(
    'INSERT INTO user_submissions (user_id, option_a, option_b, category, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(user_id, option_a, option_b, category, created_at).run();

  const insert = await env.DB.prepare(
    'INSERT INTO questions (option_a, option_b, category, votes_a, votes_b) VALUES (?, ?, ?, 0, 0)'
  ).bind(option_a, option_b, category).run();

  return jsonResponse({ success: true, question_id: insert.lastInsertRowid });
}

/* -----------------------
   End of file
   ----------------------- */
