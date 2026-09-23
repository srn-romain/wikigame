import { fetchRandomArticle, fetchArticleById } from './wiki.js';
import confetti from 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/+esm';
import { checkWord, renderSynonymHint, getSynonyms, checkSynonymMatch, areWordsEquivalent, normalize } from './synonyms.js';

import { db, doc, updateDoc, getCurrentUser, getDoc } from './firebase-app.js';
import { saveSoloProgress, deleteSoloDraft } from './solo.js';


// ─────────────────────────────────────────────
// REGEXES
// ─────────────────────────────────────────────
// Matches word characters (Unicode letters, digits, accented chars, hyphens) OR non-word sequences
const TOKEN_REGEX = /[\p{L}0-9']+|[^\p{L}0-9']+/gu;
const IS_WORD = /^[\p{L}0-9']+$/u;

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
    won: false,
    draftId: null,
    hintShown: 0,
    hintEnabled: true  // true par défaut (solo/daily), peut être false en multijoueur
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
    const roomCodeBadge = document.getElementById('mp-room-code-badge');
    if (roomCodeBadge) roomCodeBadge.style.display = 'none';
    if (window._saveTimeout) clearTimeout(window._saveTimeout);
    if (window._mpReportTimeout) clearTimeout(window._mpReportTimeout);
}
window.resetGameState = resetGameState;

export async function forceSaveDraft() {
    if (state.draftId) {
        if (window._saveTimeout) clearTimeout(window._saveTimeout);
        await saveSoloProgress(state.draftId, state.guesses, state.attempts, state.foundCount);
    }
}
window.forceSaveDraft = forceSaveDraft;

export function getGameState() {
    return {
        foundCount: state.foundCount,
        totalCount: state.tokens ? state.tokens.filter(t => t.isWord).length : 0,
        won: state.won,
        attempts: state.attempts,
        mode: state.mode,
        draftId: state.draftId
    };
}
window.getGameState = getGameState;

