import { fetchRandomArticle, fetchArticleById } from './wiki.js';

// ─────────────────────────────────────────────
// REGEXES
// ─────────────────────────────────────────────
// Matches word characters (letters, digits, accented chars) OR non-word sequences
const TOKEN_REGEX = /[a-zA-Z0-9àâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ'-]+|[^a-zA-Z0-9àâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ'-]+/g;
const IS_WORD = /^[a-zA-Z0-9àâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ'-]+$/;

// ─────────────────────────────────────────────
// GAME STATE
// ─────────────────────────────────────────────
let state = {
    article: null,
    tokens: [],       // Array of token objects for ALL paragraphs
    titleTokens: [],  // Normalized words from the title
    guesses: new Set(),
    attempts: 0,
    foundCount: 0,
    totalWords: 0,
    startTime: 0,
    mode: 'solo',
    won: false
};

// ─────────────────────────────────────────────
// NORMALIZATION
// ─────────────────────────────────────────────
function normalize(str) {
    return str
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/['-]/g, '');
}

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
export async function initGame(mode, articleId = null) {
    console.log(`Game: Initializing mode="${mode}" articleId=${articleId}`);
    state.mode = mode;
    state.won = false;

    // Show loading
    const container = document.getElementById('main-container');
    container.innerHTML = `
        <div class="loading-screen">
            <div class="loading-spinner"></div>
            <p>Chargement d'un article Wikipedia aléatoire...</p>
        </div>`;
    document.getElementById('game-controls').classList.add('hidden');

    let article = null;
    if (articleId) {
        console.log("Game: Fetching specific article by ID...");
        article = await fetchArticleById(articleId);
    } else {
        console.log("Game: Fetching random article...");
        article = await fetchRandomArticle();
    }

    if (!article) {
        console.error("Game: Failed to load article (null).");
        container.innerHTML = `<div class="glass wiki-content error-box">
            <i class="fa-solid fa-triangle-exclamation"></i>
            Impossible de charger un article. Vérifiez votre connexion.
        </div>`;
        return;
    }

    console.log("Game: Article loaded successfully:", article.title);
    startGame(article);
}

// ─────────────────────────────────────────────
// START
// ─────────────────────────────────────────────
function startGame(article) {
    console.log("Game: Starting Level with article:", article);
    state.article = article;

    state.guesses = new Set();
    state.attempts = 0;
    state.foundCount = 0;
    state.startTime = Date.now();
    state.won = false;

    // Tokenize title
    state.titleTokens = (article.title.match(TOKEN_REGEX) || [])
        .filter(t => IS_WORD.test(t))
        .map(normalize);

    // Tokenize all paragraphs (flatten with paragraph separators)
    state.tokens = [];
    article.paragraphs.forEach((para, pIdx) => {
        const raw = para.match(TOKEN_REGEX) || [];
        raw.forEach(token => {
            const isWord = IS_WORD.test(token);
            state.tokens.push({
                text: token,
                clean: isWord ? normalize(token) : null,
                isWord,
                revealed: !isWord // punctuation is always visible
            });
        });
        // Add paragraph separator (double newline token)
        if (pIdx < article.paragraphs.length - 1) {
            state.tokens.push({ text: '\n\n', clean: null, isWord: false, revealed: true, isParagraphBreak: true });
        }
    });

    state.totalWords = state.tokens.filter(t => t.isWord).length;

    renderGame();
    document.getElementById('game-controls').classList.remove('hidden');

    // Timer
    if (window._gameTimer) clearInterval(window._gameTimer);
    window._gameTimer = setInterval(updateTimer, 1000);
}

// ─────────────────────────────────────────────
// RENDER
// ─────────────────────────────────────────────
function renderGame() {
    const container = document.getElementById('main-container');
    container.innerHTML = '';

    // ── Title ──
    const titleEl = document.createElement('div');
    titleEl.className = 'wiki-title-wrapper';

    const titleLabel = document.createElement('div');
    titleLabel.className = 'wiki-title-label';
    titleLabel.textContent = 'Article mystère';
    titleEl.appendChild(titleLabel);

    const titleWords = document.createElement('h1');
    titleWords.className = 'wiki-title';
    titleWords.id = 'wiki-title';

    const titleTokens = state.article.title.match(TOKEN_REGEX) || [];
    titleTokens.forEach(token => {
        const isWord = IS_WORD.test(token);
        if (!isWord) {
            const punct = document.createElement('span');
            punct.className = 'wiki-punctuation';
            punct.textContent = token;
            titleWords.appendChild(punct);
            return;
        }
        const clean = normalize(token);
        const isRevealed = state.guesses.has(clean) || state.won;

        const span = document.createElement('span');
        span.dataset.original = token;

        if (isRevealed) {
            span.className = 'wiki-word revealed';
            span.textContent = token;
        } else {
            span.className = 'wiki-word hidden';
            span.dataset.len = token.length;
            span.dataset.clean = clean;
            span.textContent = token; // MASQUED BY CSS (color = background)
            span.addEventListener('click', handleWordClick);
        }
        titleWords.appendChild(span);
    });


    titleEl.appendChild(titleWords);
    container.appendChild(titleEl);

    // ── Win banner ──
    if (state.won) {
        const winBanner = document.createElement('div');
        winBanner.className = 'win-banner glass';
        winBanner.innerHTML = `
            <div class="win-content">
                <i class="fa-solid fa-trophy"></i>
                <div>
                    <h2>Bravo ! Article trouvé !</h2>
                    <p>En ${state.attempts} tentatives</p>
                </div>
                <a href="${state.article.url}" target="_blank" class="wiki-link-btn">
                    <i class="fa-brands fa-wikipedia-w"></i>
                    Voir l'article
                </a>
            </div>
        `;
        container.appendChild(winBanner);
    }

    // ── Content ──
    const contentBox = document.createElement('div');
    contentBox.className = 'glass wiki-content';
    contentBox.id = 'wiki-body';

    let paragraphDiv = createParagraphDiv();
    contentBox.appendChild(paragraphDiv);

    state.tokens.forEach(tokenObj => {
        if (tokenObj.isParagraphBreak) {
            // Start a new paragraph div
            paragraphDiv = createParagraphDiv();
            contentBox.appendChild(paragraphDiv);
            return;
        }

        if (!tokenObj.isWord) {
            const punct = document.createElement('span');
            punct.className = 'wiki-punctuation';
            punct.textContent = tokenObj.text;
            paragraphDiv.appendChild(punct);
            return;
        }

        const span = document.createElement('span');
        span.dataset.original = tokenObj.text; // Store original for restoration

        if (tokenObj.revealed || state.won) {
            span.className = 'wiki-word revealed';
            span.textContent = tokenObj.text;
        } else {
            span.className = 'wiki-word hidden';
            span.dataset.len = tokenObj.text.length;
            span.dataset.clean = tokenObj.clean;
            
            // Set word text (masked by CSS)
            span.textContent = tokenObj.text;

            const isClose = checkCloseMatch(tokenObj.clean);
            if (isClose) span.classList.add('close-match');

            span.addEventListener('click', handleWordClick);
        }



        paragraphDiv.appendChild(span);
    });

    container.appendChild(contentBox);
    updateStats();
}

function createParagraphDiv() {
    const div = document.createElement('p');
    div.className = 'wiki-paragraph';
    return div;
}

/**
 * Check if a hidden word has a "close" match with any guessed word.
 * Close = the guessed word is a substring of the hidden word or vice versa (min 3 chars).
 */
function checkCloseMatch(cleanWord) {
    if (!cleanWord || cleanWord.length < 3) return false;
    for (const guess of state.guesses) {
        if (guess.length < 3) continue;
        if (cleanWord.includes(guess) || guess.includes(cleanWord)) {
            return true;
        }
    }
    return false;
}

// ─────────────────────────────────────────────
// CLICK ON HIDDEN WORD → show letter count
// ─────────────────────────────────────────────
function handleWordClick(e) {
    const span = e.currentTarget;
    if (span.classList.contains('revealed')) return;
    if (span.classList.contains('showing-count')) return;

    const len = parseInt(span.dataset.len, 10);
    const originalText = span.dataset.original;

    span.classList.add('showing-count');

    setTimeout(() => {
        if (!span.classList.contains('revealed')) {
            span.classList.remove('showing-count');
        }
    }, 2500);
}

// ─────────────────────────────────────────────
// GUESS HANDLING
// ─────────────────────────────────────────────
export function handleGuess(rawInput) {
    if (!rawInput || !state.article || state.won) return;

    const cleanInput = normalize(rawInput.trim());
    if (cleanInput.length === 0) return;

    state.attempts++;

    let hitCount = 0;

    // Reveal matching tokens
    state.tokens.forEach(t => {
        if (t.isWord && t.clean === cleanInput && !t.revealed) {
            t.revealed = true;
            hitCount++;
            state.foundCount++;
        }
    });

    state.guesses.add(cleanInput);

    // Check win condition: all title words guessed
    if (checkTitleFound(cleanInput)) {
        triggerWin();
        return;
    }

    // Partial re-render (only update spans instead of full re-render for performance)
    if (hitCount > 0) {
        // Reveal found words in DOM
        revealWordInDOM(cleanInput, hitCount);
    }

    // Update close-matches for ALL hidden words (might now have new close matches)
    updateCloseMatches();

    updateStats();
    return { hitCount };
}

function checkTitleFound(latestGuess) {
    // Check if all title words are now guessed
    return state.titleTokens.every(w => state.guesses.has(w));
}

function revealWordInDOM(cleanWord, count) {
    // Reveal in body
    const hiddenSpans = document.querySelectorAll('#wiki-body .wiki-word.hidden');
    hiddenSpans.forEach(span => {
        if (span.dataset.clean === cleanWord) {
            span.className = 'wiki-word revealed';
            span.textContent = span.dataset.original; // USE STORED ORIGINAL
            span.removeEventListener('click', handleWordClick);
            span.classList.add('just-revealed');
            setTimeout(() => span.classList.remove('just-revealed'), 600);
        }
    });

    // Reveal in title
    const titleSpans = document.querySelectorAll('#wiki-title .wiki-word.hidden');
    titleSpans.forEach(span => {
        if (span.dataset.clean === cleanWord) {
            span.className = 'wiki-word revealed';
            span.textContent = span.dataset.original;
            span.removeEventListener('click', handleWordClick);
        }
    });
}


function findOriginalText(cleanWord, span) {
    // Find original casing from state.tokens
    const token = state.tokens.find(t => t.isWord && t.clean === cleanWord);
    return token ? token.text : cleanWord;
}

function updateCloseMatches() {
    const hiddenSpans = document.querySelectorAll('#wiki-body .wiki-word.hidden');
    hiddenSpans.forEach(span => {
        const clean = span.dataset.clean;
        if (checkCloseMatch(clean)) {
            span.classList.add('close-match');
        } else {
            span.classList.remove('close-match');
        }
    });
}

// ─────────────────────────────────────────────
// WIN
// ─────────────────────────────────────────────
function triggerWin() {
    state.won = true;
    state.tokens.forEach(t => { if (t.isWord) t.revealed = true; });

    if (window._gameTimer) clearInterval(window._gameTimer);

    renderGame(); // Full re-render with win state
}

// ─────────────────────────────────────────────
// STATS & TIMER
// ─────────────────────────────────────────────
function updateStats() {
    const attemptsEl = document.getElementById('stat-attempts');
    const wordsEl = document.getElementById('stat-words');
    if (attemptsEl) attemptsEl.textContent = state.attempts;
    if (wordsEl) wordsEl.textContent = `${state.foundCount}/${state.totalWords}`;
}

function updateTimer() {
    const el = document.getElementById('stat-timer');
    if (!el) return;
    const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
    const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const s = (elapsed % 60).toString().padStart(2, '0');
    el.textContent = `${m}:${s}`;
}
