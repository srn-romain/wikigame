import { initGame, handleGuess } from './game.js';
import { createRoom, joinRoom } from './multiplayer.js';
import { db, waitForAuth, doc, getDoc, setDoc } from './firebase-app.js';
import { fetchRandomArticle } from './wiki.js';
import { openAuthModal } from './auth.js';
import { getDailyArticleId, checkDailySolved, getCountdown } from './daily.js';
import { getCurrentUser } from './firebase-app.js';

document.addEventListener('DOMContentLoaded', () => {
    setupNavigation();
    setupGameInputs();
    setupAuthListeners();
    navigateTo('home');
});

// ─────────────────────────────────────────────
// NAVIGATION
// ─────────────────────────────────────────────
function setupNavigation() {
    const buttons = document.querySelectorAll('.nav-btn[data-view]');
    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            navigateTo(btn.dataset.view);
        });
    });

    document.querySelector('.logo').addEventListener('click', () => {
        buttons.forEach(b => b.classList.remove('active'));
        document.querySelector('[data-view="home"]')?.classList.add('active');
        navigateTo('home');
    });
}

function setupAuthListeners() {
    const profileBtn = document.getElementById('user-profile-btn');
    const modalContainer = document.getElementById('modal-container');

    profileBtn.onclick = async () => await openAuthModal('login');

    // Close modal when clicking outside
    modalContainer.onclick = (e) => {
        if (e.target === modalContainer) {
            modalContainer.classList.add('hidden');
        }
    };
}

async function navigateTo(view) {
    console.log(`Main: Navigating to view="${view}"`);
    const container = document.getElementById('main-container');
    const controls = document.getElementById('game-controls');
    controls.classList.add('hidden');
    window.isInMpGame = false;

    switch (view) {
        case 'home':
            renderHome(container);
            break;

        case 'solo':
            console.log("Main: Initializing solo game...");
            await initGame('solo');
            break;

        case 'daily':
            console.log("Main: Loading daily challenge...");
            await loadDailyChallenge();
            break;

        case 'multiplayer':
            renderMultiplayerMenu(container);
            break;
    }
}


// ─────────────────────────────────────────────
// HOME PAGE
// ─────────────────────────────────────────────
function renderHome(container) {
    container.innerHTML = `
        <div class="glass home-hero">
            <h1>
                <span style="color:var(--primary)">WIKI</span><span style="color:white">REVEAL</span>
            </h1>
            <p>
                Un article Wikipédia a été censuré.<br>
                Retrouvez les mots cachés un par un pour révéler le sujet secret.
            </p>
            <div class="home-btns">
                <button class="btn-primary" onclick="document.querySelector('[data-view=solo]').click()">
                    <i class="fa-solid fa-shuffle"></i> Article Aléatoire
                </button>
                <button class="btn-accent" onclick="document.querySelector('[data-view=daily]').click()">
                    <i class="fa-solid fa-calendar-day"></i> Défi du Jour
                </button>
            </div>
            <div class="feature-cards">
                <div class="feature-card">
                    <i class="fa-solid fa-eye-slash" style="color: var(--primary)"></i>
                    <h3>Mots Masqués</h3>
                    <p>Tous les mots sont cachés. Tapez un mot pour le révéler dans tout l'article.</p>
                </div>
                <div class="feature-card">
                    <i class="fa-solid fa-circle-question" style="color: var(--orange)"></i>
                    <h3>Indice au Clic</h3>
                    <p>Cliquez sur un bloc noir pour afficher le nombre de lettres du mot caché.</p>
                </div>
                <div class="feature-card">
                    <i class="fa-solid fa-fire" style="color: var(--accent)"></i>
                    <h3>Mots Proches</h3>
                    <p>Les blocs orange indiquent un mot similaire à l'un de vos essais.</p>
                </div>
            </div>
        </div>
    `;
}

