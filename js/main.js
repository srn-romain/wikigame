import { initGame, handleGuess } from './game.js';
import { createRoom, joinRoom } from './multiplayer.js';
import { waitForAuth, getCurrentUser } from './firebase-app.js';
import { openAuthModal, showInfoModal, showConfirmModal } from './auth.js';
import { getDailyArticleId, checkDailySolved, getCountdown, getDailySolversCount } from './daily.js';
import { getSoloDrafts, createSoloDraft, deleteSoloDraft } from './solo.js';
import { getAvatarHtml } from './avatars.js';




document.addEventListener('DOMContentLoaded', () => {
    setupNavigation();
    setupGameInputs();
    setupAuthListeners();
    navigateTo('home');

    // Register PWA Service Worker
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./service-worker.js')
                .then(reg => console.log('PWA: Service Worker registered'))
                .catch(err => console.log('PWA: Service Worker failed', err));
        });
    }
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
        const homeBtn = document.querySelector('.nav-btn[data-view="home"]');
        if (homeBtn) homeBtn.click();
        else navigateTo('home');
    });
}


function setupAuthListeners() {
    const profileBtn = document.getElementById('user-profile-btn');
    const modalContainer = document.getElementById('modal-container');

    profileBtn.onclick = async () => await openAuthModal('login');

    // Close modal when clicking outside
    modalContainer.onclick = async (e) => {
        if (e.target === modalContainer) {
            if (window.profileHandleClose) {
                await window.profileHandleClose();
            } else {
                modalContainer.classList.add('hidden');
            }
        }
    };
}

