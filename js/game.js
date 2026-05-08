import { fetchRandomArticle, fetchArticleById } from './wiki.js';

// Game State
let currentState = {
    targetArticle: null,
    words: [],      // Array of objects { text: "Word", clean: "word", revealed: false, id: 0 }
    titleWords: [], // Array of cleaning title words
    guesses: new Set(),
    startTime: 0,
    mode: 'solo', // 'solo', 'daily', 'multiplayer'
    stats: {
        attempts: 0,
        foundCount: 0
    }
};

// Common French stop words (optional, if we want to reveal them, but prompt says ALL masked. 
// However, most games reveal very short words or simple connectors. We will stick to strict mode first).
// We might auto-reveal punctuation.

const WORD_REGEX = /[a-zA-Z0-9àâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ]+|[^a-zA-Z0-9àâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ]+/g;
const ALPHANUMERIC = /^[a-zA-Z0-9àâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ]+$/;

export async function initGame(mode, articleId = null) {
    currentState.mode = mode;
    resetUI();

    // Show Loading
    document.getElementById('main-container').innerHTML = `<div class="glass wiki-content" style="text-align:center;">Chargement de la mission...</div>`;

    let article;
    if (mode === 'solo') {
        article = await fetchRandomArticle();
    } else if (mode === 'daily') {
        // In a real app, fetch ID from Firestore. Using a hash-based daily ID for demo without backend.
        // For now, let's just fetch a random one to simulate logic or hardcode one for testing if requested.
        // I will implement a 'fake' daily logical generator in main.js actually.
        // If articleId is passed (from Main), use it.
        if (articleId) {
            article = await fetchArticleById(articleId);
        } else {
            // Fallback
            article = await fetchRandomArticle();
        }
    }

    if (!article) {
        alert("Erreur de chargement. Réessayez.");
        return;
    }

    startLevel(article);
}

function startLevel(article) {
    currentState.targetArticle = article;
    currentState.guesses = new Set();
    currentState.stats = { attempts: 0, foundCount: 0 };
    currentState.startTime = Date.now();

    // Process Title
    currentState.titleWords = article.title.match(WORD_REGEX)
        .filter(w => ALPHANUMERIC.test(w))
        .map(w => normalize(w));

    // Process Text
    const rawTokens = article.text.match(WORD_REGEX) || [];
    currentState.words = rawTokens.map((token, index) => {
        const isWord = ALPHANUMERIC.test(token);
        return {
            id: index,
            text: token,
            clean: isWord ? normalize(token) : null,
            isWord: isWord,
            revealed: !isWord // Punctuation always revealed
        };
    });

    renderGame();
    document.getElementById('game-controls').classList.remove('hidden');

    // Start Timer UI Update
    if (window.gameTimer) clearInterval(window.gameTimer);
    window.gameTimer = setInterval(updateTimer, 1000);
}

