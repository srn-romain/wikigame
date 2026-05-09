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

    // Arrêt des écouteurs multijoueur si on quitte la vue compétition
    if (view !== 'multiplayer' && window.mpLeaveRoom) {
        window.mpLeaveRoom();
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

        case 'ranking':
            renderRanking(container);
            break;

        case 'missions':
            renderMissions(container);
            break;
    }
}

const MISSIONS_DATA = [
    // TIER 1: Wiki de Bois (0-9)
    { id: 0, tier: 1, title: "Bienvenue", desc: "Jouer votre première partie", goal: 1, stat: "totalGamesPlayed", icon: "fa-door-open" },
    { id: 1, tier: 1, title: "Premier pas", desc: "Gagner 1 partie (Solo ou Quotidien)", goal: 1, stat: "totalWins", icon: "fa-trophy" },
    { id: 2, tier: 1, title: "Apprenti", desc: "Atteindre 10 XP", goal: 10, stat: "xp", icon: "fa-star" },
    { id: 3, tier: 1, title: "Explorateur", desc: "Jouer 5 parties au total", goal: 5, stat: "totalGamesPlayed", icon: "fa-map" },
    { id: 4, tier: 1, title: "Ponctuel", desc: "Compléter 1 défi quotidien", goal: 1, stat: "dailySolvedCount", icon: "fa-calendar-check" },
    { id: 5, tier: 1, title: "Social", desc: "Participer à 1 compétition multijoueur", goal: 1, stat: "mpGamesPlayed", icon: "fa-users" },
    { id: 6, tier: 1, title: "Persistant", desc: "Faire 50 essais dans une seule partie", goal: 50, stat: "maxAttemptsInOneGame", icon: "fa-brain" },
    { id: 7, tier: 1, title: "Curieux", desc: "Révéler 500 mots au total", goal: 500, stat: "totalWordsRevealed", icon: "fa-eye" },
    { id: 8, tier: 1, title: "Habitué", desc: "Jouer 3 jours différents", goal: 3, stat: "daysPlayed", icon: "fa-clock-rotate-left" },
    { id: 9, tier: 1, title: "Maître du Bois", desc: "Atteindre 30 XP", goal: 30, stat: "xp", icon: "fa-tree" },

    // TIER 2: Wiki de Bronze (10-19)
    { id: 10, tier: 2, title: "Vétéran", desc: "Jouer 20 parties au total", goal: 20, stat: "totalGamesPlayed", icon: "fa-shield-halved" },
    { id: 11, tier: 2, title: "Collectionneur", desc: "Gagner 10 parties", goal: 10, stat: "totalWins", icon: "fa-medal" },
    { id: 12, tier: 2, title: "Fidèle", desc: "Compléter 5 défis quotidiens", goal: 5, stat: "dailySolvedCount", icon: "fa-calendar-days" },
    { id: 13, tier: 2, title: "Compétiteur", desc: "Jouer 10 parties multijoueur", goal: 10, stat: "mpGamesPlayed", icon: "fa-user-group" },
    { id: 14, tier: 2, title: "Ascension", desc: "Atteindre 100 XP", goal: 100, stat: "xp", icon: "fa-arrow-up-right-dots" },
    { id: 15, tier: 2, title: "Lecteur", desc: "Révéler 2000 mots au total", goal: 2000, stat: "totalWordsRevealed", icon: "fa-book-open" },
    { id: 16, tier: 2, title: "Rapide", desc: "Gagner une partie en moins de 2 minutes", goal: 1, stat: "fastWins", icon: "fa-bolt" },
    { id: 17, tier: 2, title: "Savant", desc: "Trouver un article avec moins de 10 essais", goal: 1, stat: "efficientWins", icon: "fa-graduation-cap" },
    { id: 18, tier: 2, title: "Série", desc: "Jouer 5 jours consécutifs", goal: 5, stat: "streak", icon: "fa-fire" },
    { id: 19, tier: 2, title: "Maître de Bronze", desc: "Atteindre 250 XP", goal: 250, stat: "xp", icon: "fa-award" },

    // TIER 3: Wiki d'Argent (20-29)
    { id: 20, tier: 3, title: "Expert", desc: "Jouer 50 parties au total", goal: 50, stat: "totalGamesPlayed", icon: "fa-user-tie" },
    { id: 21, tier: 3, title: "Vainqueur", desc: "Gagner 25 parties", goal: 25, stat: "totalWins", icon: "fa-crown" },
    { id: 22, tier: 3, title: "Assidu", desc: "Compléter 15 défis quotidiens", goal: 15, stat: "dailySolvedCount", icon: "fa-calendar-plus" },
    { id: 23, tier: 3, title: "Podium", desc: "Finir premier dans 5 compétitions", goal: 5, stat: "mpWins", icon: "fa-ranking-star" },
    { id: 24, tier: 3, title: "Érudit", desc: "Atteindre 500 XP", goal: 500, stat: "xp", icon: "fa-book" },
    { id: 25, tier: 3, title: "百科事典", desc: "Révéler 10000 mots au total", goal: 10000, stat: "totalWordsRevealed", icon: "fa-globe" },
    { id: 26, tier: 3, title: "Éclair", desc: "Gagner en moins de 60 secondes", goal: 1, stat: "ultraFastWins", icon: "fa-bolt-lightning" },
    { id: 27, tier: 3, title: "Sniper", desc: "Trouver un article en exactement 1 essai", goal: 1, stat: "oneShotWins", icon: "fa-crosshairs" },
    { id: 28, tier: 3, title: "Légende", desc: "Jouer 30 jours au total", goal: 30, stat: "daysPlayed", icon: "fa-hourglass-half" },
    { id: 29, tier: 3, title: "Maître d'Argent", desc: "Atteindre 1000 XP", goal: 1000, stat: "xp", icon: "fa-gem" },

    // TIER 4: Wiki d'Or (30-39)
    { id: 30, tier: 4, title: "Divinité", desc: "Jouer 200 parties au total", goal: 200, stat: "totalGamesPlayed", icon: "fa-spaghetti-monster-vermillion" },
    { id: 31, tier: 4, title: "Insubmersible", desc: "Gagner 100 parties", goal: 100, stat: "totalWins", icon: "fa-anchor" },
    { id: 32, tier: 4, title: "Chronos", desc: "Compléter 50 défis quotidiens", goal: 50, stat: "dailySolvedCount", icon: "fa-stopwatch" },
    { id: 33, tier: 4, title: "Empereur", desc: "Gagner 25 compétitions multijoueur", goal: 25, stat: "mpWins", icon: "fa-chess-king" },
    { id: 34, tier: 4, title: "Prestige", desc: "Atteindre 5000 XP", goal: 5000, stat: "xp", icon: "fa-certificate" },
    { id: 35, tier: 4, title: "Omniscient", desc: "Révéler 50000 mots au total", goal: 50000, stat: "totalWordsRevealed", icon: "fa-brain" },
    { id: 36, tier: 4, title: "Maître du temps", desc: "Gagner en moins de 30 secondes", goal: 1, stat: "godSpeedWins", icon: "fa-wind" },
    { id: 37, tier: 4, title: "Perfectionniste", desc: "Gagner 5 parties sans aucune erreur", goal: 5, stat: "flawlessWins", icon: "fa-check-double" },
    { id: 38, tier: 4, title: "Infatigable", desc: "Avoir une série de 30 jours", goal: 30, stat: "streak", icon: "fa-infinity" },
    { id: 39, tier: 4, title: "Maître d'Or", desc: "Atteindre 10000 XP", goal: 10000, stat: "xp", icon: "fa-coins" }
];

