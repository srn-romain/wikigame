import { initGame, handleGuess } from './game.js';
import { createRoom, joinRoom } from './multiplayer.js';
import { db, waitForAuth, doc, getDoc, setDoc } from './firebase-app.js';
import { fetchRandomArticle } from './wiki.js';
import { openAuthModal } from './auth.js';
import { getDailyArticleId, checkDailySolved, getCountdown, getDailySolversCount } from './daily.js';
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
    const navLinks = document.querySelector('.nav-links');
    const toggle = document.getElementById('mobile-menu-toggle');

    if (toggle) {
        toggle.addEventListener('click', () => {
            navLinks.classList.toggle('open');
            toggle.classList.toggle('active');
        });
    }

    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Close mobile menu
            navLinks.classList.remove('open');
            toggle?.classList.remove('active');
            
            navigateTo(btn.dataset.view);
        });
    });

    document.querySelector('.logo').addEventListener('click', () => {
        buttons.forEach(b => b.classList.remove('active'));
        document.querySelector('[data-view="home"]')?.classList.add('active');
        
        // Close mobile menu
        navLinks.classList.remove('open');
        toggle?.classList.remove('active');

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
// HOME PAGE
// ─────────────────────────────────────────────
function renderHome(container) {
    container.innerHTML = `
        <div class="glass home-hero" style="max-width: 960px; margin: 2rem auto; padding: 3rem 2rem; border: none; box-shadow: 0 20px 50px rgba(0,0,0,0.15);">
            <div style="margin-bottom: 0.5rem; text-align: center;">
                <h1 style="font-size: 5rem; letter-spacing: -0.05em; margin-bottom: 0.5rem; line-height: 1; display: flex; align-items: center; justify-content: center; gap: 20px;">
                    <i class="fa-brands fa-wikipedia-w" style="color:#000000; font-size: 4rem;"></i>
                    <span><span style="color:var(--primary)">WIKI</span><span style="color:var(--accent)">GAME</span></span>
                </h1>
                <p style="font-size: 1.25rem; color: var(--title-dark); font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; opacity: 0.8;">
                    Le jeu de décryptage encyclopédique
                </p>
            </div>
            
            <p style="font-size: 1.1rem; color: var(--text-muted); max-width: 520px; margin: 0 auto 3rem; line-height: 1.8; text-align: center;">
                Saurez-vous identifier l'article caché derrière ses mots masqués ? 
                Un défi de culture et de déduction logique.
            </p>

            <div class="home-btns" style="margin-bottom: 5rem; display: flex; justify-content: center; gap: 15px; max-width: 750px; margin-left: auto; margin-right: auto;">
                <button class="btn-accent" style="flex: 1; padding: 1.1rem 0; justify-content: center;" onclick="document.querySelector('[data-view=daily]').click()">
                    <i class="fa-solid fa-calendar-check"></i> Défi Quotidien
                </button>
                <button class="btn-primary" style="flex: 1; padding: 1.1rem 0; justify-content: center;" onclick="document.querySelector('[data-view=solo]').click()">
                    <i class="fa-solid fa-play"></i> Mode Solo
                </button>
                <button class="btn-primary" style="flex: 1; padding: 1.1rem 0; justify-content: center; background: #2563eb; box-shadow: 0 4px 15px rgba(37, 99, 235, 0.3);" onclick="document.querySelector('[data-view=multiplayer]').click()">
                    <i class="fa-solid fa-users"></i> Compétition
                </button>
            </div>

            <div class="feature-cards" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem;">
                <div class="feature-card" style="background: white; border: 1px solid #eee; padding: 2.5rem 1.5rem; border-radius: 12px; text-align: center; box-shadow: 0 4px 12px rgba(0,0,0,0.03);">
                    <i class="fa-solid fa-brain" style="color: var(--primary); font-size: 2rem; margin-bottom: 1.5rem;"></i>
                    <h3 style="color: var(--title-dark); font-size: 1rem; margin-bottom: 0.25rem; font-weight: 700;">Déduction</h3>
                    <p style="font-size: 0.85rem; color: var(--text-muted); line-height: 1.4; margin: 0;">Analysez la structure et les connecteurs logiques pour percer le mystère.</p>
                </div>
                <div class="feature-card" style="background: white; border: 1px solid #eee; padding: 2.5rem 1.5rem; border-radius: 12px; text-align: center; box-shadow: 0 4px 12px rgba(0,0,0,0.03);">
                    <i class="fa-solid fa-magnifying-glass-chart" style="color: var(--accent); font-size: 2rem; margin-bottom: 1.5rem;"></i>
                    <h3 style="color: var(--title-dark); font-size: 1rem; margin-bottom: 0.25rem; font-weight: 700;">Analyse</h3>
                    <p style="font-size: 0.85rem; color: var(--text-muted); margin: 0;">Utilisez les indices de longueur de mots pour valider vos hypothèses.</p>
                </div>
                <div class="feature-card" style="background: white; border: 1px solid #eee; padding: 2.5rem 1.5rem; border-radius: 12px; text-align: center; box-shadow: 0 4px 12px rgba(0,0,0,0.03);">
                    <i class="fa-solid fa-ranking-star" style="color: #2563eb; font-size: 2rem; margin-bottom: 1.5rem;"></i>
                    <h3 style="color: var(--title-dark); font-size: 1rem; margin-bottom: 0.25rem; font-weight: 700;">Compétition</h3>
                    <p style="font-size: 0.85rem; color: var(--text-muted); margin: 0;">Mesurez votre rapidité face à la communauté sur l'article du jour.</p>
                </div>
            </div>
        </div>
    `;
}

// ─────────────────────────────────────────────
// MULTIPLAYER
// ─────────────────────────────────────────────
function renderMultiplayerMenu(container) {
    const user = getCurrentUser();
    const defaultName = (user && !user.isAnonymous) ? (user.displayName || "") : "";

    container.innerHTML = `
        <div class="glass" style="padding: 2rem; text-align: center; border-radius: var(--radius-lg); margin-top:1rem; max-width: 540px; margin-left: auto; margin-right: auto;">
            <i class="fa-solid fa-users-line" style="font-size: 3rem; color: var(--accent); margin-bottom: 1rem;"></i>
            <h2 style="margin-bottom:0.5rem;">Mode Compétition</h2>
            <p style="margin-bottom: 2rem; color: var(--text-muted);">Créez un salon ou rejoignez une partie existante.</p>
            
            <div id="lobby-ui" style="display: flex; flex-direction: column; gap: 1rem;">
                <input type="text" id="username-input" class="wiki-input" placeholder="Votre Pseudo" value="${defaultName}" style="width:100%;">
                
                <button id="create-room-btn" class="btn-primary" style="width:100%; justify-content:center;">
                    <i class="fa-solid fa-plus"></i> Créer une Salle
                </button>
                
                <div style="position: relative; margin: 0.5rem 0;">
                    <hr style="border: 0; border-top: 1px solid var(--glass-border);">
                    <span style="position: absolute; top: -9px; left: 50%; transform: translateX(-50%); background: white; padding: 0 10px; color: var(--text-muted); font-size: 0.75rem; font-weight: 700;">OU</span>
                </div>

                <div style="display: flex; flex-direction: column; gap: 1rem;">
                    <input type="text" id="room-code-input" class="wiki-input" placeholder="Code de salle" style="text-transform: uppercase; text-align: center;">
                    <button id="join-room-btn" class="btn-accent" style="width: 100%;">
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

    // 3. Get total solvers count
    const solversCount = await getDailySolversCount();

    // 4. Start game (pass preSolved=true if already won)
    await initGame('daily', articleId, isSolved);

    // 5. Inject Daily Header with Countdown and Solvers count
    injectDailyHeader(container, solversCount);
}

function injectDailyHeader(container, solversCount) {
    // Remove existing if any
    const existing = document.querySelector('.daily-header');
    if (existing) existing.remove();

    const header = document.createElement('div');
    header.className = 'daily-header glass';
    header.style.cssText = "margin-bottom: 1.5rem; padding: 12px 20px; border-radius: var(--radius-md); display: flex; flex-direction:column; gap:8px;";
    header.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
            <div style="display:flex; align-items:center; gap:10px;">
                <i class="fa-solid fa-calendar-star" style="color:var(--accent);"></i>
                <span style="font-weight:800; font-size:0.9rem; text-transform:uppercase; letter-spacing:0.05em;">Défi du Jour</span>
            </div>
            <div style="display:flex; align-items:center; gap:15px;">
                <div style="font-size:0.85rem; color:var(--text-main); background:#f3f4f6; padding:4px 12px; border-radius:20px; display:flex; align-items:center; gap:6px; border:1px solid #e5e7eb;">
                    <i class="fa-solid fa-trophy" style="color:#f39c12; font-size:0.75rem;"></i>
                    <span style="font-weight:700;">${solversCount}</span> <span style="font-size:0.7rem; opacity:0.7;">gagnants</span>
                </div>
                <div style="font-size:0.85rem; color:var(--text-muted);">
                    Reset : <span id="daily-countdown" style="font-family:var(--font-mono); color:var(--accent); font-weight:800; margin-left:5px;">--:--:--</span>
                </div>
            </div>
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
