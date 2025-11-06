const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const questions = require('./data/questions');
const questionIdSet = new Set(questions.map(question => question.id));
const questionMap = new Map(questions.map(question => [question.id, question]));

const DEFAULT_QUESTION_COUNT = 10;

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const LEADERBOARD_PATH = path.join(__dirname, 'data', 'leaderboard.json');

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

async function readLeaderboard() {
  try {
    const data = await fs.promises.readFile(LEADERBOARD_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      await fs.promises.writeFile(LEADERBOARD_PATH, '[]', 'utf-8');
      return [];
    }
    console.error('Failed to read leaderboard:', error);
    return [];
  }
}

async function writeLeaderboard(entries) {
  const payload = JSON.stringify(entries, null, 2);
  await fs.promises.writeFile(LEADERBOARD_PATH, payload, 'utf-8');
}

function sortLeaderboard(entries) {
  return entries
    .slice()
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if (a.totalTime !== b.totalTime) {
        return a.totalTime - b.totalTime;
      }
      return new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime();
    })
    .slice(0, 25);
}

function sanitizeName(name) {
  return name.replace(/\s+/g, ' ').trim().slice(0, 32);
}

function sendJson(res, statusCode, data) {
  const payload = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload)
  });
  res.end(payload);
}

function normalizeAnswers(rawAnswers) {
  if (!Array.isArray(rawAnswers) || rawAnswers.length === 0) {
    return null;
  }

  const map = new Map();

  rawAnswers.forEach((entry, index) => {
    if (entry && typeof entry === 'object' && typeof entry.questionId === 'number' && typeof entry.choiceIndex === 'number') {
      if (!questionIdSet.has(entry.questionId) || map.has(entry.questionId)) {
        return;
      }
      map.set(entry.questionId, entry.choiceIndex);
      return;
    }

    if (typeof entry === 'number' && index < questions.length) {
      const questionId = questions[index].id;
      if (!questionIdSet.has(questionId) || map.has(questionId)) {
        return;
      }
      map.set(questionId, entry);
    }
  });

  if (map.size !== rawAnswers.length) {
    return null;
  }

  return map;
}

function shuffleQuestions(list) {
  const copy = list.map(question => ({
    ...question,
    choices: Array.isArray(question.choices) ? [...question.choices] : []
  }));

  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

function clampQuestionCount(value) {
  if (value === null || value === undefined || value === '') {
    return DEFAULT_QUESTION_COUNT;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_QUESTION_COUNT;
  }

  const truncated = Math.trunc(parsed);
  if (truncated < 1) {
    return 1;
  }

  if (truncated > questions.length) {
    return questions.length;
  }

  return truncated;
}

async function handleApiRequest(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/quiz') {
    const limit = clampQuestionCount(url.searchParams.get('limit'));
    const selected = shuffleQuestions(questions).slice(0, limit);
    sendJson(res, 200, { questions: selected, total: selected.length });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/leaderboard') {
    const leaderboard = sortLeaderboard(await readLeaderboard());
    sendJson(res, 200, { leaderboard });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/submit') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
      }
    });

    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const name = sanitizeName(payload.playerName || '');
        const answerMap = normalizeAnswers(payload.answers);
        const totalTime = typeof payload.totalTime === 'number' && payload.totalTime >= 0 ? Number(payload.totalTime) : null;

        if (!name) {
          sendJson(res, 400, { error: 'プレイヤー名を入力してください。' });
          return;
        }

        if (!answerMap || answerMap.size === 0) {
          sendJson(res, 400, { error: '回答データが不足しています。' });
          return;
        }

        const answeredQuestions = Array.from(answerMap.keys()).map(id => questionMap.get(id));
        if (answeredQuestions.some(question => !question)) {
          sendJson(res, 400, { error: '存在しない問題への回答が含まれています。' });
          return;
        }

        const totalQuestions = answeredQuestions.length;
        const score = answeredQuestions.reduce((acc, question) => {
          const selected = answerMap.get(question.id);
          if (typeof selected !== 'number') {
            return acc;
          }
          return acc + (question.answer === selected ? 1 : 0);
        }, 0);

        const leaderboard = await readLeaderboard();
        const completedAt = new Date().toISOString();
        const newEntry = {
          name,
          score,
          totalQuestions,
          totalTime: totalTime !== null ? Number(totalTime.toFixed(2)) : null,
          completedAt
        };

        const existingIndex = leaderboard.findIndex(entry => entry.name === name);
        if (existingIndex >= 0) {
          const current = leaderboard[existingIndex];
          const isBetterScore = score > current.score;
          const isFaster = score === current.score && (totalTime !== null && current.totalTime !== null) && totalTime < current.totalTime;
          if (isBetterScore || isFaster) {
            leaderboard[existingIndex] = newEntry;
          }
        } else {
          leaderboard.push(newEntry);
        }

        const sorted = sortLeaderboard(leaderboard);
        await writeLeaderboard(sorted);

        sendJson(res, 200, {
          score,
          total: totalQuestions,
          leaderboard: sorted
        });
      } catch (error) {
        console.error('Failed to handle submission:', error);
        sendJson(res, 400, { error: '送信データの形式が正しくありません。' });
      }
    });

    return true;
  }

  return false;
}

function serveStatic(req, res, url) {
  let filePath = path.join(PUBLIC_DIR, decodeURIComponent(url.pathname));
  if (url.pathname === '/' || url.pathname === '') {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }

  fs.stat(filePath, (err, stats) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    if (stats.isDirectory()) {
      const indexPath = path.join(filePath, 'index.html');
      fs.stat(indexPath, (indexErr) => {
        if (indexErr) {
          res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Forbidden');
          return;
        }
        streamFile(indexPath, res);
      });
      return;
    }

    streamFile(filePath, res);
  });
}

function streamFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || 'application/octet-stream';
  const stream = fs.createReadStream(filePath);

  stream.on('open', () => {
    res.writeHead(200, { 'Content-Type': contentType });
  });

  stream.on('error', (error) => {
    console.error('File stream error:', error);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Internal server error');
  });

  stream.pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  const handled = await handleApiRequest(req, res, url);
  if (handled) {
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    serveStatic(req, res, url);
  } else {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method not allowed');
  }
});

server.listen(PORT, () => {
  console.log(`Quiz app server running on http://localhost:${PORT}`);
});