async function renderMissions(container) {
    container.innerHTML = `
        <div class="loading-screen">
            <div class="loading-spinner"></div>
            <p>Chargement de vos missions...</p>
        </div>
    `;

    const { db, getDoc, doc, getCurrentUser } = await import("./firebase-app.js");
    const user = getCurrentUser();

    if (!user || user.isAnonymous) {
        container.innerHTML = `
            <div class="glass" style="max-width:500px; margin:4rem auto; padding:3rem; text-align:center;">
                <i class="fa-solid fa-lock" style="font-size:3rem; color:var(--accent); margin-bottom:1rem;"></i>
                <h2>Connectez-vous</h2>
                <p style="color:var(--text-muted); margin-top:1rem;">Vous devez avoir un compte pour suivre votre progression et accomplir des missions.</p>
                <button class="btn-primary" onclick="window.openAuthModal()" style="margin-top:2rem; width:100%; justify-content:center;">Se connecter</button>
            </div>
        `;
        return;
    }

    try {
        const snap = await getDoc(doc(db, "users", user.uid));
        const userData = snap.data() || {};
        
        // Stats de l'utilisateur (on complète avec des valeurs par défaut)
        const stats = {
            xp: userData.xp || 0,
            totalGamesPlayed: userData.totalGamesPlayed || 0,
            totalWins: userData.totalWins || (userData.dailyHistory ? userData.dailyHistory.length : 0),
            dailySolvedCount: userData.dailyHistory ? userData.dailyHistory.length : 0,
            mpGamesPlayed: userData.mpGamesPlayed || 0,
            mpWins: userData.mpWins || 0,
            totalWordsRevealed: userData.totalWordsRevealed || 0,
            maxAttemptsInOneGame: userData.maxAttemptsInOneGame || 0,
            daysPlayed: userData.daysPlayed || 1,
            streak: userData.streak || 0,
            fastWins: userData.fastWins || 0,
            ultraFastWins: userData.ultraFastWins || 0,
            godSpeedWins: userData.godSpeedWins || 0,
            efficientWins: userData.efficientWins || 0,
            oneShotWins: userData.oneShotWins || 0,
            flawlessWins: userData.flawlessWins || 0
        };

        // Calculer le nombre de missions réussies par palier
        const successes = MISSIONS_DATA.map(m => (stats[m.stat] || 0) >= m.goal);
        const totalSuccessCount = successes.filter(s => s).length;

        // Déterminer les paliers débloqués
        // Wiki de Bois (Tier 1) : Toujours débloqué
        // Wiki de Bronze (Tier 2) : Débloqué si 9 missions réussies
        // Wiki d'Argent (Tier 3) : Débloqué si 18 missions réussies
        // Wiki d'Or (Tier 4) : Débloqué si 27 missions réussies
        const unlockedTiers = {
            1: true,
            2: totalSuccessCount >= 9,
            3: totalSuccessCount >= 18,
            4: totalSuccessCount >= 27
        };

        const tierNames = ["", "Wiki de Bois", "Wiki de Bronze", "Wiki d'Argent", "Wiki d'Or"];
        const tierColors = ["", "#854d0e", "#92400e", "#64748b", "#d97706"];

        container.innerHTML = `
            <div style="max-width:1000px; margin: 2rem auto; padding: 0 1rem;">
                <div style="text-align:center; margin-bottom: 3rem;">
                    <h1 style="font-size:2.5rem; color:#111827; font-weight:800;"><i class="fa-solid fa-scroll" style="color:var(--primary);"></i> Vos Missions</h1>
                    <p style="color:#4b5563; font-weight:600;">Complétez des défis pour débloquer de nouveaux paliers de prestige.</p>
                </div>

                ${[1, 2, 3, 4].map(t => {
                    const isLocked = !unlockedTiers[t];
                    const tierMissions = MISSIONS_DATA.filter(m => m.tier === t);
                    const tierSuccessCount = tierMissions.filter(m => (stats[m.stat] || 0) >= m.goal).length;

                    return `
                        <div style="margin-bottom:4rem; ${isLocked ? 'opacity:0.6; filter:grayscale(1);' : ''}">
                            <div style="display:flex; align-items:center; gap:15px; margin-bottom:1.5rem;">
                                <div style="width:50px; height:50px; border-radius:12px; background:${tierColors[t]}; color:white; display:flex; align-items:center; justify-content:center; font-size:1.5rem;">
                                    <i class="fa-solid ${isLocked ? 'fa-lock' : 'fa-award'}"></i>
                                </div>
                                <div>
                                    <h2 style="margin:0; font-size:1.5rem; color:#111827;">${tierNames[t]}</h2>
                                    <p style="margin:0; font-size:0.9rem; color:#6b7280;">Progression : ${tierSuccessCount} / 10 missions</p>
                                </div>
                            </div>

                            <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap:1.5rem;">
                                ${tierMissions.map(m => {
                                    const current = stats[m.stat] || 0;
                                    const isDone = current >= m.goal;
                                    const percent = Math.min(100, (current / m.goal) * 100);

                                    return `
                                        <div class="glass mission-card ${isDone ? 'mission-done' : ''} ${isLocked ? 'locked' : ''}" 
                                             style="padding:1.5rem; position:relative; overflow:hidden; cursor:${isLocked ? 'not-allowed' : 'pointer'};"
                                             onclick="${isLocked ? '' : `window._showMissionDetail(${m.id}, ${current}, ${m.goal})`}">
                                            <div style="display:flex; gap:15px; align-items:flex-start;">
                                                <div style="width:40px; height:40px; border-radius:10px; background:${isDone ? '#dcfce7' : '#f3f4f6'}; color:${isDone ? '#166534' : '#6b7280'}; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                                                    <i class="fa-solid ${m.icon}"></i>
                                                </div>
                                                <div style="flex:1;">
                                                    <h3 style="margin:0; font-size:1rem; color:#111827;">${m.title}</h3>
                                                    <p style="margin:5px 0 15px; font-size:0.8rem; color:#6b7280; line-height:1.4;">${m.desc}</p>
                                                    
                                                    <div style="height:6px; background:#e5e7eb; border-radius:10px; overflow:hidden;">
                                                        <div style="height:100%; width:${percent}%; background:${isDone ? '#10b981' : 'var(--primary)'}; transition:width 0.5s;"></div>
                                                    </div>
                                                </div>
                                            </div>
                                            ${isDone ? '<i class="fa-solid fa-circle-check" style="position:absolute; top:10px; right:10px; color:#10b981; font-size:1.2rem;"></i>' : ''}
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;

    } catch (e) {
        console.error("Missions: Error loading", e);
        container.innerHTML = `<div class="glass" style="margin:2rem auto; text-align:center; padding:3rem;"><p style="color:#ef4444; font-weight:800;">Erreur lors du chargement des missions.</p></div>`;
    }
}

window._showMissionDetail = (id, current, goal) => {
    const mission = MISSIONS_DATA.find(m => m.id === id);
    if (!mission) return;

    const overlay = document.createElement('div');
    overlay.className = 'auth-modal-overlay';
    overlay.innerHTML = `
        <div class="auth-modal glass" style="max-width:400px; text-align:center;">
            <div style="width:80px; height:80px; background:rgba(var(--primary-rgb), 0.1); color:var(--primary); border-radius:20px; display:flex; align-items:center; justify-content:center; font-size:2.5rem; margin:0 auto 1.5rem;">
                <i class="fa-solid ${mission.icon}"></i>
            </div>
            <h2 style="margin-bottom:0.5rem;">${mission.title}</h2>
            <p style="color:var(--text-muted); margin-bottom:2rem;">${mission.desc}</p>
            
            <div style="background:#f9fafb; padding:1.5rem; border-radius:15px; border:1px solid #e5e7eb; margin-bottom:2rem;">
                <div style="display:flex; justify-content:space-between; margin-bottom:0.75rem; font-weight:800;">
                    <span style="color:#111827;">Progression</span>
                    <span style="color:var(--primary);">${current} / ${goal}</span>
                </div>
                <div style="height:12px; background:#e5e7eb; border-radius:10px; overflow:hidden;">
                    <div style="height:100%; width:${Math.min(100, (current/goal)*100)}%; background:var(--primary); transition:width 1s cubic-bezier(0.34, 1.56, 0.64, 1);"></div>
                </div>
                <p style="margin-top:1rem; font-size:0.8rem; color:#6b7280; font-weight:600;">
                    ${current >= goal ? 'Mission accomplie ! Bravo.' : `Encore ${goal - current} à accomplir.`}
                </p>
            </div>
            
            <button class="btn-primary" style="width:100%; justify-content:center;" onclick="this.closest('.auth-modal-overlay').remove()">Continuer</button>
        </div>
    `;
    document.body.appendChild(overlay);
};


// ─────────────────────────────────────────────
// HOME PAGE
// ─────────────────────────────────────────────
// HOME PAGE
// ─────────────────────────────────────────────
function renderHome(container) {
    container.innerHTML = `
        <div class="glass home-hero" style="max-width: 960px; margin: 2rem auto; padding: 3rem 2rem; border: none; box-shadow: 0 20px 50px rgba(0,0,0,0.15);">
            <div style="margin-bottom: 0.5rem; text-align: center;">
                <h1 class="home-title">
                    <i class="fa-brands fa-wikipedia-w"></i>
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

            <div class="feature-cards">
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

            <div style="display:flex; flex-direction:column; gap:2rem; max-width:550px; margin: 0 auto;">

                <!-- ── REJOINDRE UNE SALLE ── -->
                <div class="glass" style="padding:1.75rem;border-radius:var(--radius-lg);display:flex;flex-direction:column;gap:1rem; border: 2px solid var(--accent); background: white;">
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:.25rem;">
                        <div style="background:var(--accent);color:white;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;">
                            <i class="fa-solid fa-door-open"></i>
                        </div>
                        <div>
                            <h3 style="margin:0;font-size:1rem;">Rejoindre une salle</h3>
                            <p style="margin:0;font-size:.75rem;color:var(--text-muted);">Entrez le code fourni par l'hôte</p>
                        </div>
                    </div>

                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div style="display:flex;flex-direction:column;gap:.6rem;">
                            <label style="font-size:.7rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;">Votre pseudo</label>
                            <input type="text" id="join-username" class="wiki-input" placeholder="Pseudo" value="${defaultName}" style="width:100%; padding: 0.6rem;">
                        </div>
                        <div style="display:flex;flex-direction:column;gap:.6rem;">
                            <label style="font-size:.7rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;">Code de salle</label>
                            <input type="text" id="join-code" class="wiki-input" placeholder="ABCDE" maxlength="5" style="width:100%; text-transform:uppercase; text-align:center; font-family:var(--font-mono); font-weight:800; padding: 0.6rem;">
                        </div>
                    </div>

                    <button id="join-room-btn" class="btn-primary" style="width:100%;justify-content:center;background:var(--accent); border:none;">
                        <i class="fa-solid fa-arrow-right-to-bracket"></i> Rejoindre la partie
                    </button>
                </div>

                <div style="display:flex; align-items:center; gap: 1rem; color: white; opacity: 0.8;">
                    <hr style="flex:1; border:none; border-top: 1px solid rgba(255,255,255,0.3);">
                    <span style="font-size: 0.75rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.2em;">OU</span>
                    <hr style="flex:1; border:none; border-top: 1px solid rgba(255,255,255,0.3);">
                </div>

                <!-- ── CRÉER UNE SALLE ── -->
                <div class="glass" style="padding:2rem;border-radius:var(--radius-lg);display:flex;flex-direction:column;gap:1.2rem;">
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:.5rem;">
                        <div style="background:var(--primary);color:white;width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center; font-size: 1.2rem;">
                            <i class="fa-solid fa-plus"></i>
                        </div>
                        <div>
                            <h3 style="margin:0;font-size:1.1rem;">Créer une nouvelle salle</h3>
                            <p style="margin:0;font-size:.8rem;color:var(--text-muted);">Configurez votre propre compétition</p>
                        </div>
                    </div>

                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div style="display:flex;flex-direction:column;gap:.6rem;">
                            <label style="font-size:.8rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;">Votre pseudo</label>
                            <input type="text" id="create-username" class="wiki-input" placeholder="Pseudo" value="${defaultName}" style="width:100%;">
                        </div>
                        <div style="display:flex;flex-direction:column;gap:.6rem;">
                            <label style="font-size:.8rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;">Nom de la salle</label>
                            <input type="text" id="create-roomname" class="wiki-input" placeholder="Ex: Salon de Wiki" style="width:100%;">
                        </div>
                    </div>

                    <div style="display:flex;flex-direction:column;gap:.6rem;">
                        <label style="font-size:.8rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;">Nombre de manches</label>
                        <div style="display:flex;align-items:center;gap:1rem; background: #f9fafb; padding: 0.8rem; border-radius: 12px; border: 1px solid #eee;">
                            <input type="range" id="create-rounds" min="1" max="5" value="3" style="flex:1;accent-color:var(--primary);">
                            <span id="rounds-display" style="font-family:var(--font-mono);font-weight:800;font-size:1.4rem;color:var(--primary);min-width:2rem;text-align:center;">3</span>
                        </div>
                    </div>

                    <div style="display:flex;flex-direction:column;gap:.6rem;">
                        <label style="font-size:.8rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;">Mode de victoire</label>
                        <div id="win-mode-options" style="display:grid; grid-template-columns: 1fr; gap:.6rem;">
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

                    <button id="create-room-btn" class="btn-primary" style="width:100%;justify-content:center;margin-top:.5rem; padding: 1rem;">
                        <i class="fa-solid fa-play"></i> Lancer la compétition
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

export async function openAdminDashboard() {
    const container = document.getElementById("modal-container");
    container.innerHTML = `<div class="loading-screen"><div class="loading-spinner"></div><p>Chargement du tableau de bord admin...</p></div>`;
    container.classList.remove("hidden");

    const { db, collection, getDocs, getCountFromServer, query, orderBy, limit, doc, getDoc } = await import("./firebase-app.js");
    
    try {
        // 1. 10 derniers connectés
        const usersSnap = await getDocs(query(collection(db, "users"), orderBy("lastLoginAt", "desc"), limit(10)));
        const lastUsers = [];
        usersSnap.forEach(d => lastUsers.push(d.data()));

        // 2. Nb de salles (multiplayer)
        const roomsCountSnap = await getCountFromServer(collection(db, "rooms"));
        const roomsCount = roomsCountSnap.data().count;

        // 3. Stats globales (total games, solo games)
        const statsSnap = await getDoc(doc(db, "global_stats", "counters"));
        const globalStats = statsSnap.exists() ? statsSnap.data() : { totalGamesPlayed: 0, soloGamesPlayed: 0, roomsCreated: 0 };

        container.innerHTML = `
            <div class="auth-modal" style="width:95%; max-width: 600px; padding: 2rem;">
                <button class="close-modal" id="close-admin">&times;</button>
                <h2 style="margin-bottom: 1.5rem; display:flex; align-items:center; gap:10px;">
                    <i class="fa-solid fa-user-shield" style="color:var(--accent);"></i> Console Admin
                </h2>

                <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 15px; margin-bottom: 2rem;">
                    <div class="glass" style="padding: 1rem; text-align:center;">
                        <div style="font-size:1.5rem; font-weight:800; color:var(--primary);">${globalStats.totalGamesPlayed || 0}</div>
                        <div style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase;">Parties Totales</div>
                    </div>
                    <div class="glass" style="padding: 1rem; text-align:center;">
                        <div style="font-size:1.5rem; font-weight:800; color:var(--accent);">${globalStats.soloGamesPlayed || 0}</div>
                        <div style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase;">Parties Solo</div>
                    </div>
                    <div class="glass" style="padding: 1rem; text-align:center;">
                        <div style="font-size:1.5rem; font-weight:800; color:#3498db;">${globalStats.roomsCreated || roomsCount}</div>
                        <div style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase;">Salles Créées</div>
                    </div>
                </div>

                <h3 style="font-size:1rem; margin-bottom: 1rem;">10 Dernières Connexions</h3>
                <div style="background:rgba(0,0,0,0.03); border-radius: 12px; overflow:hidden;">
                    ${lastUsers.map(u => {
                        const date = u.lastLoginAt ? new Date(u.lastLoginAt.seconds ? u.lastLoginAt.seconds * 1000 : u.lastLoginAt).toLocaleString("fr-FR") : "Inconnu";
                        return `
                            <div style="display:flex; justify-content:space-between; padding: 10px 15px; border-bottom: 1px solid rgba(0,0,0,0.05); font-size:0.85rem;">
                                <strong>${u.pseudo || "Anonyme"}</strong>
                                <span style="color:var(--text-muted);">${date}</span>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;

        document.getElementById("close-admin").onclick = () => container.classList.add("hidden");

    } catch (e) {
        console.error("Admin: Error fetching dashboard data", e);
        container.innerHTML = `<div class="auth-modal"><p>Erreur lors du chargement des données admin.</p><button id="close-admin">Fermer</button></div>`;
        document.getElementById("close-admin").onclick = () => container.classList.add("hidden");
    }
}

window.openAdminDashboard = openAdminDashboard;

async function renderRanking(container) {
    container.innerHTML = `
        <div class="loading-screen">
            <div class="loading-spinner"></div>
            <p>Chargement du classement mondial...</p>
        </div>
    `;

    try {
        const { db, collection, getDocs, query, where, orderBy, limit, getDoc, doc, getCountFromServer, getCurrentUser } = await import("./firebase-app.js");
        const user = getCurrentUser();
        let currentUserData = null;
        let currentUserRank = null;

        if (user && !user.isAnonymous) {
            const userDoc = await getDoc(doc(db, "users", user.uid));
            if (userDoc.exists()) {
                currentUserData = userDoc.data();
                const xp = currentUserData.xp || 0;
                const countSnap = await getCountFromServer(query(collection(db, "users"), where("xp", ">", xp)));
                currentUserRank = countSnap.data().count + 1;
            }
        }

        const q = query(
            collection(db, "users"),
            where("isPublic", "==", true),
            orderBy("xp", "desc"),
            limit(50)
        );
        const snap = await getDocs(q);
        const players = [];
        let rankCounter = 1;
        snap.forEach(d => {
            players.push({ ...d.data(), actualRank: rankCounter++ });
        });

        const isInTop50 = players.some(p => p.uid === user?.uid);
        const showPersonalRow = currentUserData && !isInTop50;

        let tableRowsHtml = players.map(p => {
            const isPersonal = p.uid === user?.uid;
            const isTop3 = p.actualRank <= 3;
            const colors = ["#fbbf24", "#94a3b8", "#b45309"];
            
            return `
                <tr style="border-bottom:1px solid #f3f4f6; ${isPersonal ? 'background: #f0fdf4;' : ''}">
                    <td style="padding:1.2rem; text-align:center;">
                        ${isTop3 
                            ? `<i class="fa-solid fa-medal" style="color:${colors[p.actualRank - 1]}; font-size:1.4rem;"></i>` 
                            : `<span style="color:#111827; font-weight:800; font-family:'JetBrains Mono', monospace; font-size:1rem;">#${p.actualRank}</span>`
                        }
                    </td>
                    <td style="padding:1.2rem;">
                        <div style="display:flex; align-items:center; gap:12px;">
                            <div class="avatar-placeholder" style="width:38px; height:38px; font-size:0.9rem; background:var(--primary); color:white; font-weight:800;">
                                ${p.pseudo ? p.pseudo[0].toUpperCase() : '?'}
                            </div>
                            <div style="font-weight:800; color:#111827; font-size:1rem;">
                                ${p.pseudo || "Anonyme"} 
                                ${isPersonal ? '<span style="background:var(--primary); color:white; font-size:0.65rem; padding:2px 6px; border-radius:4px; margin-left:8px;">VOUS</span>' : ""}
                            </div>
                        </div>
                    </td>
                    <td style="padding:1.2rem; text-align:right;">
                        <span style="background:#dcfce7; color:#166534; padding:6px 14px; border-radius:20px; font-weight:800; font-size:1rem; border: 1.5px solid #bbf7d0;">
                            ${p.xp || 0} XP
                        </span>
                    </td>
                </tr>
            `;
        }).join('');

        if (showPersonalRow) {
            const isPrivate = currentUserData.isPublic === false;
            tableRowsHtml += `
                <tr style="border: 2px dashed ${isPrivate ? 'var(--accent)' : 'var(--primary)'}; background: ${isPrivate ? '#fffaf0' : '#f0fdf4'}; margin-top: 10px;">
                    <td style="padding:1.2rem; text-align:center;">
                        <span style="color:#111827; font-weight:800; font-family:'JetBrains Mono', monospace; font-size:1rem;">#${currentUserRank}</span>
                    </td>
                    <td style="padding:1.2rem;">
                        <div style="display:flex; align-items:center; gap:12px;">
                            <div class="avatar-placeholder" style="width:38px; height:38px; font-size:0.9rem; background:${isPrivate ? 'var(--accent)' : 'var(--primary)'}; color:white; font-weight:800;">
                                ${currentUserData.pseudo ? currentUserData.pseudo[0].toUpperCase() : '?'}
                            </div>
                            <div>
                                <div style="font-weight:800; color:#111827; font-size:1rem;">
                                    ${currentUserData.pseudo || "Anonyme"} 
                                    <span style="background:${isPrivate ? 'var(--accent)' : 'var(--primary)'}; color:white; font-size:0.65rem; padding:2px 6px; border-radius:4px; margin-left:8px;">VOUS</span>
                                </div>
                                ${isPrivate ? `
                                    <div style="font-size:0.75rem; color:#b45309; font-weight:700; margin-top:3px;">
                                        <i class="fa-solid fa-eye-slash"></i> Profil privé : vous seul voyez votre position
                                    </div>
                                ` : ""}
                            </div>
                        </div>
                    </td>
                    <td style="padding:1.2rem; text-align:right;">
                        <span style="background:${isPrivate ? 'var(--accent)' : '#dcfce7'}; color:${isPrivate ? 'white' : '#166534'}; padding:6px 14px; border-radius:20px; font-weight:800; font-size:1rem; border: 1.5px solid ${isPrivate ? 'transparent' : '#bbf7d0'};">
                            ${currentUserData.xp || 0} XP
                        </span>
                    </td>
                </tr>
            `;
        }

        container.innerHTML = `
            <div style="max-width:800px; margin: 2rem auto; padding: 0 1rem;">
                <div style="text-align:center; margin-bottom: 3rem;">
                    <h1 style="font-size:2.5rem; margin-bottom:0.5rem; color:#111827; font-weight:800;"><i class="fa-solid fa-trophy" style="color:#fbbf24;"></i> Classement Mondial</h1>
                    <p style="color:#111827; font-weight:800; font-size:1.2rem;">Les meilleurs décrypteurs de WIKIGAME</p>
                </div>

                <div class="glass" style="padding:0; overflow:hidden; border-radius:16px; border: 1px solid #e5e7eb; background:white; box-shadow:0 10px 25px rgba(0,0,0,0.05);">
                    <table style="width:100%; border-collapse:collapse; text-align:left;">
                        <thead style="background:#f9fafb; border-bottom:2px solid #e5e7eb;">
                            <tr>
                                <th style="padding:1.2rem; width:80px; text-align:center; color:#111827; font-weight:800; text-transform:uppercase; font-size:0.75rem; letter-spacing:0.05em;">Rang</th>
                                <th style="padding:1.2rem; color:#111827; font-weight:800; text-transform:uppercase; font-size:0.75rem; letter-spacing:0.05em;">Joueur</th>
                                <th style="padding:1.2rem; text-align:right; color:#111827; font-weight:800; text-transform:uppercase; font-size:0.75rem; letter-spacing:0.05em;">Points XP</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tableRowsHtml}
                        </tbody>
                    </table>
                </div>

                <div style="margin-top:3rem; padding: 2rem; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 16px; box-shadow:0 4px 12px rgba(0,0,0,0.02);">
                    <h4 style="margin:0 0 1rem; color:#111827; font-size:1.2rem; font-weight:800; text-align:center;">Système de Progression (XP)</h4>
                    
                    <div style="display:flex; flex-wrap:wrap; gap:1rem; justify-content:center; margin-bottom:1.5rem;">
                        <div style="flex:1; min-width:180px; padding:1rem; background:white; border-radius:12px; border:1px solid #e5e7eb; text-align:center;">
                            <span style="display:inline-block; background:#dcfce7; color:#166534; padding:4px 10px; border-radius:6px; font-weight:800; margin-bottom:8px;">+10 XP</span>
                            <div style="font-weight:700; font-size:0.9rem; color:#111827;">Défis Quotidiens</div>
                        </div>
                        <div style="flex:1; min-width:180px; padding:1rem; background:white; border-radius:12px; border:1px solid #e5e7eb; text-align:center;">
                            <span style="display:inline-block; background:#dbeafe; color:#1e40af; padding:4px 10px; border-radius:6px; font-weight:800; margin-bottom:8px;">+2 XP</span>
                            <div style="font-weight:700; font-size:0.9rem; color:#111827;">Parties Solo</div>
                        </div>
                        <div style="flex:1; min-width:180px; padding:1rem; background:white; border-radius:12px; border:1px solid #e5e7eb; text-align:center;">
                            <span style="display:inline-block; background:#fef3c7; color:#92400e; padding:4px 10px; border-radius:6px; font-weight:800; margin-bottom:8px;">0 à 8 XP</span>
                            <div style="font-weight:700; font-size:0.9rem; color:#111827;">Compétition</div>
                        </div>
                    </div>

                    <div style="background:#fff7ed; border-left:4px solid #f97316; padding:1rem; border-radius:0 8px 8px 0; font-size:0.85rem; color:#7c2d12;">
                        <p style="margin:0 0 0.5rem; font-weight:800;"><i class="fa-solid fa-circle-info"></i> Règles importantes :</p>
                        <ul style="margin:0; padding-left:1.2rem; line-height:1.6; font-weight:600;">
                            <li>En <strong>Compétition</strong>, le gain s'adapte au nombre de participants et à votre rang final.</li>
                            <li>Une victoire à 2 joueurs est plus facile et rapporte donc moins (max 2 XP).</li>
                            <li>Vous devez <strong>terminer la partie</strong> pour valider vos points. Quitter avant annule le gain.</li>
                        </ul>
                    </div>
                </div>
            </div>
        `;

    } catch (e) {
        console.error("Ranking: Error fetching users", e);
        container.innerHTML = `<div class="glass" style="margin:2rem auto; text-align:center; padding:3rem;"><p style="color:#ef4444; font-weight:800;">Erreur lors du chargement du classement.</p></div>`;
    }
}