export async function navigateTo(view, force = false) {
    if (window.isGameActive && window.isGameActive()) {
        const gameState = window.getGameState ? window.getGameState() : null;
        const isAutoSavedSolo = gameState && gameState.mode === 'solo' && gameState.draftId;

        if (!force && !isAutoSavedSolo) {
            const confirmed = await showConfirmModal(
                "Partie en cours",
                "Attention : vous avez une partie en cours. Si vous changez de page maintenant, votre progression sera perdue et aucun score ne sera enregistré dans vos statistiques. Souhaitez-vous vraiment quitter ?",
                "Quitter la partie"
            );
            if (!confirmed) return;
        }

        if (isAutoSavedSolo && window.forceSaveDraft) {
            await window.forceSaveDraft();
        }

        // Reset game state
        if (window.resetGameState) window.resetGameState();
    }

    // Arrêt des écouteurs multijoueur si on quitte la vue compétition
    if (view !== 'multiplayer' && window.mpLeaveRoom) {
        window.mpLeaveRoom();
    }

    console.log(`Main: Navigating to view="${view}"`);
    window.scrollTo(0, 0);

    const homeView = document.getElementById('home-view');
    const dynamicView = document.getElementById('dynamic-view');
    const controls = document.getElementById('game-controls');
    
    // Update active nav button
    const buttons = document.querySelectorAll('.nav-btn[data-view]');
    buttons.forEach(b => {
        b.classList.toggle('active', b.dataset.view === view);
    });

    controls.classList.add('hidden');

    window.isInMpGame     = false;
    window._mpGameStarted = false;

    if (view === 'home') {
        homeView.classList.remove('hidden');
        dynamicView.classList.add('hidden');
        dynamicView.innerHTML = '';
        return;
    }

    homeView.classList.add('hidden');
    dynamicView.classList.remove('hidden');
    const container = dynamicView;

    switch (view) {
        case 'solo':
            await waitForAuth();
            renderSoloDashboard(container);
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

window.navigateTo = navigateTo;

const MISSIONS_DATA = [
    // TIER 1: Wiki de Bois (0-9)
    { id: 0, tier: 1, title: "Bienvenue", desc: "Jouer votre première partie", goal: 1, stat: "totalGamesPlayed", icon: "fa-door-open", xpReward: 5 },
    { id: 1, tier: 1, title: "Premier pas", desc: "Gagner votre première partie", goal: 1, stat: "totalWins", icon: "fa-trophy", xpReward: 5 },
    { id: 2, tier: 1, title: "Apprenti", desc: "Atteindre 10 XP totaux", goal: 10, stat: "xp", icon: "fa-star", xpReward: 5 },
    { id: 3, tier: 1, title: "Explorateur", desc: "Jouer 5 parties au total", goal: 5, stat: "totalGamesPlayed", icon: "fa-map", xpReward: 10 },
    { id: 4, tier: 1, title: "Ponctuel", desc: "Compléter 1 défi quotidien", goal: 1, stat: "dailySolvedCount", icon: "fa-calendar-check", xpReward: 10 },
    { id: 5, tier: 1, title: "Social", desc: "Participer à 1 compétition multijoueur", goal: 1, stat: "mpGamesPlayed", icon: "fa-users", xpReward: 10 },
    { id: 6, tier: 1, title: "Persistant", desc: "Faire 50 essais dans une seule partie", goal: 50, stat: "maxAttemptsInOneGame", icon: "fa-brain", xpReward: 10 },
    { id: 7, tier: 1, title: "Curieux", desc: "Révéler 500 mots au total", goal: 500, stat: "totalWordsRevealed", icon: "fa-eye", xpReward: 10 },
    { id: 8, tier: 1, title: "Habitué", desc: "Jouer 3 jours différents", goal: 3, stat: "daysPlayed", icon: "fa-clock-rotate-left", xpReward: 10 },
    { id: 9, tier: 1, title: "Maître du Bois", desc: "Atteindre 30 XP totaux", goal: 30, stat: "xp", icon: "fa-tree", xpReward: 15 },

    // TIER 2: Wiki de Pierre (40-49)
    { id: 40, tier: 2, title: "Tailleur", desc: "Jouer 10 parties au total", goal: 10, stat: "totalGamesPlayed", icon: "fa-hammer", xpReward: 20 },
    { id: 41, tier: 2, title: "Solide", desc: "Gagner 5 parties au total", goal: 5, stat: "totalWins", icon: "fa-cube", xpReward: 20 },
    { id: 42, tier: 2, title: "Fondation", desc: "Atteindre 60 XP totaux", goal: 60, stat: "xp", icon: "fa-building-columns", xpReward: 20 },
    { id: 43, tier: 2, title: "Régulier", desc: "Compléter 3 défis quotidiens", goal: 3, stat: "dailySolvedCount", icon: "fa-calendar-day", xpReward: 25 },
    { id: 44, tier: 2, title: "Défieur", desc: "Participer à 3 compétitions multijoueur", goal: 3, stat: "mpGamesPlayed", icon: "fa-user-ninja", xpReward: 25 },
    { id: 45, tier: 2, title: "Observateur", desc: "Révéler 1000 mots au total", goal: 1000, stat: "totalWordsRevealed", icon: "fa-glasses", xpReward: 25 },
    { id: 46, tier: 2, title: "Endurant", desc: "Faire 100 essais dans une seule partie", goal: 100, stat: "maxAttemptsInOneGame", icon: "fa-mountain", xpReward: 25 },
    { id: 47, tier: 2, title: "Présent", desc: "Jouer 5 jours différents", goal: 5, stat: "daysPlayed", icon: "fa-calendar-check", xpReward: 25 },
    { id: 48, tier: 2, title: "Petit feu", desc: "Avoir une série de 3 jours", goal: 3, stat: "streak", icon: "fa-fire-burner", xpReward: 30 },
    { id: 49, tier: 2, title: "Maître de Pierre", desc: "Atteindre 100 XP totaux", goal: 100, stat: "xp", icon: "fa-mountain-sun", xpReward: 40 },

    // TIER 3: Wiki de Bronze (10-19)
    { id: 10, tier: 3, title: "Vétéran", desc: "Jouer 20 parties au total", goal: 20, stat: "totalGamesPlayed", icon: "fa-shield-halved", xpReward: 50 },
    { id: 11, tier: 3, title: "Collectionneur", desc: "Gagner 10 parties", goal: 10, stat: "totalWins", icon: "fa-medal", xpReward: 50 },
    { id: 12, tier: 3, title: "Fidèle", desc: "Compléter 5 défis quotidiens", goal: 5, stat: "dailySolvedCount", icon: "fa-calendar-days", xpReward: 50 },
    { id: 13, tier: 3, title: "Compétiteur", desc: "Jouer 10 parties multijoueur", goal: 10, stat: "mpGamesPlayed", icon: "fa-user-group", xpReward: 60 },
    { id: 14, tier: 3, title: "Ascension", desc: "Atteindre 150 XP totaux", goal: 150, stat: "xp", icon: "fa-arrow-up-right-dots", xpReward: 60 },
    { id: 15, tier: 3, title: "Lecteur", desc: "Révéler 2500 mots au total", goal: 2500, stat: "totalWordsRevealed", icon: "fa-book-open", xpReward: 60 },
    { id: 16, tier: 3, title: "Rapide", desc: "Gagner une partie en moins de 2 minutes", goal: 1, stat: "fastWins", icon: "fa-bolt", xpReward: 75 },
    { id: 17, tier: 3, title: "Savant", desc: "Trouver un article avec moins de 10 essais", goal: 1, stat: "efficientWins", icon: "fa-graduation-cap", xpReward: 75 },
    { id: 18, tier: 3, title: "Série", desc: "Jouer 5 jours consécutifs", goal: 5, stat: "streak", icon: "fa-fire", xpReward: 80 },
    { id: 19, tier: 3, title: "Maître de Bronze", desc: "Atteindre 300 XP totaux", goal: 300, stat: "xp", icon: "fa-award", xpReward: 100 },

    // TIER 4: Wiki de Fer (50-59)
    { id: 50, tier: 4, title: "Forgeur", desc: "Jouer 40 parties au total", goal: 40, stat: "totalGamesPlayed", icon: "fa-fire-extinguisher", xpReward: 120 },
    { id: 51, tier: 4, title: "Acier", desc: "Gagner 20 parties au total", goal: 20, stat: "totalWins", icon: "fa-hand-fist", xpReward: 120 },
    { id: 52, tier: 4, title: "Structure", desc: "Atteindre 500 XP totaux", goal: 500, stat: "xp", icon: "fa-building", xpReward: 150 },
    { id: 53, tier: 4, title: "Assidu", desc: "Compléter 10 défis quotidiens", goal: 10, stat: "dailySolvedCount", icon: "fa-calendar-week", xpReward: 150 },
    { id: 54, tier: 4, title: "Guerrier", desc: "Gagner 5 compétitions multijoueur", goal: 5, stat: "mpWins", icon: "fa-sword", xpReward: 150 },
    { id: 55, tier: 4, title: "Analyste", desc: "Révéler 5000 mots au total", goal: 5000, stat: "totalWordsRevealed", icon: "fa-magnifying-glass-chart", xpReward: 150 },
    { id: 56, tier: 4, title: "Persévérant", desc: "Avoir une série de 7 jours", goal: 7, stat: "streak", icon: "fa-bolt-lightning", xpReward: 200 },
    { id: 57, tier: 4, title: "Inébranlable", desc: "Jouer 15 jours différents", goal: 15, stat: "daysPlayed", icon: "fa-clock", xpReward: 200 },
    { id: 58, tier: 4, title: "Efficace", desc: "Gagner une partie avec moins de 5 essais", goal: 1, stat: "efficientWins", icon: "fa-bullseye", xpReward: 200 },
    { id: 59, tier: 4, title: "Maître de Fer", desc: "Atteindre 750 XP totaux", goal: 750, stat: "xp", icon: "fa-dumbbell", xpReward: 250 },

    // TIER 5: Wiki d'Argent (20-29)
    { id: 20, tier: 5, title: "Expert", desc: "Jouer 75 parties au total", goal: 75, stat: "totalGamesPlayed", icon: "fa-user-tie", xpReward: 300 },
    { id: 21, tier: 5, title: "Vainqueur", desc: "Gagner 35 parties", goal: 35, stat: "totalWins", icon: "fa-crown", xpReward: 300 },
    { id: 22, tier: 5, title: "Méthodique", desc: "Compléter 20 défis quotidiens", goal: 20, stat: "dailySolvedCount", icon: "fa-calendar-plus", xpReward: 350 },
    { id: 23, tier: 5, title: "Podium", desc: "Finir premier dans 10 compétitions", goal: 10, stat: "mpWins", icon: "fa-ranking-star", xpReward: 350 },
    { id: 24, tier: 5, title: "Érudit", desc: "Atteindre 1000 XP totaux", goal: 1000, stat: "xp", icon: "fa-book", xpReward: 400 },
    { id: 25, tier: 5, title: "Encyclopédie", desc: "Révéler 15000 mots au total", goal: 15000, stat: "totalWordsRevealed", icon: "fa-globe", xpReward: 400 },
    { id: 26, tier: 5, title: "Éclair", desc: "Gagner en moins de 60 secondes", goal: 1, stat: "ultraFastWins", icon: "fa-bolt-lightning", xpReward: 450 },
    { id: 27, tier: 5, title: "Sniper", desc: "Trouver un article en exactement 1 essai", goal: 1, stat: "oneShotWins", icon: "fa-crosshairs", xpReward: 450 },
    { id: 28, tier: 5, title: "Légende", desc: "Jouer 30 jours au total", goal: 30, stat: "daysPlayed", icon: "fa-hourglass-half", xpReward: 500 },
    { id: 29, tier: 5, title: "Maître d'Argent", desc: "Atteindre 1500 XP totaux", goal: 1500, stat: "xp", icon: "fa-gem", xpReward: 600 },

    // TIER 6: Wiki d'Or (30-39)
    { id: 30, tier: 6, title: "Divinité", desc: "Jouer 200 parties au total", goal: 200, stat: "totalGamesPlayed", icon: "fa-spaghetti-monster-vermillion", xpReward: 750 },
    { id: 31, tier: 6, title: "Insubmersible", desc: "Gagner 100 parties", goal: 100, stat: "totalWins", icon: "fa-anchor", xpReward: 750 },
    { id: 32, tier: 6, title: "Chronos", desc: "Compléter 50 défis quotidiens", goal: 50, stat: "dailySolvedCount", icon: "fa-stopwatch", xpReward: 800 },
    { id: 33, tier: 6, title: "Empereur", desc: "Gagner 25 compétitions multijoueur", goal: 25, stat: "mpWins", icon: "fa-chess-king", xpReward: 850 },
    { id: 34, tier: 6, title: "Prestige", desc: "Atteindre 5000 XP totaux", goal: 5000, stat: "xp", icon: "fa-certificate", xpReward: 900 },
    { id: 35, tier: 6, title: "Omniscient", desc: "Révéler 50000 mots au total", goal: 50000, stat: "totalWordsRevealed", icon: "fa-brain", xpReward: 1000 },
    { id: 36, tier: 6, title: "Maître du temps", desc: "Gagner en moins de 30 secondes", goal: 1, stat: "godSpeedWins", icon: "fa-wind", xpReward: 1200 },
    { id: 37, tier: 6, title: "Perfectionniste", desc: "Gagner 5 parties avec moins de 5 erreurs", goal: 5, stat: "lowErrorWins", icon: "fa-check-double", xpReward: 1200 },
    { id: 38, tier: 6, title: "Infatigable", desc: "Avoir une série de 30 jours", goal: 30, stat: "streak", icon: "fa-infinity", xpReward: 1500 },
    { id: 39, tier: 6, title: "Maître d'Or", desc: "Atteindre 10000 XP totaux", goal: 10000, stat: "xp", icon: "fa-coins", xpReward: 2000 },

    // TIER 7: Wiki de Platine (60-69)
    { id: 60, tier: 7, title: "Noble", desc: "Jouer 500 parties au total", goal: 500, stat: "totalGamesPlayed", icon: "fa-gem", xpReward: 2000 },
    { id: 61, tier: 7, title: "Imbattable", desc: "Gagner 250 parties au total", goal: 250, stat: "totalWins", icon: "fa-trophy", xpReward: 2000 },
    { id: 62, tier: 7, title: "Élite", desc: "Atteindre 25000 XP totaux", goal: 25000, stat: "xp", icon: "fa-star-halved", xpReward: 2500 },
    { id: 63, tier: 7, title: "Dévoué", desc: "Compléter 100 défis quotidiens", goal: 100, stat: "dailySolvedCount", icon: "fa-calendar-check", xpReward: 2500 },
    { id: 64, tier: 7, title: "Suprématie", desc: "Gagner 50 compétitions multijoueur", goal: 50, stat: "mpWins", icon: "fa-crown", xpReward: 2500 },
    { id: 65, tier: 7, title: "Bibliothécaire", desc: "Révéler 100000 mots au total", goal: 100000, stat: "totalWordsRevealed", icon: "fa-book-atlas", xpReward: 3000 },
    { id: 66, tier: 7, title: "Ininterrompu", desc: "Avoir une série de 60 jours", goal: 60, stat: "streak", icon: "fa-link", xpReward: 3000 },
    { id: 67, tier: 7, title: "Ancien", desc: "Jouer 100 jours différents", goal: 100, stat: "daysPlayed", icon: "fa-landmark", xpReward: 3000 },
    { id: 68, tier: 7, title: "Précision", desc: "Gagner 20 parties avec moins de 5 erreurs", goal: 20, stat: "lowErrorWins", icon: "fa-bullseye", xpReward: 3500 },
    { id: 69, tier: 7, title: "Maître de Platine", desc: "Atteindre 50000 XP totaux", goal: 50000, stat: "xp", icon: "fa-medal", xpReward: 4000 },

    // TIER 8: Wiki de Diamant (70-79)
    { id: 70, tier: 8, title: "Éternel", desc: "Jouer 1000 parties au total", goal: 1000, stat: "totalGamesPlayed", icon: "fa-infinity", xpReward: 4000 },
    { id: 71, tier: 8, title: "Légendaire", desc: "Gagner 500 parties au total", goal: 500, stat: "totalWins", icon: "fa-wand-magic-sparkles", xpReward: 4000 },
    { id: 72, tier: 8, title: "Transcendance", desc: "Atteindre 100000 XP totaux", goal: 100000, stat: "xp", icon: "fa-mountain-city", xpReward: 4500 },
    { id: 73, tier: 8, title: "Immortel", desc: "Compléter 250 défis quotidiens", goal: 250, stat: "dailySolvedCount", icon: "fa-hourglass-end", xpReward: 4500 },
    { id: 74, tier: 8, title: "Souverain", desc: "Gagner 100 compétitions multijoueur", goal: 100, stat: "mpWins", icon: "fa-khanda", xpReward: 4500 },
    { id: 75, tier: 8, title: "Omniprésent", desc: "Révéler 500000 mots au total", goal: 500000, stat: "totalWordsRevealed", icon: "fa-earth-americas", xpReward: 5000 },
    { id: 76, tier: 8, title: "Indestructible", desc: "Avoir une série de 100 jours", goal: 100, stat: "streak", icon: "fa-shield-heart", xpReward: 5000 },
    { id: 77, tier: 8, title: "Pionnier", desc: "Jouer 200 jours différents", goal: 200, stat: "daysPlayed", icon: "fa-compass", xpReward: 5000 },
    { id: 78, tier: 8, title: "Sonic", desc: "Gagner 10 parties en moins de 30 secondes", goal: 10, stat: "godSpeedWins", icon: "fa-bolt", xpReward: 5000 },
    { id: 79, tier: 8, title: "Maître de Diamant", desc: "Atteindre 250000 XP totaux", goal: 250000, stat: "xp", icon: "fa-diamond", xpReward: 5000 },

    // TIER 9: Wiki d'Émeraude (80-89)
    { id: 80, tier: 9, title: "Ancêtre", desc: "Jouer 2000 parties au total", goal: 2000, stat: "totalGamesPlayed", icon: "fa-person-cane", xpReward: 5000 },
    { id: 81, tier: 9, title: "Dieu du Wiki", desc: "Gagner 1000 parties au total", goal: 1000, stat: "totalWins", icon: "fa-ankh", xpReward: 5000 },
    { id: 82, tier: 9, title: "Infini", desc: "Atteindre 1000000 XP totaux", goal: 1000000, stat: "xp", icon: "fa-atom", xpReward: 5000 },
    { id: 83, tier: 9, title: "Le Saint Gréal", desc: "Compléter 365 défis quotidiens", goal: 365, stat: "dailySolvedCount", icon: "fa-trophy", xpReward: 5000 },
    { id: 84, tier: 9, title: "Maître de l'Univers", desc: "Gagner 250 compétitions multijoueur", goal: 250, stat: "mpWins", icon: "fa-galaxy", xpReward: 5000 },
    { id: 85, tier: 9, title: "Omniscient Réel", desc: "Révéler 1000000 mots au total", goal: 1000000, stat: "totalWordsRevealed", icon: "fa-brain", xpReward: 5000 },
    { id: 86, tier: 9, title: "Obsessionnel", desc: "Avoir une série de 365 jours", goal: 365, stat: "streak", icon: "fa-fire-extinguisher", xpReward: 5000 },
    { id: 87, tier: 9, title: "Citoyen d'Honneur", desc: "Jouer 365 jours différents", goal: 365, stat: "daysPlayed", icon: "fa-city", xpReward: 5000 },
    { id: 88, tier: 9, title: "Lumière", desc: "Gagner 50 parties en moins de 30 secondes", goal: 50, stat: "godSpeedWins", icon: "fa-lightbulb", xpReward: 5000 },
    { id: 89, tier: 9, title: "Maître d'Émeraude", desc: "Atteindre 5000000 XP totaux", goal: 5000000, stat: "xp", icon: "fa-gem", xpReward: 5000 }
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
            lowErrorWins: userData.lowErrorWins || 0
        };

        const claimedMissions = userData.claimedMissions || [];

        // Calculer le nombre de missions réussies par palier
        const tierSuccessCounts = {};
        [1, 2, 3, 4, 5, 6, 7, 8, 9].map(t => {
            const tierMissions = MISSIONS_DATA.filter(m => m.tier === t);
            tierSuccessCounts[t] = tierMissions.filter(m => (stats[m.stat] || 0) >= m.goal || claimedMissions.includes(m.id)).length;
        });

        // Déterminer les paliers débloqués séquentiellement
        const unlockedTiers = { 1: true };
        for (let t = 2; t <= 9; t++) {
            // Un palier se débloque si le précédent est complété à au moins 90%
            unlockedTiers[t] = unlockedTiers[t - 1] && tierSuccessCounts[t - 1] >= 9;
        }

        const tierNames = ["", "Wiki de Bois", "Wiki de Pierre", "Wiki de Bronze", "Wiki de Fer", "Wiki d'Argent", "Wiki d'Or", "Wiki de Platine", "Wiki de Diamant", "Wiki d'Émeraude"];
        const tierColors = ["", "#854d0e", "#6b7280", "#b45309", "#475569", "#94a3b8", "#d97706", "#cbd5e1", "#0ea5e9", "#10b981"];

        container.innerHTML = `
            <div style="max-width:1000px; margin: 2rem auto; padding: 0 1rem;">
                <div style="text-align:center; margin-bottom: 3rem;">
                    <h1 style="font-size:2.5rem; color:white; font-weight:800;"><i class="fa-solid fa-scroll" style="color:var(--primary);"></i> Vos Missions</h1>
                    <p style="color:white; font-weight:600;">Complétez des défis pour débloquer de nouveaux paliers de prestige.</p>
                    <div style="margin-top: 1rem; display: inline-flex; gap: 1rem; flex-wrap: wrap; justify-content: center;">
                        <span style="background: rgba(255,255,255,0.1); backdrop-filter: blur(5px); color: white; padding: 6px 12px; border-radius: 20px; font-size: 0.8rem; border: 1px solid rgba(255,255,255,0.2);">
                            <i class="fa-solid fa-gift" style="color:var(--accent); margin-right:5px;"></i> Bonus de palier : <b>+10 à +5000 XP</b>
                        </span>
                        <span style="background: rgba(255,255,255,0.1); backdrop-filter: blur(5px); color: white; padding: 6px 12px; border-radius: 20px; font-size: 0.8rem; border: 1px solid rgba(255,255,255,0.2);">
                            <i class="fa-solid fa-crown" style="color:#fbbf24; margin-right:5px;"></i> Grand Maître : <b>+10000 XP</b>
                        </span>
                    </div>
                </div>

                ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(t => {
                    const isLocked = !unlockedTiers[t];
                    const tierMissions = MISSIONS_DATA.filter(m => m.tier === t);
                    const tierSuccessCount = tierMissions.filter(m => (stats[m.stat] || 0) >= m.goal || claimedMissions.includes(m.id)).length;
                    const displaySuccessCount = isLocked ? 0 : tierSuccessCount;

                    let orangeText = '';
                    if (isLocked) {
                        if (unlockedTiers[t-1]) {
                            const prevTierCount = tierSuccessCounts[t-1] || 0;
                            const missionsLeft = 9 - prevTierCount;
                            orangeText = `<p style="margin:5px 0 0; font-size:0.85rem; color:#f97316; font-weight:700;">Encore ${missionsLeft} mission${missionsLeft > 1 ? 's' : ''} du palier précédent à valider (${prevTierCount}/9)</p>`;
                        } else {
                            orangeText = `<p style="margin:5px 0 0; font-size:0.8rem; color:#f97316; font-weight:600; opacity:0.8;">Débloquez d'abord le palier précédent</p>`;
                        }
                    }

                    return `
                        <div style="margin-bottom:4rem; ${isLocked ? 'opacity:0.6; filter:grayscale(1);' : ''}">
                            <div style="display:flex; align-items:center; gap:15px; margin-bottom:1.5rem;">
                                <div style="width:50px; height:50px; border-radius:12px; background:${tierColors[t]}; color:white; display:flex; align-items:center; justify-content:center; font-size:1.5rem;">
                                    <i class="fa-solid ${isLocked ? 'fa-lock' : 'fa-award'}"></i>
                                </div>
                                <div>
                                    <h2 style="margin:0; font-size:1.5rem; color:#111827;">${tierNames[t]}</h2>
                                    <div style="display:flex; align-items:center; gap:10px;">
                                        <p style="margin:0; font-size:0.9rem; color:white; font-weight:600;">Progression : ${displaySuccessCount} / 10 missions</p>
                                        ${displaySuccessCount === 10 ? `<span style="background:var(--accent); color:white; font-size:0.7rem; font-weight:900; padding:2px 8px; border-radius:10px; box-shadow:0 0 10px rgba(var(--accent-rgb), 0.5);">+${[0, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000][t]} XP BONUS</span>` : `<span style="color:rgba(255,255,255,0.7); font-size:0.7rem; font-weight:600;">(Bonus : +${[0, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000][t]} XP)</span>`}
                                    </div>
                                    ${orangeText}
                                </div>
                            </div>

                            <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap:1.5rem;">
                                ${tierMissions.map(m => {
                                    const actualValue = stats[m.stat] || 0;
                                    const current = isLocked ? 0 : actualValue;
                                    const isDone = !isLocked && actualValue >= m.goal;
                                    const isClaimed = claimedMissions.includes(m.id);
                                    const percent = isLocked ? 0 : Math.min(100, (actualValue / m.goal) * 100);

                                    return `
                                        <div class="glass mission-card ${isDone ? 'mission-done' : ''} ${isLocked ? 'locked' : ''} ${isClaimed ? 'claimed' : ''}" 
                                             style="padding:1.5rem; position:relative; overflow:hidden; cursor:${isLocked ? 'not-allowed' : 'pointer'};"
                                             onclick="${isLocked ? '' : `window._showMissionDetail(${m.id}, ${actualValue}, ${m.goal}, ${isClaimed})`}">
                                            <div style="display:flex; gap:15px; align-items:flex-start;">
                                                <div style="width:40px; height:40px; border-radius:10px; background:${isDone ? (isClaimed ? '#f1f5f9' : '#dcfce7') : '#f3f4f6'}; color:${isDone ? (isClaimed ? '#94a3b8' : '#166534') : '#6b7280'}; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                                                    <i class="fa-solid ${m.icon}"></i>
                                                </div>
                                                <div style="flex:1;">
                                                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                                                        <h3 style="margin:0; font-size:1rem; color:#111827;">${m.title}</h3>
                                                        <span style="font-size:0.7rem; font-weight:800; color:var(--primary); background:rgba(var(--primary-rgb), 0.1); padding:2px 6px; border-radius:4px;">+${m.xpReward} XP</span>
                                                    </div>
                                                    <p style="margin:0 0 15px; font-size:0.8rem; color:#6b7280; line-height:1.4;">${m.desc}</p>
                                                    
                                                    <div style="height:6px; background:#e5e7eb; border-radius:10px; overflow:hidden;">
                                                        <div style="height:100%; width:${percent}%; background:${isDone ? (isClaimed ? '#94a3b8' : '#10b981') : 'var(--primary)'}; transition:width 0.5s;"></div>
                                                    </div>
                                                </div>
                                            </div>
                                            ${isDone && !isClaimed ? `
                                                <div style="position:absolute; top:0; right:0; padding:4px 8px; background:#10b981; color:white; font-size:0.6rem; font-weight:800; border-bottom-left-radius:8px;">PRÊT</div>
                                            ` : ''}
                                            ${isClaimed ? '<i class="fa-solid fa-circle-check" style="position:absolute; top:10px; right:10px; color:#94a3b8; font-size:1.2rem;"></i>' : ''}
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

