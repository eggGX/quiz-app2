(() => {
  const state = {
    questions: [],
    answers: [],
    currentIndex: 0,
    startTime: null,
    timerInterval: null
  };

  const elements = {
    intro: document.getElementById('intro'),
    quiz: document.getElementById('quiz'),
    result: document.getElementById('result'),
    leaderboard: document.getElementById('leaderboard'),
    form: document.getElementById('player-form'),
    nameInput: document.getElementById('player-name'),
    questionText: document.getElementById('question-text'),
    choices: document.getElementById('choices'),
    nextButton: document.getElementById('next-btn'),
    prevButton: document.getElementById('prev-btn'),
    progressBar: document.getElementById('progress-bar'),
    counter: document.getElementById('question-counter'),
    timer: document.getElementById('timer'),
    resultScore: document.getElementById('result-score'),
    resultTime: document.getElementById('result-time'),
    retryButton: document.getElementById('retry-btn'),
    refreshButton: document.getElementById('refresh-btn'),
    leaderboardBody: document.getElementById('leaderboard-body')
  };

  function formatTime(seconds) {
    const totalSeconds = Math.max(0, Math.floor(seconds));
    const mins = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const secs = String(totalSeconds % 60).padStart(2, '0');
    return `${mins}:${secs}`;
  }

  function renderTimer() {
    if (!state.startTime) {
      elements.timer.textContent = '00:00';
      return;
    }
    const elapsed = (Date.now() - state.startTime) / 1000;
    elements.timer.textContent = formatTime(elapsed);
  }

  function startTimer() {
    state.startTime = Date.now();
    renderTimer();
    state.timerInterval = setInterval(renderTimer, 500);
  }

  function stopTimer() {
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }
  }

  function updateNavigationButtons() {
    elements.prevButton.disabled = state.currentIndex === 0;
    elements.nextButton.textContent = state.currentIndex === state.questions.length - 1 ? '結果を見る' : '次の問題';
    const answered = typeof state.answers[state.currentIndex] === 'number';
    elements.nextButton.disabled = !answered;
  }

  function updateProgress() {
    const progress = ((state.currentIndex) / state.questions.length) * 100;
    elements.progressBar.style.width = `${progress}%`;
    elements.counter.textContent = `${state.currentIndex + 1} / ${state.questions.length}`;
  }

  function renderChoices(question) {
    elements.choices.innerHTML = '';

    question.choices.forEach((choiceText, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'choice';
      button.textContent = choiceText;
      button.dataset.index = index;

      if (state.answers[state.currentIndex] === index) {
        button.classList.add('selected');
      }

      button.addEventListener('click', () => {
        state.answers[state.currentIndex] = index;
        [...elements.choices.querySelectorAll('.choice')].forEach(choiceEl => choiceEl.classList.remove('selected'));
        button.classList.add('selected');
        updateNavigationButtons();
      });

      elements.choices.appendChild(button);
    });
  }

  function renderQuestion() {
    const question = state.questions[state.currentIndex];
    if (!question) {
      return;
    }

    elements.questionText.textContent = question.question;
    renderChoices(question);
    updateNavigationButtons();
    updateProgress();
  }

  async function fetchQuestions() {
    try {
      const response = await fetch('/api/quiz');
      if (!response.ok) {
        throw new Error('クイズデータを読み込めませんでした。');
      }
      const data = await response.json();
      if (!Array.isArray(data.questions) || data.questions.length === 0) {
        throw new Error('クイズデータがありません。');
      }
      state.questions = data.questions;
      state.answers = new Array(state.questions.length).fill(null);
      renderQuestion();
    } catch (error) {
      console.error(error);
      elements.questionText.textContent = 'クイズの読み込みに失敗しました。ページを再読み込みしてください。';
      elements.choices.innerHTML = '';
      elements.nextButton.disabled = true;
    }
  }

  async function fetchLeaderboard() {
    try {
      const response = await fetch('/api/leaderboard');
      if (!response.ok) {
        throw new Error('ランキングの取得に失敗しました。');
      }
      const data = await response.json();
      renderLeaderboard(data.leaderboard || []);
    } catch (error) {
      console.error(error);
    }
  }

  function renderLeaderboard(entries) {
    elements.leaderboardBody.innerHTML = '';

    if (!entries.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 5;
      cell.textContent = '記録がありません。';
      cell.className = 'muted';
      row.appendChild(cell);
      elements.leaderboardBody.appendChild(row);
      return;
    }

    entries.forEach((entry, index) => {
      const row = document.createElement('tr');

      const rankCell = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = `rank-badge rank-${index + 1}`;
      badge.textContent = index + 1;
      if (index > 2) {
        badge.className = 'rank-badge';
      }
      rankCell.appendChild(badge);

      const nameCell = document.createElement('td');
      nameCell.textContent = entry.name;

      const scoreCell = document.createElement('td');
      scoreCell.textContent = `${entry.score} / ${state.questions.length}`;

      const timeCell = document.createElement('td');
      timeCell.textContent = typeof entry.totalTime === 'number' ? `${entry.totalTime.toFixed(2)}秒` : '-';

      const dateCell = document.createElement('td');
      const date = entry.completedAt ? new Date(entry.completedAt) : null;
      dateCell.textContent = date ? date.toLocaleString('ja-JP') : '-';

      row.appendChild(rankCell);
      row.appendChild(nameCell);
      row.appendChild(scoreCell);
      row.appendChild(timeCell);
      row.appendChild(dateCell);

      elements.leaderboardBody.appendChild(row);
    });
  }

  async function submitAnswers() {
    stopTimer();
    const totalTime = (Date.now() - state.startTime) / 1000;

    try {
      const response = await fetch('/api/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          playerName: elements.nameInput.value,
          answers: state.answers,
          totalTime
        })
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        throw new Error(errorPayload.error || '送信に失敗しました。');
      }

      const data = await response.json();
      const scoreText = `スコア: ${data.score} / ${data.total}`;
      const timeText = `タイム: ${totalTime.toFixed(2)}秒`;
      elements.resultScore.textContent = scoreText;
      elements.resultTime.textContent = timeText;
      renderLeaderboard(data.leaderboard || []);
      elements.quiz.classList.add('hidden');
      elements.result.classList.remove('hidden');
      elements.leaderboard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      console.error(error);
      elements.resultScore.textContent = '送信に失敗しました。再度お試しください。';
      elements.resultTime.textContent = '';
      elements.result.classList.remove('hidden');
    }
  }

  function resetQuizState() {
    state.answers = new Array(state.questions.length).fill(null);
    state.currentIndex = 0;
    stopTimer();
    state.startTime = null;
    elements.timer.textContent = '00:00';
    elements.result.classList.add('hidden');
    elements.quiz.classList.remove('hidden');
    renderQuestion();
    startTimer();
  }

  function setupEventListeners() {
    elements.form.addEventListener('submit', (event) => {
      event.preventDefault();
      const name = elements.nameInput.value.trim();
      if (!name) {
        elements.nameInput.focus();
        return;
      }
      elements.intro.classList.add('hidden');
      elements.quiz.classList.remove('hidden');
      state.currentIndex = 0;
      state.answers = new Array(state.questions.length).fill(null);
      startTimer();
      renderQuestion();
    });

    elements.nextButton.addEventListener('click', () => {
      if (state.currentIndex === state.questions.length - 1) {
        submitAnswers();
        return;
      }
      state.currentIndex += 1;
      renderQuestion();
    });

    elements.prevButton.addEventListener('click', () => {
      if (state.currentIndex === 0) {
        return;
      }
      state.currentIndex -= 1;
      renderQuestion();
    });

    elements.retryButton.addEventListener('click', () => {
      elements.result.classList.add('hidden');
      elements.quiz.classList.remove('hidden');
      resetQuizState();
    });

    elements.refreshButton.addEventListener('click', () => {
      fetchLeaderboard();
    });
  }

  function renderQrCode() {
    const canvas = document.getElementById('qrCanvas');
    if (!canvas || typeof QRCode === 'undefined') {
      return;
    }
    const url = window.location.href;
    QRCode.toCanvas(canvas, url, { width: 120, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } }, (error) => {
      if (error) {
        console.error('QRコードの生成に失敗しました:', error);
      }
    });
  }

  async function init() {
    setupEventListeners();
    renderQrCode();
    await fetchQuestions();
    await fetchLeaderboard();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