function normalize(str) {
    return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function renderGame() {
    const container = document.getElementById('main-container');
    container.innerHTML = '';

    // Title Section (Hiddden)
    const titleEl = document.createElement('h1');
    titleEl.className = 'wiki-title';
    // We mask the title logic separately or treat it as special. 
    // Usually game hides title completely or shows masked version.
    // Let's Mask it.
    titleEl.innerHTML = currentState.targetArticle.title.split(' ').map(word => {
        const isWord = ALPHANUMERIC.test(word);
        if (!isWord) return word;

        // Check if revealed (if all title words found, or specific word found)
        // For strict game: Title is revealed only at the end.
        // OR: Title shares words with body? Usually yes.
        // Let's check if this word has been guessed.
        const clean = normalize(word);
        const isRevealed = currentState.guesses.has(clean);

        return isRevealed
            ? `<span class="wiki-word revealed">${word}</span>`
            : `<span class="wiki-word hidden" data-len="${word.length}">????</span>`; // Use placeholder to keep layout stable-ish or blocks
    }).join(' ');
    container.appendChild(titleEl);

    // Body Text
    const contentBox = document.createElement('div');
    contentBox.className = 'glass wiki-content';

    // Fragment for performance
    const fragment = document.createDocumentFragment();

    currentState.words.forEach(wordObj => {
        const span = document.createElement('span');

        if (!wordObj.isWord) {
            span.textContent = wordObj.text;
        } else {
            if (wordObj.revealed) {
                span.textContent = wordObj.text;
                span.className = 'wiki-word revealed';
            } else {
                span.className = 'wiki-word hidden';
                span.textContent = 'x'.repeat(wordObj.text.length); // Visual placeholder
                span.dataset.clean = wordObj.clean;
                span.dataset.len = wordObj.text.length;
                span.onclick = handleWordClick;
            }
        }
        fragment.appendChild(span);
    });

    contentBox.appendChild(fragment);
    container.appendChild(contentBox);

    updateStats();
}

/**
 * Handle user click on a hidden word (Help feature)
 */
function handleWordClick(e) {
    const span = e.target;
    if (span.classList.contains('revealed')) return;

    const len = span.dataset.len;
    const originalText = span.textContent;

    // Show length temporarily
    span.textContent = `${len}`;
    span.style.color = 'var(--accent)';
    span.style.background = 'white';

    setTimeout(() => {
        if (!span.classList.contains('revealed')) {
            span.textContent = originalText;
            span.style.color = '';
            span.style.background = '';
        }
    }, 3000);
}

/**
 * Handle Guess Submission
 */
export function handleGuess(rawInput) {
    if (!rawInput || !currentState.targetArticle) return;

    const cleanInput = normalize(rawInput.trim());
    if (cleanInput.length === 0) return;

    // Check if already guessed
    if (currentState.guesses.has(cleanInput)) {
        // Maybe highlight existing words?
        highlightWords(cleanInput);
        return;
    }

    currentState.guesses.add(cleanInput);
    currentState.stats.attempts++;

    let hitCount = 0;
    let newReveal = false;

    // Check Body Words
    currentState.words.forEach(w => {
        if (w.isWord && w.clean === cleanInput && !w.revealed) {
            w.revealed = true;
            hitCount++;
            currentState.stats.foundCount++;
            newReveal = true;
        }
    });

    // Check Title Match (Winning Condition Check)
    // If input matches the FULL title normalized
    const cleanTitle = normalize(currentState.targetArticle.title);
    if (cleanInput === cleanTitle || checkAllTitleWordsFound()) {
        winGame();
        return;
    }

    // Check partial title match
    const titleWords = currentState.targetArticle.title.match(WORD_REGEX);
    // (Logic for title reveal handles itself in render if we map consistency)

    if (newReveal) {
        renderGame(); // Re-render to show new words
        // Highlight logic
        setTimeout(() => highlightWords(cleanInput), 100);
    }

    updateStats();
    return { hitCount, newReveal };
}

function checkAllTitleWordsFound() {
    // Simple check: are all title words in guesses?
    return currentState.titleWords.every(w => currentState.guesses.has(w));
}

function highlightWords(cleanWord) {
    const elements = document.querySelectorAll('.wiki-word.revealed');
    elements.forEach(el => {
        if (normalize(el.textContent) === cleanWord) {
            el.classList.add('highlight-match');
            setTimeout(() => el.classList.remove('highlight-match'), 1500);
        }
    });
}

function winGame() {
    // Reveal Everything
    currentState.words.forEach(w => w.revealed = true);
    renderGame();

    // Show Win Modal
    document.getElementById('game-timer').classList.add('hidden');
    const timeTaken = Math.floor((Date.now() - currentState.startTime) / 1000);

    // Add link to title
    const titleEl = document.querySelector('.wiki-title');
    titleEl.innerHTML = `<a href="${currentState.targetArticle.url}" target="_blank" style="color:var(--accent); text-decoration:none;">${currentState.targetArticle.title} <i class="fa-solid fa-external-link-alt" style="font-size:0.5em;"></i></a>`;

    alert(`VICTOIRE ! \nPage trouvée : ${currentState.targetArticle.title}\nTemps : ${formatTime(timeTaken)}\nTentatives : ${currentState.stats.attempts}`);

    // Here we would save stats to Firebase
    // saveStats(timeTaken, currentState.stats.attempts);

    // Multiplayer Hook
    if (currentState.mode === 'multiplayer' && typeof window.mpReportProgress === 'function') {
        // Calculate Total Words
        const totalWords = currentState.words.filter(w => w.isWord).length;
        window.mpReportProgress(totalWords, totalWords, true, currentState.stats.attempts);
    }
}

function updateStats() {
    document.getElementById('accuracy').innerText = currentState.stats.attempts; // Using target icon for attempts
    const totalWords = currentState.words.filter(w => w.isWord).length;
    document.getElementById('word-count').innerText = `${currentState.stats.foundCount}/${totalWords}`;

    // Multiplayer Hook
    if (currentState.mode === 'multiplayer' && typeof window.mpReportProgress === 'function') {
        window.mpReportProgress(currentState.stats.foundCount, totalWords, false, currentState.stats.attempts);
    }
}

function updateTimer() {
    const elapsed = Math.floor((Date.now() - currentState.startTime) / 1000);
    const timerEl = document.getElementById('game-timer');
    timerEl.querySelector('span').innerText = formatTime(elapsed);
    timerEl.classList.remove('hidden');
}

function formatTime(sec) {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

function resetUI() {
    document.getElementById('game-controls').classList.add('hidden');
    document.getElementById('main-container').innerHTML = '';
}
