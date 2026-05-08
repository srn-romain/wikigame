import { db, currentUser, collection, doc, setDoc, getDoc, updateDoc, onSnapshot } from './firebase-app.js';
import { fetchRandomArticle } from './wiki.js';
import { initGame } from './game.js';

let currentRoomSubscription = null;
let currentRoomId = null;

/**
 * UI References (Dynamically found)
 */
const getLobbyUI = () => document.getElementById('lobby-ui');

/**
 * Create a new Room
 */
export async function createRoom(username) {
    if (!currentUser) { alert("Connexion en cours..."); return; }

    const roomId = generateRoomCode();
    currentRoomId = roomId;

    const roomRef = doc(db, "lobbies", roomId);

    await setDoc(roomRef, {
        hostId: currentUser.uid,
        state: "WAITING", // WAITING, PLAYING, FINISHED
        createdAt: Date.now(),
        players: {
            [currentUser.uid]: {
                name: username || "Hôte",
                score: 0,
                finished: false,
                isHost: true
            }
        },
        articleId: null // Populated on start
    });

    subscribeToRoom(roomId);
}

/**
 * Join an existing Room
 */
export async function joinRoom(roomId, username) {
    if (!currentUser) return;
    roomId = roomId.toUpperCase();

    const roomRef = doc(db, "lobbies", roomId);
    const snap = await getDoc(roomRef);

    if (!snap.exists()) {
        alert("Salle introuvable !");
        return;
    }

    if (snap.data().state !== "WAITING") {
        alert("La partie a déjà commencé !");
        return;
    }

    // Add player
    await updateDoc(roomRef, {
        [`players.${currentUser.uid}`]: {
            name: username || `Joueur-${currentUser.uid.slice(0, 4)}`,
            score: 0,
            finished: false,
            isHost: false
        }
    });

    currentRoomId = roomId;
    subscribeToRoom(roomId);
}

/**
 * Listen to Room changes
 */
function subscribeToRoom(roomId) {
    if (currentRoomSubscription) currentRoomSubscription(); // Unsub existing

    const roomRef = doc(db, "lobbies", roomId);

    currentRoomSubscription = onSnapshot(roomRef, (doc) => {
        if (!doc.exists()) return;
        const data = doc.data();

        renderLobby(data, roomId);

        // Check if game started
        if (data.state === "PLAYING" && !window.isInMpGame) {
            window.isInMpGame = true; // Prevent re-trigger
            startMpGame(data.articleId);
        }
    });
}

/**
 * Host starts the game
 */
export async function startMatch() {
    if (!currentRoomId) return;

    // Fetch a random article ID to share
    const article = await fetchRandomArticle();
    if (!article) return;

    const roomRef = doc(db, "lobbies", currentRoomId);
    await updateDoc(roomRef, {
        state: "PLAYING",
        articleId: article.id,
        startTime: Date.now()
    });
}

function startMpGame(articleId) {
    // Switch View to Game
    // We import initGame from game.js
    // We need to inject a callback to report progress

    // Set a global reporting hook
    window.mpReportProgress = (found, total, finished, attempts) => {
        reportProgress(found, total, finished, attempts);
    };

    initGame('multiplayer', articleId);
}

async function reportProgress(found, total, finished, attempts) {
    if (!currentRoomId || !currentUser) return;

    const roomRef = doc(db, "lobbies", currentRoomId);
    await updateDoc(roomRef, {
        [`players.${currentUser.uid}.score`]: found,
        [`players.${currentUser.uid}.finished`]: finished,
        [`players.${currentUser.uid}.attempts`]: attempts
    });
}

/**
 * Render Lobby UI
 */
function renderLobby(data, roomId) {
    const container = document.getElementById('main-container');

    // If playing, we might show a sidebar or minimal scoreboard instead of full lobby
    if (data.state === 'PLAYING') {
        // Maybe render leaderboard in a modal or side div?
        // For now, let's just log it or update a dedicated scoreboard element if it exists
        return;
    }

    const isHost = data.hostId === currentUser.uid;

    let playersList = Object.values(data.players).map(p => `
        <div class="glass" style="padding:10px; display:flex; justify-content:space-between; margin-bottom:5px;">
            <span>${p.isHost ? '<i class="fa-solid fa-crown" style="color:gold;"></i> ' : ''}${p.name}</span>
            <span style="color:var(--text-muted);">${p.finished ? 'Terminé' : 'Prêt'}</span>
        </div>
    `).join('');

    container.innerHTML = `
        <div class="glass" style="padding: 2rem; max-width: 600px; margin: 2rem auto; border-radius: 16px;">
            <div style="text-align: center; margin-bottom: 2rem;">
                <h2 style="font-size: 2rem;">Salle d'attente</h2>
                <div style="font-size: 3rem; font-family: var(--font-mono); color: var(--primary); letter-spacing: 5px; margin: 1rem 0;">
                    ${roomId}
                </div>
                <p>Partagez ce code avec vos amis</p>
            </div>

            <div style="margin-bottom: 2rem;">
                <h3 style="margin-bottom: 1rem;">Joueurs (${Object.keys(data.players).length}/25)</h3>
                ${playersList}
            </div>

            ${isHost ? `
                <button onclick="window.startMpMatch()" class="nav-btn" style="width:100%; background:var(--accent); color:white; padding:1.2rem; font-size:1.2rem;">
                    Démarrer la partie
                </button>
            ` : `
                <div style="text-align:center; color:var(--text-muted);">
                    <i class="fa-solid fa-spinner fa-spin"></i> En attente de l'hôte...
                </div>
            `}
        </div>
    `;
}

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 7).toUpperCase();
}

// Global Expose for HTML buttons
window.startMpMatch = startMatch;