window._showMissionDetail = (id, current, goal, isClaimed) => {
    // Éviter les doublons
    if (document.getElementById('mission-detail-modal')) return;

    const mission = MISSIONS_DATA.find(m => m.id === id);
    if (!mission) return;

    const isDone = current >= goal;

    const overlay = document.createElement('div');
    overlay.id = 'mission-detail-modal';
    overlay.style.cssText = `
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(8px);
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1rem;
        animation: fadeIn 0.3s ease;
    `;

    overlay.innerHTML = `
        <div class="glass" style="max-width:400px; width:100%; text-align:center; padding:2rem; border-radius:24px; border:1px solid rgba(255,255,255,0.2); box-shadow:0 25px 50px -12px rgba(0,0,0,0.5); animation: scaleUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);">
            <div style="width:80px; height:80px; background:rgba(var(--primary-rgb), 0.2); color:var(--primary); border-radius:20px; display:flex; align-items:center; justify-content:center; font-size:2.5rem; margin:0 auto 1.5rem;">
                <i class="fa-solid ${mission.icon}"></i>
            </div>
            <h2 style="margin-bottom:0.5rem; color:#111827;">${mission.title}</h2>
            <p style="color:#4b5563; margin-bottom:1.5rem; font-weight:600;">${mission.desc}</p>
            
            <div style="background:#f9fafb; padding:1.5rem; border-radius:15px; border:1px solid #e5e7eb; margin-bottom:2rem;">
                <div style="display:flex; justify-content:space-between; margin-bottom:0.75rem; font-weight:800;">
                    <span style="color:#111827;">Progression</span>
                    <span style="color:var(--primary);">${current} / ${goal}</span>
                </div>
                <div style="height:12px; background:#e5e7eb; border-radius:10px; overflow:hidden;">
                    <div style="height:100%; width:${Math.min(100, (current/goal)*100)}%; background:var(--primary); transition:width 1s cubic-bezier(0.34, 1.56, 0.64, 1);"></div>
                </div>
                <div style="margin-top:1.2rem; display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-size:0.8rem; color:#6b7280; font-weight:700;">Récompense :</span>
                    <span style="font-weight:900; color:var(--accent); font-size:1.1rem;">+${mission.xpReward} XP</span>
                </div>
            </div>
            
            ${isDone && !isClaimed ? `
                <button class="btn-accent" style="width:100%; justify-content:center; margin-bottom:0.75rem;" onclick="window._claimMission(${mission.id})">
                    <i class="fa-solid fa-gift"></i> RÉCUPÉRER L'XP
                </button>
            ` : ''}
            
            <button class="btn-primary" style="width:100%; justify-content:center;" onclick="document.getElementById('mission-detail-modal').remove()">
                ${isClaimed ? 'Déjà récupéré' : 'Continuer'}
            </button>
        </div>
    `;

    // Fermer en cliquant sur l'overlay
    overlay.onclick = (e) => {
        if (e.target === overlay) overlay.remove();
    };

    document.body.appendChild(overlay);
};

