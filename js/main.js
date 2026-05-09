import { initGame, handleGuess } from './game.js';
import { createRoom, joinRoom } from './multiplayer.js';
import { waitForAuth, getCurrentUser } from './firebase-app.js';
import { openAuthModal, showInfoModal, showConfirmModal } from './auth.js';
import { getDailyArticleId, checkDailySolved, getCountdown, getDailySolversCount } from './daily.js';



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
    if (window.isGameActive && window.isGameActive()) {
        const confirmed = await showConfirmModal(
            "Partie en cours",
            "Attention : vous avez une partie en cours. Si vous changez de page maintenant, votre progression sera perdue et aucun score ne sera enregistré dans vos statistiques. Souhaitez-vous vraiment quitter ?",
            "Quitter la partie"
        );
        if (!confirmed) return;

        // Reset game state if we confirmed exit
        if (window.resetGameState) window.resetGameState();
    }

    console.log(`Main: Navigating to view="${view}"`);
    const container = document.getElementById('main-container');
    const controls = document.getElementById('game-controls');
    controls.classList.add('hidden');
    window.isInMpGame     = false;
    window._mpGameStarted = false; // Reset pour que le listener MP puisse relancer

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
            await waitForAuth();
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
// MULTIPLAYER MENU — deux formulaires distincts
// ─────────────────────────────────────────────
function renderMultiplayerMenu(container) {
    const user = getCurrentUser();
    console.log("Multiplayer: Current user check:", user ? user.uid : "null", "isAnonymous:", user?.isAnonymous);

    // Warning for anonymous users
    if (!user || user.isAnonymous) {
        container.innerHTML = `
            <div style="max-width:500px;margin:3rem auto;padding:2rem;text-align:center;border-radius:var(--radius-lg);" class="glass">
                <i class="fa-solid fa-user-lock" style="font-size:3rem;color:var(--accent);margin-bottom:1rem;"></i>
                <h2 style="margin:0 0 1rem;">Connexion requise</h2>
                <p style="color:var(--text-muted);margin:0 0 2rem;">Le mode compétition nécessite un compte pour participer et sauvegarder vos statistiques.</p>
                <button class="btn-primary" onclick="document.getElementById('user-profile-btn').click()" style="justify-content:center;width:100%;padding:1rem;">
                    <i class="fa-solid fa-right-to-bracket"></i> Se connecter / S'inscrire
                </button>
            </div>
        `;
        return;
    }

    const defaultName = user.displayName || '';

    container.innerHTML = `
        <div style="max-width:700px;margin:2rem auto;padding:0 1rem;">
            <div style="text-align:center;margin-bottom:2rem;">
                <i class="fa-solid fa-users-line" style="font-size:2.5rem;color:var(--accent);margin-bottom:.75rem;"></i>
                <h2 style="margin:0 0 .25rem;">Mode Compétition</h2>
                <p style="color:var(--text-muted);font-size:.9rem;">Créez votre salle ou rejoignez-en une existante.</p>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;">

                <!-- ── CRÉER UNE SALLE ── -->
                <div class="glass" style="padding:1.75rem;border-radius:var(--radius-lg);display:flex;flex-direction:column;gap:1rem;">
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:.25rem;">
                        <div style="background:var(--primary);color:white;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;">
                            <i class="fa-solid fa-plus"></i>
                        </div>
                        <div>
                            <h3 style="margin:0;font-size:1rem;">Créer une salle</h3>
                            <p style="margin:0;font-size:.75rem;color:var(--text-muted);">Vous serez l'administrateur</p>
                        </div>
                    </div>

                    <div style="display:flex;flex-direction:column;gap:.6rem;">
                        <label style="font-size:.8rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;">Votre pseudo</label>
                        <input type="text" id="create-username" class="wiki-input" placeholder="Pseudo" value="${defaultName}" style="width:100%;">
                    </div>

                    <div style="display:flex;flex-direction:column;gap:.6rem;">
                        <label style="font-size:.8rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;">Nom de la salle</label>
                        <input type="text" id="create-roomname" class="wiki-input" placeholder="Ex: La salle de Jean" style="width:100%;">
                    </div>

                    <div style="display:flex;flex-direction:column;gap:.6rem;">
                        <label style="font-size:.8rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;">Nombre de manches</label>
                        <div style="display:flex;align-items:center;gap:.75rem;">
                            <input type="range" id="create-rounds" min="1" max="5" value="3" style="flex:1;accent-color:var(--primary);">
                            <span id="rounds-display" style="font-family:var(--font-mono);font-weight:800;font-size:1.2rem;color:var(--primary);min-width:1.5rem;text-align:center;">3</span>
                        </div>
                    </div>

                    <div style="display:flex;flex-direction:column;gap:.6rem;">
                        <label style="font-size:.8rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;">Mode de victoire</label>
                        <div id="win-mode-options" style="display:flex; flex-direction:column; gap:.5rem;">
                            <label class="win-mode-card">
                                <input type="radio" name="win-mode" value="1" checked style="display:none;">
                                <div class="card-content">
                                    <span class="icon">🚀</span>
                                    <div>
                                        <strong>Premier arrivé</strong>
                                        <p>La manche s'arrête dès que le premier trouve.</p>
                                    </div>
                                </div>
                            </label>
                            <label class="win-mode-card">
                                <input type="radio" name="win-mode" value="2" style="display:none;">
                                <div class="card-content">
                                    <span class="icon">🏁</span>
                                    <div>
                                        <strong>Tout le monde finit</strong>
                                        <p>Chacun termine à son rythme, score au temps.</p>
                                    </div>
                                </div>
                            </label>
                            <label class="win-mode-card">
                                <input type="radio" name="win-mode" value="3" style="display:none;">
                                <div class="card-content">
                                    <span class="icon">⏱️</span>
                                    <div>
                                        <strong>Countdown 1 min</strong>
                                        <p>Dernière minute lancée dès que le premier trouve.</p>
                                    </div>
                                </div>
                            </label>
                        </div>
                    </div>

                    <button id="create-room-btn" class="btn-primary" style="width:100%;justify-content:center;margin-top:.5rem;">
                        <i class="fa-solid fa-play"></i> Créer la salle
                    </button>
                </div>

                <!-- ── REJOINDRE UNE SALLE ── -->
                <div class="glass" style="padding:1.75rem;border-radius:var(--radius-lg);display:flex;flex-direction:column;gap:1rem;">
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:.25rem;">
                        <div style="background:var(--accent);color:white;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;">
                            <i class="fa-solid fa-door-open"></i>
                        </div>
                        <div>
                            <h3 style="margin:0;font-size:1rem;">Rejoindre une salle</h3>
                            <p style="margin:0;font-size:.75rem;color:var(--text-muted);">Entrez le code fourni par l'hôte</p>
                        </div>
                    </div>

                    <div style="display:flex;flex-direction:column;gap:.6rem;">
                        <label style="font-size:.8rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;">Votre pseudo</label>
                        <input type="text" id="join-username" class="wiki-input" placeholder="Pseudo" value="${defaultName}" style="width:100%;">
                    </div>

                    <div style="display:flex;flex-direction:column;gap:.6rem;">
                        <label style="font-size:.8rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;">Code de la salle</label>
                        <input type="text" id="join-code" class="wiki-input" placeholder="Ex: AB3KZ" maxlength="5"
                            style="text-transform:uppercase;text-align:center;font-family:var(--font-mono);font-size:1.5rem;letter-spacing:.2em;width:100%;">
                    </div>

                    <div style="flex:1;"></div>

                    <button id="join-room-btn" class="btn-accent" style="width:100%;justify-content:center;margin-top:.5rem;">
                        <i class="fa-solid fa-arrow-right-to-bracket"></i> Rejoindre
                    </button>
                </div>
            </div>
        </div>
    `;

    // Slider manches
    const slider  = document.getElementById('create-rounds');
    const display = document.getElementById('rounds-display');
    slider.addEventListener('input', () => { display.textContent = slider.value; });

    // Créer
    document.getElementById('create-room-btn').onclick = async () => {
        const username  = document.getElementById('create-username').value.trim();
        const roomName  = document.getElementById('create-roomname').value.trim();
        const maxRounds = parseInt(document.getElementById('create-rounds').value, 10);
        const winMode   = parseInt(document.querySelector('input[name="win-mode"]:checked').value, 10);

        if (!username) { 
            showInfoModal("Pseudo manquant", "Veuillez entrer un pseudo pour créer une salle.", "error"); 
            return; 
        }
        const btn = document.getElementById('create-room-btn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Création…';
        try {
            await createRoom({ username, roomName, maxRounds, winMode });
        } catch (err) {
            showInfoModal("Échec de création", err.message || "Impossible de créer la salle.", "error");
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-play"></i> Créer la salle';
        }
    };

    // Rejoindre
    document.getElementById('join-room-btn').onclick = async () => {
        const username = document.getElementById('join-username').value.trim();
        const code     = document.getElementById('join-code').value.trim().toUpperCase();
        if (!username) { 
            showInfoModal("Pseudo manquant", "Veuillez entrer un pseudo pour rejoindre une salle.", "error"); 
            return; 
        }
        if (!code || code.length !== 5) { 
            showInfoModal("Code invalide", "Veuillez entrer un code de salle à 5 caractères.", "error"); 
            return; 
        }
        const btn = document.getElementById('join-room-btn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Connexion…';
        try {
            await joinRoom(code, username);
        } catch (err) {
            showInfoModal("Échec de connexion", err.message || "Impossible de rejoindre la salle.", "error");
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i> Rejoindre';
        }
    };

    // Forcer uppercase sur le code
    document.getElementById('join-code').addEventListener('input', e => {
        e.target.value = e.target.value.toUpperCase();
    });
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

    // 2. Check if the user already solved it today (no articleId needed)
    const isSolved = await checkDailySolved(user);

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

            // MULTIPLAYER: Reporter la progression en temps réel
            if (window.mpReportProgress) {
                const s = window.getGameState();
                window.mpReportProgress(s.foundCount, s.totalCount, s.won, s.attempts);
            }
        }
    };

    btn.addEventListener('click', submit);
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') submit();
    });
}
