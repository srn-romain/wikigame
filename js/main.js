import { initGame, handleGuess } from './game.js';
import { createRoom, joinRoom } from './multiplayer.js';
import { db, doc, getDoc, setDoc } from './firebase-app.js';
import { fetchRandomArticle } from './wiki.js';

document.addEventListener('DOMContentLoaded', () => {
    setupNavigation();
    setupGameInputs();

    // Default View
    navigateTo('home');
});

/**
 * Navigation Logic
 */
function setupNavigation() {
    const buttons = document.querySelectorAll('.nav-btn');
    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            navigateTo(btn.dataset.view);
        });
    });

    document.querySelector('.logo').addEventListener('click', () => navigateTo('home'));
}

async function navigateTo(view) {
    const container = document.getElementById('main-container');
    const controls = document.getElementById('game-controls');
    controls.classList.add('hidden');
    window.isInMpGame = false; // Reset MP flag

    switch (view) {
        case 'home':
            renderHome(container);
            break;

        case 'solo':
            initGame('solo');
            break;

        case 'daily':
            await loadDailyChallenge();
            break;

        case 'multiplayer':
            renderMultiplayerMenu(container);
            break;
    }
}

function renderHome(container) {
    container.innerHTML = `
        <div class="glass" style="padding: 3rem; text-align: center; border-radius: 20px; margin-top: 2rem;">
            <h1 style="font-size: 3rem; margin-bottom: 1rem; font-family: var(--font-heading);">
                Bienvenue sur <span style="color:var(--primary);">WIKI</span><span style="color:white;">REVEAL</span>
            </h1>
            <p style="font-size: 1.2rem; color: var(--text-muted); margin-bottom: 2rem; max-width: 600px; margin: 0 auto;">
                Le jeu de déduction ultime. Une page Wikipédia a été censurée. 
                Retrouvez les mots cachés pour révéler le sujet de l'article.
            </p>
            
            <div style="display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap;">
                <button class="nav-btn" style="background: var(--primary); color: white; padding: 1rem 2rem; font-size: 1.1rem;" onclick="document.querySelector('[data-view=solo]').click()">
                    <i class="fa-solid fa-play"></i> Mode Solo
                </button>
                <button class="nav-btn" style="background: var(--accent); color: white; padding: 1rem 2rem; font-size: 1.1rem;" onclick="document.querySelector('[data-view=daily]').click()">
                    <i class="fa-solid fa-calendar-day"></i> Défi du Jour
                </button>
            </div>
            
             <div style="margin-top: 3rem; display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem;">
                <div style="padding: 1.5rem; background: rgba(0,0,0,0.2); border-radius: 12px; text-align: left;">
                    <i class="fa-solid fa-earth-europe" style="font-size: 2rem; color: var(--primary); margin-bottom: 10px;"></i>
                    <h3>Culture Générale</h3>
                    <p style="font-size: 0.9rem; color: var(--text-muted);">Explorez des milliers d'articles au hasard.</p>
                </div>
                <div style="padding: 1.5rem; background: rgba(0,0,0,0.2); border-radius: 12px; text-align: left;">
                    <i class="fa-solid fa-users" style="font-size: 2rem; color: var(--accent); margin-bottom: 10px;"></i>
                    <h3>Multijoueur</h3>
                    <p style="font-size: 0.9rem; color: var(--text-muted);">Affrontez vos amis en temps réel.</p>
                </div>
            </div>
        </div>
    `;
}

function renderMultiplayerMenu(container) {
    container.innerHTML = `
        <div class="glass" style="padding: 2rem; text-align: center; border-radius: 16px; margin-top:2rem; max-width: 600px; margin-left: auto; margin-right: auto;">
            <i class="fa-solid fa-users-line" style="font-size: 3rem; color: var(--accent); margin-bottom: 1rem;"></i>
            <h2>Mode Compétition</h2>
            <p style="margin-bottom: 2rem; color: var(--text-muted);">Créez un salon ou rejoignez une partie existante avec un code.</p>
            
            <div id="lobby-ui" style="display: flex; flex-direction: column; gap: 1rem;">
                 <input type="text" id="username-input" placeholder="Votre Pseudo" style="padding: 15px; border-radius: 12px; border: 1px solid var(--glass-border); background: rgba(0,0,0,0.3); color: white;">
                 
                 <div style="display: flex; gap: 10px;">
                     <button id="create-room-btn" class="nav-btn" style="flex: 1; background:var(--primary); color:white; padding: 1rem;">Créer une Salle</button>
                 </div>
                 
                 <div style="position: relative; margin: 1rem 0;">
                    <hr style="border: 0; border-top: 1px solid var(--glass-border);">
                    <span style="position: absolute; top: -10px; left: 50%; transform: translateX(-50%); background: var(--bg-dark); padding: 0 10px; color: var(--text-muted); font-size: 0.8rem;">OU</span>
                 </div>

                 <div style="display: flex; gap: 10px;">
                     <input type="text" id="room-code-input" placeholder="Code de la salle" style="flex: 2; padding: 15px; border-radius: 12px; border: 1px solid var(--glass-border); background: rgba(0,0,0,0.3); color: white; text-transform: uppercase;">
                     <button id="join-room-btn" class="nav-btn" style="flex: 1; background:var(--bg-card); border: 1px solid var(--glass-border); color:white;">Rejoindre</button>
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

async function loadDailyChallenge() {
    const container = document.getElementById('main-container');
    container.innerHTML = `<div class="glass wiki-content" style="text-align:center;">Chargement du défi du jour...</div>`;

    // 1. Get Today's Date String (YYYY-MM-DD)
    const today = new Date().toISOString().split('T')[0];
    const dailyRef = doc(db, "dailies", today);

    try {
        const snap = await getDoc(dailyRef);
        let articleId;

        if (snap.exists()) {
            articleId = snap.data().articleId;
        } else {
            // Be the first to generate it!
            let article;
            let attempts = 0;
            let valid = false;

            while (!valid && attempts < 5) {
                article = await fetchRandomArticle();
                if (!article) break;

                // Check redundancy (Optimized for Firestore Free Tier)
                // We check a separate doc tracking usage
                const historyRef = doc(db, "used_articles", article.id);
                const historySnap = await getDoc(historyRef);

                if (historySnap.exists()) {
                    const lastUsed = historySnap.data().lastUsed; // Timestamp
                    const diffDays = (Date.now() - lastUsed) / (1000 * 60 * 60 * 24);
                    if (diffDays < 300) {
                        console.log("Article duplicated within 300 days, retrying...");
                        attempts++;
                        continue;
                    }
                }
                valid = true;
            }

            if (!article) throw new Error("Impossible de récupérer un article valide.");

            // Transaction-like write (Batched)
            await setDoc(dailyRef, {
                articleId: article.id,
                title: article.title,
                createdAt: Date.now()
            });

            // Mark as used
            await setDoc(doc(db, "used_articles", article.id), {
                lastUsed: Date.now()
            });

            articleId = article.id;
        }

        initGame('daily', articleId);

    } catch (e) {
        console.error(e);
        container.innerHTML = `<div class="glass wiki-content" style="text-align:center; color: red;">Erreur chargement défi quotidien.<br>${e.message}</div>`;
    }
}

/**
 * Game Inputs
 */
function setupGameInputs() {
    const input = document.getElementById('guess-input');
    const btn = document.getElementById('submit-guess');

    const submit = () => {
        const val = input.value;
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