window._claimMission = async (id) => {
    const btn = document.querySelector('#mission-detail-modal .btn-accent');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Traitement...';
    }

    const mission = MISSIONS_DATA.find(m => m.id === id);
    if (!mission) return;

    const { db, updateDoc, doc, getDoc, increment, arrayUnion, getCurrentUser } = await import("./firebase-app.js");
    const user = getCurrentUser();
    if (!user) return;

    try {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        const userData = userSnap.data() || {};
        
        const claimedMissions = userData.claimedMissions || [];
        const claimedTierBonuses = userData.claimedTierBonuses || [];
        const hasFullBonus = userData.claimedFullCompletionBonus || false;
        
        // Nouvelle liste avec la mission actuelle
        const newClaimed = [...claimedMissions, id];
        let totalBonusXP = mission.xpReward;
        let bonusMsg = `Félicitations ! Vous avez gagné ${mission.xpReward} XP.`;

        // 1. Vérifier bonus de palier (10xp, 20xp, 30xp, 40xp)
        const tierMissions = MISSIONS_DATA.filter(m => m.tier === mission.tier);
        const allTierDone = tierMissions.every(m => newClaimed.includes(m.id));
        
        const updates = {
            xp: increment(mission.xpReward),
            claimedMissions: arrayUnion(mission.id)
        };

        if (allTierDone && !claimedTierBonuses.includes(mission.tier)) {
            const tierBonusMap = [0, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
            const tierBonus = tierBonusMap[mission.tier] || 0;
            
            updates.xp = increment(mission.xpReward + tierBonus);
            updates.claimedTierBonuses = arrayUnion(mission.tier);
            bonusMsg += `\n\n🎉 BONUS DE PALIER : +${tierBonus} XP pour avoir complété le ${mission.tier === 1 ? '1er' : mission.tier + 'ème'} palier !`;
        }

        // 2. Vérifier bonus final (10000xp)
        const allMissionsDone = MISSIONS_DATA.every(m => newClaimed.includes(m.id));
        if (allMissionsDone && !hasFullBonus) {
            let finalIncrement = mission.xpReward;
            
            // Re-calculer le bonus de palier si applicable pour l'increment final
            if (allTierDone && !claimedTierBonuses.includes(mission.tier)) {
                const tierBonusMap = [0, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
                finalIncrement += (tierBonusMap[mission.tier] || 0);
            }
            
            finalIncrement += 10000; // Bonus Grand Maître augmenté
            
            updates.xp = increment(finalIncrement);
            updates.claimedFullCompletionBonus = true;
            bonusMsg += `\n\n🏆 GRAND SUCCÈS : +10000 XP pour avoir terminé TOUTES les missions ! INCROYABLE !`;
        }

        await updateDoc(userRef, updates);
        
        // Effet de succès et rechargement
        document.getElementById('mission-detail-modal').remove();
        renderMissions(document.getElementById('dynamic-view'));
        
        // Notification
        showInfoModal("Mission Accomplie", bonusMsg, "success");
    } catch (e) {
        console.error("Claim: Error", e);
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = 'Erreur...';
        }
    }
};


