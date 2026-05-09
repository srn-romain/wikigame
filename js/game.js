import { fetchRandomArticle, fetchArticleById } from './wiki.js';
import { db, doc, updateDoc, getCurrentUser } from './firebase-app.js';


// ─────────────────────────────────────────────
// REGEXES
// ─────────────────────────────────────────────
// Matches word characters (Unicode letters, digits, accented chars, hyphens) OR non-word sequences
const TOKEN_REGEX = /[\p{L}0-9'-]+|[^\p{L}0-9'-]+/gu;
const IS_WORD = /^[\p{L}0-9'-]+$/u;

// ─────────────────────────────────────────────
// GAME STATE
// ─────────────────────────────────────────────
let state = {
    article: null,
    tokens: [],
    titleTokens: [],
    guesses: new Set(),
    history: [],
    attempts: 0,
    foundCount: 0,
    totalWords: 0,
    startTime: 0,
    pausedOffset: 0,   // ms accumulés avant une pause
    mode: 'solo',
    won: false
};

export function isGameActive() {
    return state.article !== null && !state.won && state.attempts > 0;
}
window.isGameActive = isGameActive;

export function resetGameState() {
    state.article = null;
    state.won = false;
    const controls = document.getElementById('game-controls');
    if (controls) controls.classList.add('hidden');
}
window.resetGameState = resetGameState;

export function getGameState() {
    return {
        foundCount: state.foundCount,
        totalCount: state.tokens.filter(t => t.isWord).length,
        won: state.won,
        attempts: state.attempts
    };
}
window.getGameState = getGameState;

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
export async function initGame(mode, articleId = null, preSolved = false) {
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
    startGame(article, preSolved);
}

// ─────────────────────────────────────────────
// START
// ─────────────────────────────────────────────
function startGame(article, preSolved = false) {
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
    state.pausedOffset = 0;
    if (window._gameTimer) clearInterval(window._gameTimer);
    window._gameTimer = setInterval(updateTimer, 1000);

    // Pause / reprise (utilisé par le mode multijoueur)
    let _pausedAt = null;
    window._pauseTimer = () => {
        if (_pausedAt !== null) return; // déjà en pause
        _pausedAt = Date.now();
        if (window._gameTimer) { clearInterval(window._gameTimer); window._gameTimer = null; }
        const el = document.getElementById('stat-timer');
        if (el) el.style.opacity = '0.4';
    };
    window._resumeTimer = () => {
        if (_pausedAt === null) return; // pas en pause
        state.pausedOffset += Date.now() - _pausedAt;
        _pausedAt = null;
        if (!window._gameTimer) {
            window._gameTimer = setInterval(updateTimer, 1000);
        }
        const el = document.getElementById('stat-timer');
        if (el) el.style.opacity = '1';
    };

    if (preSolved) {
        triggerWin(true);
    }
}

// ─────────────────────────────────────────────
// RENDER
// ─────────────────────────────────────────────
function renderGame() {
    const container = document.getElementById('main-container');
    container.innerHTML = '';

    // ── Main Layout (Sidebar + Content) ──
    const layout = document.createElement('div');
    layout.className = 'game-layout';
    
    // ── Left Sidebar (History) ──
    const sidebar = document.createElement('aside');
    sidebar.className = 'guesses-sidebar glass';
    sidebar.id = 'guesses-sidebar';
    sidebar.innerHTML = `
        <div class="sidebar-header">
            <i class="fa-solid fa-list-check"></i> Historique
        </div>
        <div id="guesses-list" class="guesses-list"></div>
    `;
    layout.appendChild(sidebar);

    // ── Main Content Area ──
    const contentArea = document.createElement('section');
    contentArea.className = 'wiki-area';

    // Slot pour le panneau admin (injecté par multiplayer.js)
    if (state.mode === 'multiplayer') {
        const adminSlot = document.createElement('div');
        adminSlot.id = 'mp-admin-slot';
        adminSlot.style.marginBottom = '1rem';
        contentArea.appendChild(adminSlot);
    }

    layout.appendChild(contentArea);

    // ── Right Sidebar (Players - Multiplayer Only) ──
    if (state.mode === 'multiplayer') {
        const rightSidebar = document.createElement('aside');
        rightSidebar.className = 'players-sidebar glass';
        rightSidebar.id = 'players-sidebar';
        rightSidebar.innerHTML = `
            <div class="sidebar-header">
                <i class="fa-solid fa-users"></i> Joueurs
            </div>
            <div id="players-live-list" class="guesses-list"></div>
            <div style="padding:1rem; border-top: 1px solid var(--glass-border); margin-top:auto;">
                <button onclick="window._mpPause()" class="btn-primary" style="width:100%; justify-content:center; padding: 0.6rem; font-size: 0.8rem; background: rgba(255,255,255,0.1); border: 1px solid var(--glass-border); color: var(--text-main);">
                    <i class="fa-solid fa-pause"></i> Mettre en pause
                </button>
            </div>
        `;
        layout.appendChild(rightSidebar);
    }
    
    container.appendChild(layout);

    // Render components inside contentArea instead of container
    renderTitle(contentArea);
    if (state.won) renderWinBanner(contentArea);
    renderContent(contentArea);

    updateGuessesSidebar();
}

function renderTitle(target) {
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
    target.appendChild(titleEl);
}

function renderWinBanner(target) {
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
    target.appendChild(winBanner);
}

function renderContent(target) {
    const contentBox = document.createElement('div');
    contentBox.className = 'glass wiki-content';
    contentBox.id = 'wiki-body';

    let paragraphDiv = createParagraphDiv();
    contentBox.appendChild(paragraphDiv);

    state.tokens.forEach(tokenObj => {
        if (tokenObj.isParagraphBreak) {
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
        span.dataset.original = tokenObj.text;

        if (tokenObj.revealed || state.won) {
            span.className = 'wiki-word revealed';
            span.textContent = tokenObj.text;
        } else {
            span.className = 'wiki-word hidden';
            span.dataset.len = tokenObj.text.length;
            span.dataset.clean = tokenObj.clean;
            span.textContent = tokenObj.text;

            const isClose = checkCloseMatch(tokenObj.clean);
            if (isClose) span.classList.add('close-match');

            span.addEventListener('click', handleWordClick);
        }
        paragraphDiv.appendChild(span);
    });

    target.appendChild(contentBox);
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

    // Track history for sidebar
    const alreadyGuessed = state.history.find(h => h.clean === cleanInput);
    if (!alreadyGuessed) {
        state.history.push({ word: rawInput.trim(), clean: cleanInput, hits: hitCount });
    }

    // Check win condition: all title words guessed
    if (checkTitleFound(cleanInput)) {
        triggerWin();
        return;
    }

    // Partial re-render (only update spans instead of full re-render for performance)
    if (hitCount > 0) {
        revealWordInDOM(cleanInput, hitCount);
    }

    updateCloseMatches();
    updateGuessesSidebar();
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
async function triggerWin(skipSave = false) {
    state.won = true;
    state.tokens.forEach(t => { if (t.isWord) t.revealed = true; });

    if (window._gameTimer) clearInterval(window._gameTimer);

    // Sauvegarde Firestore uniquement pour le mode daily (pas solo)
    const user = getCurrentUser();
    if (user && !user.isAnonymous && !skipSave && state.mode === 'daily') {
        try {
            const { markDailyAsSolved } = await import('./daily.js');
            // markDailyAsSolved gère lui-même l'incrémentation de dailySolvedTotal
            await markDailyAsSolved(user);
        } catch (e) {
            console.error("Game: Failed to save daily stats:", e);
        }
    }

    // Signaler la victoire au mode multijoueur si actif
    if (state.mode === 'multiplayer' && window.mpReportProgress) {
        window.mpReportProgress(state.foundCount, state.totalWords, true, state.attempts);
    }

    renderGame(); // Full re-render with win state
}

function updateGuessesSidebar() {
    const list = document.getElementById('guesses-list');
    if (!list) return;

    list.innerHTML = '';
    // Show latest first
    [...state.history].reverse().forEach(item => {
        const div = document.createElement('div');
        const isHit = item.hits > 0;
        div.className = `guess-item ${isHit ? 'hit' : 'miss'}`;
        div.innerHTML = `
            <span>${item.word}</span>
            <span class="guess-badge">${isHit ? item.hits : ''}</span>
        `;
        list.appendChild(div);
    });
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
    const elapsed = Math.floor((Date.now() - state.startTime - state.pausedOffset) / 1000);
    const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const s = (elapsed % 60).toString().padStart(2, '0');
    el.textContent = `${m}:${s}`;
}