// ─────────────────────────────────────────────
// MULTIPLAYER
// ─────────────────────────────────────────────
function renderMultiplayerMenu(container) {
    container.innerHTML = `
        <div class="glass" style="padding: 2rem; text-align: center; border-radius: var(--radius-lg); margin-top:1rem; max-width: 540px; margin-left: auto; margin-right: auto;">
            <i class="fa-solid fa-users-line" style="font-size: 3rem; color: var(--accent); margin-bottom: 1rem;"></i>
            <h2 style="margin-bottom:0.5rem;">Mode Compétition</h2>
            <p style="margin-bottom: 2rem; color: var(--text-muted);">Créez un salon ou rejoignez une partie existante.</p>
            
            <div id="lobby-ui" style="display: flex; flex-direction: column; gap: 1rem;">
                <input type="text" id="username-input" placeholder="Votre Pseudo" 
                    style="padding: 14px; border-radius: var(--radius-md); border: 1px solid var(--glass-border); background: rgba(0,0,0,0.3); color: white; font-size:1rem; outline:none;">
                
                <button id="create-room-btn" class="btn-primary" style="width:100%; justify-content:center;">
                    <i class="fa-solid fa-plus"></i> Créer une Salle
                </button>
                
                <div style="position: relative; margin: 0.5rem 0;">
                    <hr style="border: 0; border-top: 1px solid var(--glass-border);">
                    <span style="position: absolute; top: -9px; left: 50%; transform: translateX(-50%); background: var(--bg-dark); padding: 0 10px; color: var(--text-muted); font-size: 0.75rem;">OU</span>
                </div>

                <div style="display: flex; gap: 8px;">
                    <input type="text" id="room-code-input" placeholder="Code de salle" 
                        style="flex:2; padding: 14px; border-radius: var(--radius-md); border: 1px solid var(--glass-border); background: rgba(0,0,0,0.3); color: white; text-transform: uppercase; font-size:1rem; outline:none;">
                    <button id="join-room-btn" class="nav-btn" style="flex:1; background:var(--bg-card); border: 1px solid var(--glass-border); color:white;">
                        Rejoindre
                    </button>
                </div>
            </div>
        </div>
    `;

    document.getElementById('create-room-btn').onclick = () => {
        const name = document.getElementById('username-input').value;
        if (!name) { alert("Choisissez un pseudo !"); return; }
        createRoom(name);
    };

    document.getElementById('join-room-btn').onclick = () => {
        const name = document.getElementById('username-input').value;
        const code = document.getElementById('room-code-input').value;
        if (!name || !code) { alert("Pseudo et Code requis !"); return; }
        joinRoom(code, name);
    };
}

// ─────────────────────────────────────────────
// DAILY CHALLENGE
// ─────────────────────────────────────────────
async function loadDailyChallenge() {
    const container = document.getElementById('main-container');
    container.innerHTML = `<div class="loading-screen"><div class="loading-spinner"></div><p>Initialisation du défi quotidien...</p></div>`;

    await waitForAuth();
    const user = getCurrentUser();

    // 1. Get the common daily article ID (rotates at Noon)
    const articleId = await getDailyArticleId();
    if (!articleId) {
        container.innerHTML = `<div class="glass error-box">Erreur de synchronisation du défi.</div>`;
        return;
    }

    // 2. Check if the user already solved it today
    const isSolved = await checkDailySolved(user, articleId);

    // 3. Start game (pass preSolved=true if already won)
    await initGame('daily', articleId, isSolved);

    // 4. Inject Daily Header with Countdown
    injectDailyHeader(container);
}

function injectDailyHeader(container) {
    // Remove existing if any
    const existing = document.querySelector('.daily-header');
    if (existing) existing.remove();

    const header = document.createElement('div');
    header.className = 'daily-header glass';
    header.style.cssText = "margin-bottom: 1.5rem; padding: 12px 20px; border-radius: var(--radius-md); display: flex; justify-content: space-between; align-items: center;";
    header.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px;">
            <i class="fa-solid fa-calendar-star" style="color:var(--accent);"></i>
            <span style="font-weight:800; font-size:0.9rem; text-transform:uppercase; letter-spacing:0.05em;">Défi du Jour</span>
        </div>
        <div style="font-size:0.85rem; color:var(--text-muted);">
            Nouveau défi dans : <span id="daily-countdown" style="font-family:var(--font-mono); color:var(--primary); font-weight:800; margin-left:5px;">--:--:--</span>
        </div>
    `;
    
    // Injected at the top of the wiki-container if possible, or main-container
    const target = document.querySelector('.wiki-container') || container;
    target.prepend(header);

    // Real-time countdown
    if (window._dailyInterval) clearInterval(window._dailyInterval);
    window._dailyInterval = setInterval(() => {
        const el = document.getElementById('daily-countdown');
        if (!el) {
            clearInterval(window._dailyInterval);
            return;
        }
        el.textContent = getCountdown();
    }, 1000);
}

// ─────────────────────────────────────────────
// GAME INPUTS (bottom bar)
// ─────────────────────────────────────────────
function setupGameInputs() {
    const input = document.getElementById('guess-input');
    const btn = document.getElementById('submit-guess');

    const submit = () => {
        const val = input.value.trim();
        if (val) {
            handleGuess(val);
            input.value = '';
            input.focus();
        }
    };

    btn.addEventListener('click', submit);
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') submit();
    });
}