// ─────────────────────────────────────────────
// HOME PAGE
// ─────────────────────────────────────────────
// HOME PAGE
// ─────────────────────────────────────────────
// renderHome est supprimé car le contenu est statique dans index.html


// ─────────────────────────────────────────────
// SOLO DASHBOARD (Brouillons)
// ─────────────────────────────────────────────
async function renderSoloDashboard(container) {
    console.log("Main: Rendering Solo Dashboard...");
    const user = getCurrentUser();
    
    if (!user || user.isAnonymous) {
        container.innerHTML = `
            <div style="max-width:500px;margin:3rem auto;padding:2.5rem;text-align:center;border-radius:var(--radius-lg);" class="glass">
                <i class="fa-solid fa-user-lock" style="font-size:3rem;color:var(--accent);margin-bottom:1rem;"></i>
                <h2 style="margin:0 0 1rem;">Sauvegarde Solo</h2>
                <p style="color:var(--text-muted);margin:0 0 2rem;">Connectez-vous pour pouvoir sauvegarder vos parties en cours et les reprendre plus tard !</p>
                <div style="display:flex; flex-direction:column; gap:10px;">
                    <button class="btn-primary" onclick="document.getElementById('user-profile-btn').click()" style="justify-content:center;width:100%;padding:1rem;">
                        <i class="fa-solid fa-right-to-bracket"></i> Se connecter / S'inscrire
                    </button>
                    <button class="btn-accent" onclick="window.initSoloNoDraft()" style="background:#475569; box-shadow:none;">
                         Jouer sans sauvegarder
                    </button>
                </div>
            </div>
        `;
        window.initSoloNoDraft = () => initGame('solo');
        return;
    }

    container.innerHTML = `
        <div class="loading-screen">
            <div class="loading-spinner"></div>
            <p>Chargement de vos brouillons...</p>
        </div>
    `;

    try {
        const drafts = await getSoloDrafts(user.uid);
        const canStartNew = drafts.length < 5;

        container.innerHTML = `
            <div style="max-width:800px; margin:2rem auto; padding:0 1rem;">
                <div class="glass" style="padding:2.5rem; border-radius:24px;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:2rem; flex-wrap:wrap; gap:1.5rem;">
                        <div>
                            <h2 style="font-size:1.8rem; font-weight:800; color:#111827; margin:0;">Mode Solo</h2>
                            <p style="color:#6b7280; margin:5px 0 0;">Gérez vos parties en cours (${drafts.length}/5)</p>
                        </div>
                        <button id="btn-new-solo" class="btn-accent" ${!canStartNew ? 'disabled' : ''} style="padding:0.8rem 1.5rem; ${!canStartNew ? 'opacity:0.5; cursor:not-allowed;' : ''}">
                            <i class="fa-solid fa-plus"></i> Nouvelle Partie
                        </button>
                    </div>

                    ${!canStartNew ? `
                        <div style="background:#fef2f2; border:1px solid #fecaca; color:#dc2626; padding:1rem; border-radius:12px; margin-bottom:1.5rem; font-size:0.85rem; display:flex; align-items:center; gap:10px;">
                            <i class="fa-solid fa-circle-info"></i>
                            Limite atteinte : Vous devez terminer une partie en cours avant d'en lancer une nouvelle.
                        </div>
                    ` : ''}

                    <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); gap:1rem;">
                        ${drafts.length === 0 ? `
                            <div style="grid-column:1/-1; padding:2rem 1rem; text-align:center; border:2px dashed #e5e7eb; border-radius:20px; color:#9ca3af; word-break: break-word;">
                                <i class="fa-solid fa-folder-open" style="font-size:2rem; margin-bottom:1rem; display:block;"></i>
                                <span style="display:block; max-width: 100%;">Aucun brouillon en cours. Lancez une nouvelle partie !</span>
                            </div>
                        ` : drafts.map(d => {
                            const remainingDays = Math.ceil((d.expireDate - new Date()) / (1000 * 60 * 60 * 24));
                            const lastActivity = d.lastSavedAt || d.createdAt;
                            return `
                                <div class="solo-draft-card" onclick="window.loadSolo('${d.id}', '${d.articleId}')">
                                    <div class="draft-header">
                                        <div class="draft-badge">
                                            <i class="fa-solid fa-hourglass-half"></i> ${remainingDays}j restants
                                        </div>
                                        <button class="draft-delete" onclick="event.stopPropagation(); window.confirmDeleteSolo('${d.id}')">
                                            <i class="fa-solid fa-xmark"></i>
                                        </button>
                                    </div>
                                    
                                    <div class="draft-body">
                                        <div class="draft-icon"><i class="fa-brands fa-wikipedia-w"></i></div>
                                        <div class="draft-info">
                                            <h3>Article Mystère</h3>
                                            <p>Activité : ${new Date(lastActivity).toLocaleDateString()}</p>
                                        </div>
                                    </div>

                                    <div class="draft-stats">
                                        <div class="stat-item">
                                            <span class="label">Essais</span>
                                            <span class="value">${d.attempts}</span>
                                        </div>
                                        <div class="stat-item">
                                            <span class="label">Mots</span>
                                            <span class="value">${d.foundCount}</span>
                                        </div>
                                    </div>
                                    
                                    <div class="draft-footer">
                                        <span>Reprendre la recherche</span>
                                        <i class="fa-solid fa-chevron-right"></i>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            </div>
        `;

        // Handlers
        const btnNew = document.getElementById('btn-new-solo');
        if (btnNew && canStartNew) {
            btnNew.onclick = async () => {
                btnNew.disabled = true;
                btnNew.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Recherche...';
                try {
                    const { draftId, article } = await createSoloDraft(user.uid);
                    await initGame('solo', article.id, false, draftId);
                } catch (e) {
                    showInfoModal("Erreur", e.message, "error");
                    btnNew.disabled = false;
                    btnNew.innerHTML = '<i class="fa-solid fa-plus"></i> Nouvelle Partie';
                }
            };
        }

        window.loadSolo = (draftId, articleId) => {
            initGame('solo', articleId, false, draftId);
        };

        window.confirmDeleteSolo = async (id) => {
            const ok = await showConfirmModal("Supprimer ?", "Voulez-vous vraiment abandonner cette partie ? Cette action est irréversible.", "Supprimer");
            if (ok) {
                await deleteSoloDraft(id);
                renderSoloDashboard(container);
            }
        };

    } catch (e) {
        console.error(e);
        container.innerHTML = `<div class="glass wiki-content error-box">Erreur de chargement des brouillons.</div>`;
    }
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
                <p style="color:white;font-size:.9rem;">Créez votre salle ou rejoignez-en une existante.</p>
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
    const container = document.getElementById('dynamic-view');
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

        if (!user || user.isAnonymous) {
            container.innerHTML = `
                <div class="glass" style="max-width:500px; margin:4rem auto; padding:3.5rem 2rem; text-align:center; border-radius:24px; box-shadow:0 20px 50px rgba(0,0,0,0.1);">
                    <i class="fa-solid fa-lock" style="font-size:3.5rem; color:var(--accent); margin-bottom:1.5rem;"></i>
                    <h2 style="font-weight:800; color:#111827;">Classement Mondial</h2>
                    <p style="color:var(--text-muted); margin-top:1rem; line-height:1.6; font-weight:600;">
                        Connectez-vous pour rejoindre la compétition, gagner de l'XP et voir votre rang parmi les meilleurs joueurs !
                    </p>
                    <button class="btn-primary" onclick="window.openAuthModal()" style="margin-top:2.5rem; width:100%; justify-content:center; padding:1rem; font-size:1rem;">
                        <i class="fa-solid fa-right-to-bracket"></i> Se connecter pour participer
                    </button>
                </div>
            `;
            return;
        }

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
                            ${getAvatarHtml(p.avatarId || 0, "38px", "0.9rem")}

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
                            ${getAvatarHtml(currentUserData.avatarId || 0, "38px", "0.9rem")}

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
                    <h1 style="font-size:2.5rem; margin-bottom:0.5rem; color:white; font-weight:800;"><i class="fa-solid fa-trophy" style="color:#fbbf24;"></i> Classement Mondial</h1>
                    <p style="color:white; font-weight:800; font-size:1.2rem;">Les meilleurs décrypteurs de WIKIGAME</p>
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