// ─────────────────────────────────────────────
// NORMALIZATION
// ─────────────────────────────────────────────
async function fetchTitleSynonyms(title) {
    const words = title.split(/[\s,.'-]+/).filter(w => w.length > 3);
    for (const w of words) {
        try {
            const clean = w.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const res = await fetch(`https://api.datamuse.com/words?ml=${clean}&max=1`);
            const data = await res.json();
            if (data && data[0]) {
                state.synonyms[clean] = data[0].word;
            }
        } catch (e) {}
    }
    updateCloseMatches();
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


function hasGuessed(cleanWord) {
    if (!cleanWord) return false;
    if (state.guesses.has(cleanWord)) return true;
    for (const g of state.guesses) {
        if (areWordsEquivalent(cleanWord, g)) return true;
    }
    return false;
}

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
export async function initGame(mode, articleId = null, preSolved = false, draftId = null, options = {}) {
    // options.hintEnabled : true par défaut (undefined = true)
    state.hintEnabled = options.hintEnabled !== false;
    state.roomId = options.roomId || null;
    state.mode = mode;
    state.won = false;
    state.draftId = draftId;

    // Show loading
    const container = document.getElementById('dynamic-view');
    container.innerHTML = `
        <div class="loading-screen">
            <div class="loading-spinner"></div>
            <p id="loading-status-text">Chargement d'un article Wikipedia aléatoire...</p>
        </div>`;
    document.getElementById('game-controls').classList.add('hidden');

    let article = null;
    if (articleId) {
        article = await fetchArticleById(articleId);
    } else {
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

    // Charger les données du brouillon si présent
    let savedGuesses = [];
    let savedAttempts = 0;
    if (draftId) {
        try {
            const { db, doc, getDoc } = await import('./firebase-app.js');
            const dSnap = await getDoc(doc(db, "solo_drafts", draftId));
            if (dSnap.exists()) {
                const dData = dSnap.data();
                savedGuesses = dData.guesses || [];
                savedAttempts = dData.attempts || 0;
            }
        } catch (e) { console.error("Game: Failed to load draft details", e); }
    }

    startGame(article, preSolved, savedGuesses, savedAttempts);
}

// ── START ──
function startGame(article, preSolved = false, savedGuesses = [], savedAttempts = 0) {
    state.article = article;

    state.guesses = new Set(savedGuesses);
    state.attempts = savedAttempts;
    state.won = false;
    state.history = [];
    state.synonyms = {}; // Cache pour les indices
    state.hintShown = 0;

    // Reconstruct foundCount
    state.foundCount = 0;

    // Fetch synonyms for title words to help player
    fetchTitleSynonyms(article.title).catch(console.error);

    // Reconstruct history from saved guesses (simplified)
    savedGuesses.forEach(g => {
        state.history.push({ word: g, clean: g, hits: '?' }); // '?' because we don't know exact hits per guess from here
    });

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
            const clean = isWord ? normalize(token) : null;
            const revealed = !isWord || hasGuessed(clean);
            if (revealed && isWord) state.foundCount++;

            state.tokens.push({
                text: token,
                clean,
                isWord,
                revealed
            });
        });
        // Add paragraph separator (double newline token)
        if (pIdx < article.paragraphs.length - 1) {
            state.tokens.push({ text: '\n\n', clean: null, isWord: false, revealed: true, isParagraphBreak: true });
        }
    });

    state.totalWords = state.tokens.filter(t => t.isWord).length;

    renderGame();
    const controls = document.getElementById('game-controls');
    controls.classList.remove('hidden');

    // Room code indicator for competition/multiplayer
    let roomCodeBadge = document.getElementById('mp-room-code-badge');
    if (state.mode === 'multiplayer' && state.roomId) {
        if (!roomCodeBadge) {
            roomCodeBadge = document.createElement('div');
            roomCodeBadge.id = 'mp-room-code-badge';
            roomCodeBadge.style.cssText = "font-size:0.75rem; text-align:center; color:var(--text-muted); padding-top:6px; margin-top:6px; border-top:1px solid rgba(255,255,255,0.1); font-weight:600; width:100%; display:flex; justify-content:center; gap:4px; align-items:center;";
            controls.appendChild(roomCodeBadge);
        }
        roomCodeBadge.innerHTML = `<i class="fa-solid fa-users" style="color:var(--accent); font-size:0.7rem;"></i> Code de la salle : <strong style="color:var(--accent); letter-spacing:1px; text-transform:uppercase; font-size:0.8rem;">${state.roomId}</strong>`;
        roomCodeBadge.style.display = 'flex';
    } else {
        if (roomCodeBadge) roomCodeBadge.style.display = 'none';
    }

    // Timer
    state.startTime = Date.now();
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
    const container = document.getElementById('dynamic-view');
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
    
    // ── Solo Save Indicator ──
    if (state.mode === 'solo' && state.draftId) {
        const saveInfo = document.createElement('div');
        saveInfo.className = 'save-status';
        saveInfo.id = 'solo-save-status';
        saveInfo.innerHTML = '<i class="fa-solid fa-cloud-check"></i> Sauvegarde auto active';
        saveInfo.style.cssText = "position:absolute; top:1rem; right:1rem; font-size:0.7rem; color:var(--text-muted); opacity:0.7;";
        contentArea.appendChild(saveInfo);

        // Add Quit button to sidebar
        const quitBtn = document.createElement('div');
        quitBtn.style.padding = "1rem";
        quitBtn.style.borderTop = "1px solid var(--glass-border)";
        quitBtn.style.marginTop = "auto";
        quitBtn.innerHTML = `
            <button onclick="window.forceSaveDraft().then(() => window.navigateTo('solo', true))" class="btn-primary" style="width:100%; justify-content:center; background:#475569; padding:0.6rem; font-size:0.85rem;">
                <i class="fa-solid fa-person-running"></i> Quitter et Sauvegarder
            </button>
        `;
        sidebar.appendChild(quitBtn);
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
        const isRevealed = hasGuessed(clean) || state.won;

        const span = document.createElement('span');
        span.dataset.original = token;

        if (isRevealed) {
            span.className = 'wiki-word revealed';
            span.textContent = token;
        } else {
            span.className = 'wiki-word hidden';
            span.dataset.len = token.length;
            span.dataset.clean = clean;
            span.textContent = token; 
            
            const synHint = checkSynonymMatch(clean, state.guesses);
            if (synHint) {
                renderSynonymHint(span, synHint);
            } else {
                const hint = getBestMatchingGuess(clean);
                if (hint) {
                    span.classList.add('close-match');
                    span.setAttribute('data-hint', hint);
                }
            }

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

            const synHint = checkSynonymMatch(tokenObj.clean, state.guesses);
            if (synHint) {
                renderSynonymHint(span, synHint);
            } else {
                const hint = getBestMatchingGuess(tokenObj.clean);
                if (hint) {
                    span.classList.add('close-match');
                    span.setAttribute('data-hint', hint);
                }
            }

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
function getBestMatchingGuess(cleanWord) {
    if (!cleanWord || cleanWord.length < 3) return null;
    let best = null;
    for (const guess of state.guesses) {
        if (guess.length < 3) continue;
        // Same stem or inclusion
        if (cleanWord.includes(guess) || guess.includes(cleanWord)) {
            if (!best || Math.abs(guess.length - cleanWord.length) < Math.abs(best.length - cleanWord.length)) {
                best = guess;
            }
        }
    }
    // Also check for pre-fetched synonyms
    if (!best && state.synonyms && state.synonyms[cleanWord]) {
        return state.synonyms[cleanWord];
    }
    return best;
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
        if (t.isWord && areWordsEquivalent(t.clean, cleanInput) && !t.revealed) {
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
    
    // Always search for synonyms even if there are exact hits
    checkSynonymsForGuess(cleanInput);

    // Sauvegarde auto du brouillon Solo (Debounce pour préserver les quotas Firebase)
    if (state.draftId) {
        const statusEl = document.getElementById('solo-save-status');
        if (statusEl) statusEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Attente...';
        
        if (window._saveTimeout) clearTimeout(window._saveTimeout);
        window._saveTimeout = setTimeout(() => {
            if (statusEl) statusEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Synchronisation...';
            saveSoloProgress(state.draftId, state.guesses, state.attempts, state.foundCount)
                .then(() => {
                    if (statusEl) statusEl.innerHTML = '<i class="fa-solid fa-cloud-check"></i> Sauvegarde auto active';
                })
                .catch(err => {
                    console.error(err);
                    if (statusEl) statusEl.innerHTML = '<i class="fa-solid fa-circle-exclamation" style="color:red"></i> Erreur de sauvegarde';
                });
        }, 10000); // Sauvegarde toutes les 10 secondes d'inactivité
    }

    // Multiplayer progress update (Debounce pour préserver les quotas Firebase)
    if (state.mode === 'multiplayer' && window.mpReportProgress) {
        if (window._mpReportTimeout) clearTimeout(window._mpReportTimeout);
        window._mpReportTimeout = setTimeout(() => {
            window.mpReportProgress(state.foundCount, state.totalWords, false, state.attempts);
        }, 8000); // Synchronisation tous les 8 secondes d'inactivité
    }

    updateCloseMatches();
    updateGuessesSidebar();
    updateStats();
    return { hitCount };
}

function checkTitleFound(latestGuess) {
    // Check if all title words are now guessed
    return state.titleTokens.every(w => hasGuessed(w));
}

function revealWordInDOM(cleanWord, count) {
    // Reveal in body
    const hiddenSpans = document.querySelectorAll('#wiki-body .wiki-word.hidden');
    hiddenSpans.forEach(span => {
        if (areWordsEquivalent(span.dataset.clean, cleanWord)) {
            span.className = 'wiki-word revealed found';
            span.textContent = span.dataset.original; // USE STORED ORIGINAL
            span.removeEventListener('click', handleWordClick);
            span.classList.add('just-revealed');
            setTimeout(() => span.classList.remove('just-revealed'), 600);
        }
    });

    // Reveal in title
    const titleSpans = document.querySelectorAll('#wiki-title .wiki-word.hidden');
    titleSpans.forEach(span => {
        if (areWordsEquivalent(span.dataset.clean, cleanWord)) {
            span.className = 'wiki-word revealed found';
            span.textContent = span.dataset.original;
            span.removeEventListener('click', handleWordClick);
        }
    });
}


async function checkSynonymsForGuess(cleanInput) {
    const hiddenSpans = document.querySelectorAll('.wiki-word.hidden:not(.revealed)');
    
    let matchCount = 0;
    
    // We use a Promise.all or a simple loop. Since checkWord might call API, 
    // we'll be careful, but local checks are instant.
    for (const span of hiddenSpans) {
        const targetWord = span.dataset.clean;
        if (!targetWord) continue;

        // checkWord now handles Categories, Stems, and API Fallback
        const result = await checkWord(cleanInput, targetWord);
        
        if (result === 'synonym') {
            renderSynonymHint(span, cleanInput);
            matchCount++;
        }
    }
}


function findOriginalText(cleanWord, span) {
    // Find original casing from state.tokens
    const token = state.tokens.find(t => t.isWord && t.clean === cleanWord);
    return token ? token.text : cleanWord;
}

function updateCloseMatches() {
    const hiddenSpans = document.querySelectorAll('#wiki-body .wiki-word.hidden');
    hiddenSpans.forEach(span => {
        if (span.classList.contains('synonym-hint')) return;
        const clean = span.dataset.clean;
        const hint = getBestMatchingGuess(clean);
        if (hint) {
            span.classList.add('close-match');
            span.setAttribute('data-hint', hint);
        } else {
            span.classList.remove('close-match');
            span.removeAttribute('data-hint');
        }
    });
}

// ─────────────────────────────────────────────
// WIN
// ─────────────────────────────────────────────
async function triggerWin(skipSave = false) {
    state.won = true;
    state.tokens.forEach(t => { if (t.isWord) t.revealed = true; });

    // Confetti!
    confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#166534', '#15803d', '#f39c12', '#e67e22', '#2ecc71']
    });

    if (window._gameTimer) clearInterval(window._gameTimer);


    // Supprimer le brouillon si gagné
    if (state.draftId) {
        deleteSoloDraft(state.draftId).catch(console.error);
        state.draftId = null;
    }

    // Sauvegarde Firestore
    const user = getCurrentUser();
    const isPublicMode = state.mode === 'daily' || state.mode === 'solo';

    if (user && !user.isAnonymous && !skipSave && isPublicMode) {
        try {
            const { incrementGlobalStat, doc, db, updateDoc, increment, getDoc } = await import('./firebase-app.js');
            const userRef = doc(db, "users", user.uid);
            const userSnap = await getDoc(userRef);
            const userData = userSnap.exists() ? userSnap.data() : {};

            // Logique spécifique au mode Quotidien
            if (state.mode === 'daily') {
                const { markDailyAsSolved } = await import('./daily.js');
                await markDailyAsSolved(user, state.article.title);
            }

            // Stats Globales & XP
            incrementGlobalStat('totalGamesPlayed');
            incrementGlobalStat('soloGamesPlayed');
            
            // Stats Utilisateur pour Missions
            const updates = {
                totalGamesPlayed: increment(1),
                totalWins: increment(1)
            };

            // Calcul du temps et efficacité
            const durationSec = state.timer || 0;
            const attempts = state.attempts || 0;
            const revealedWords = state.tokens.filter(t => t.isWord && t.revealed).length;
            const errors = Math.max(0, attempts - revealedWords);
            
            if (durationSec < 120) updates.fastWins = increment(1);
            if (durationSec < 60) updates.ultraFastWins = increment(1);
            if (durationSec < 30) updates.godSpeedWins = increment(1);
            if (attempts <= 10) updates.efficientWins = increment(1);
            if (attempts === 1) updates.oneShotWins = increment(1);
            if (errors < 5) updates.lowErrorWins = increment(1);

            // Mots révélés dans cette partie
            updates.totalWordsRevealed = increment(revealedWords);

            // Record tentatives
            if (!userData.maxAttemptsInOneGame || attempts > userData.maxAttemptsInOneGame) {
                updates.maxAttemptsInOneGame = attempts;
            }

            // Attribution XP différentiée (Nouveaux barèmes)
            const xpToAdd = (state.mode === 'daily') ? 10 : 2;
            updates.xp = increment(xpToAdd);

            await updateDoc(userRef, updates);

        } catch (e) {
            console.error("Game: Failed to save victory stats:", e);
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
    state.timer = elapsed;
    const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const s = (elapsed % 60).toString().padStart(2, '0');
    el.textContent = `${m}:${s}`;

    if ((state.mode === 'multiplayer' || state.mode === 'solo' || state.mode === 'daily') && state.hintEnabled && !state.won) {
        const hintStage = Math.floor(elapsed / 120); // 1 pour 2min, 2 pour 4min, etc.
        if (hintStage >= 1 && state.hintShown < hintStage && state.hintShown < 5) {
            const nextStage = Math.min(hintStage, 5);
            showCompetitionHint(nextStage);
        }
    }
}

function showCompetitionHint(stage = 1) {
    state.hintShown = stage;
    const container = document.getElementById('wiki-body');
    if (!container) return;

    // Remove any punctuation or non-letters at the start to get the actual first letter
    const match = state.article.title.match(/[\p{L}0-9]/u);
    const firstChar = match ? match[0].toUpperCase() : state.article.title.charAt(0).toUpperCase();

    const categories = state.article.categories || [];
    const allCategories = state.article.allCategories || [];

    // Filtrage de sécurité : exclure toute catégorie révélant un mot du titre (même si wiki.js a déjà filtré)
    const titleWordsHint = state.article.title
        .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .split(/[\s,.'"\-()[\]]+/).filter(w => w.length > 3);
    const safeCats = categories.filter(c => {
        const cNorm = c.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return !titleWordsHint.some(w => cNorm.includes(w));
    });

    // Check if the hint box already exists in the DOM to avoid duplication and update it smoothly
    let hintEl = document.getElementById('game-hint-box');
    if (!hintEl) {
        hintEl = document.createElement('div');
        hintEl.id = 'game-hint-box';
        hintEl.className = 'glass';
        hintEl.style.cssText = "margin-top:3rem; padding:1.5rem; text-align:center; border:2px dashed var(--accent); border-radius:12px; animation: fadeIn 1s ease-out; background:rgba(255,255,255,0.7);";
        container.appendChild(hintEl);
    }

    let categoryHtml = '';
    let isExhausted = false;

    if (safeCats.length > 0) {
        // Show up to "stage" categories progress
        const visibleCats = safeCats.slice(0, stage);
        const cats = visibleCats.map(c => `<li><i class="fa-solid fa-tag" style="margin-right:5px; color:var(--accent); font-size:0.8rem;"></i> ${c}</li>`).join('');
        
        let warningText = '';
        if (stage > safeCats.length) {
            isExhausted = true;
            warningText = `
                <li style="margin-top:10px; color:var(--text-muted); font-style:italic; font-size:0.8rem; list-style:none; line-height:1.4; border-top:1px dashed rgba(0,0,0,0.1); padding-top:8px;">
                    <i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b; margin-right:5px;"></i>
                    Aucun autre thème ne peut être dévoilé sans révéler le titre...
                </li>
            `;
        }
        
        categoryHtml = `
            <div style="margin-top:15px; padding-top:15px; border-top:1px solid rgba(0,0,0,0.1); text-align:left;">
                <span style="font-size:0.75rem; text-transform:uppercase; color:var(--text-muted); font-weight:700; letter-spacing:1px;">Thèmes de l'article (${visibleCats.length}/${safeCats.length}) :</span>
                <ul style="list-style:none; padding:0; margin:8px 0 0; color:#111; font-weight:600; font-size:0.9rem; line-height:1.5;">
                    ${cats}
                    ${warningText}
                </ul>
            </div>
        `;
    } else if (allCategories.length > 0 || (categories.length > 0 && safeCats.length === 0)) {
        isExhausted = true;
        categoryHtml = `
            <div style="margin-top:15px; padding-top:15px; border-top:1px solid rgba(0,0,0,0.1); text-align:left;">
                <span style="font-size:0.75rem; text-transform:uppercase; color:var(--text-muted); font-weight:700; letter-spacing:1px;">Thèmes de l'article :</span>
                <p style="margin:8px 0 0; color:var(--text-muted); font-style:italic; font-size:0.85rem; line-height:1.4;">
                    <i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b; margin-right:5px;"></i>
                    Aucune thématique ne peut être dévoilée sans donner une réponse du titre...
                </p>
            </div>
        `;
    }

    hintEl.innerHTML = `
        <i class="fa-solid fa-lightbulb" style="color:#fbbf24; font-size:1.5rem; margin-bottom:10px;"></i>
        <h3 style="margin:0 0 5px 0; color:#111;">Coup de pouce (Aide progressive)</h3>
        <p style="margin:0; color:var(--text-muted); font-size:0.95rem;">Le premier mot du titre commence par la lettre <strong style="color:white; font-size:1.2rem; background:var(--accent); padding:2px 8px; border-radius:4px;">${firstChar}</strong></p>
        ${categoryHtml}
    `;

    // Affiche la notification Toaster adéquate (disparaît après 10 secondes ou via clic)
    if (isExhausted) {
        showToastNotification("Plus aucun autre thème ne peut être dévoilé sans révéler le titre !", 10000);
    } else {
        showToastNotification("Un coup de pouce progressif est disponible au bas de l'article.", 10000);
    }
}

function showToastNotification(message, duration = 5000) {
    const existing = document.getElementById('game-toast-notification');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'game-toast-notification';
    toast.style.cssText = "position:fixed; top:20px; left:50%; transform:translateX(-50%) translateY(-20px); background:rgba(255,255,255,0.95); border-left:5px solid var(--accent); border-radius:12px; padding:12px 20px; box-shadow:0 10px 25px rgba(0,0,0,0.15); display:flex; align-items:center; gap:12px; z-index:9999; opacity:0; transition:all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275); max-width:90%; width:340px; backdrop-filter:blur(8px); border:1px solid rgba(243,156,18,0.15);";
    
    toast.innerHTML = `
        <div style="background:rgba(243,156,18,0.1); border-radius:50%; width:32px; height:32px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
            <i class="fa-solid fa-lightbulb" style="color:var(--accent); font-size:1.1rem;"></i>
        </div>
        <div style="flex:1; text-align:left;">
            <div style="font-weight:800; font-size:0.85rem; color:#111827; margin-bottom:2px;">Nouvel indice disponible !</div>
            <div style="font-size:0.75rem; color:#4b5563; line-height:1.3;">${message}</div>
        </div>
        <button id="close-toast-btn" style="all:unset; cursor:pointer; color:#9ca3af; padding:4px; display:flex; align-items:center; justify-content:center; font-size:0.8rem; border-radius:50%; transition:all 0.2s;">
            <i class="fa-solid fa-xmark"></i>
        </button>
    `;

    document.body.appendChild(toast);

    const closeBtn = toast.querySelector('#close-toast-btn');
    const closeToast = () => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(-20px)';
        setTimeout(() => toast.remove(), 400);
    };

    closeBtn.addEventListener('click', closeToast);

    // Entre en fondu avec rebond
    setTimeout(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
    }, 50);

    // Retrait automatique
    setTimeout(closeToast, duration);
}
