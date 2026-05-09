import { db, waitForAuth, getCurrentUser, collection, doc, setDoc, getDoc, updateDoc, onSnapshot } from './firebase-app.js';
import { fetchRandomArticle } from './wiki.js';
import { initGame } from './game.js';

let currentRoomSubscription = null;
let currentRoomId = null;

/**
 * Create a new Room.
 * Waits for Firebase Auth before writing to Firestore.
 */
export async function createRoom(username) {
    const user = await waitForAuth();
    if (!user) { alert("Erreur d'authentification."); return; }

    const roomId = generateRoomCode();
    currentRoomId = roomId;

    const roomRef = doc(db, "lobbies", roomId);

    await setDoc(roomRef, {
        hostId:    user.uid,
        state:     "WAITING",
        createdAt: Date.now(),
        players: {
            [user.uid]: {
                name:     username || "Hôte",
                score:    0,
                finished: false,
                isHost:   true
            }
        },
        articleId: null
    });

    subscribeToRoom(roomId);
}

/**
 * Join an existing Room.
 */
export async function joinRoom(roomId, username) {
    const user = await waitForAuth();
    if (!user) return;

    roomId = roomId.toUpperCase();
    const roomRef = doc(db, "lobbies", roomId);
    const snap    = await getDoc(roomRef);

    if (!snap.exists()) {
        alert("Salle introuvable !");
        return;
    }

    if (snap.data().state !== "WAITING") {
        alert("La partie a déjà commencé !");
        return;
    }

    await updateDoc(roomRef, {
        [`players.${user.uid}`]: {
            name:     username || `Joueur-${user.uid.slice(0, 4)}`,
            score:    0,
            finished: false,
            isHost:   false
        }
    });

    currentRoomId = roomId;
    subscribeToRoom(roomId);
}

/**
 * Listen to Room changes via Firestore real-time.
 */
function subscribeToRoom(roomId) {
    if (currentRoomSubscription) currentRoomSubscription(); // Unsubscribe old listener

    const roomRef = doc(db, "lobbies", roomId);

    currentRoomSubscription = onSnapshot(roomRef, (snapshot) => {
        if (!snapshot.exists()) return;
        const data = snapshot.data();

        renderLobby(data, roomId);

        if (data.state === "PLAYING" && !window.isInMpGame) {
            window.isInMpGame = true;
            startMpGame(data.articleId);
        }
    });
}

/**
 * Host starts the match: fetches a shared article and updates room state.
 */
export async function startMatch() {
    if (!currentRoomId) return;

    const article = await fetchRandomArticle();
    if (!article) { alert("Impossible de charger un article."); return; }

    const roomRef = doc(db, "lobbies", currentRoomId);
    await updateDoc(roomRef, {
        state:     "PLAYING",
        articleId: article.id,
        startTime: Date.now()
    });
}

function startMpGame(articleId) {
    window.mpReportProgress = (found, total, finished, attempts) => {
        reportProgress(found, total, finished, attempts);
    };
    initGame('multiplayer', articleId);
}

async function reportProgress(found, total, finished, attempts) {
    const user = getCurrentUser();
    if (!currentRoomId || !user) return;

    const roomRef = doc(db, "lobbies", currentRoomId);
    await updateDoc(roomRef, {
        [`players.${user.uid}.score`]:    found,
        [`players.${user.uid}.finished`]: finished,
        [`players.${user.uid}.attempts`]: attempts
    });
}

/**
 * Render the lobby waiting room.
 */
function renderLobby(data, roomId) {
    const container = document.getElementById('main-container');
    if (!container) return;

    if (data.state === 'PLAYING') return; // Game UI takes over

    const user   = getCurrentUser();
    const isHost = user && data.hostId === user.uid;

    const playersList = Object.values(data.players).map(p => `
        <div class="glass" style="padding:10px 14px; display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; border-radius:10px;">
            <span>${p.isHost ? '<i class="fa-solid fa-crown" style="color:gold; margin-right:6px;"></i>' : ''}${p.name}</span>
            <span style="color:var(--text-muted); font-size:0.8rem;">${p.finished ? '✅ Terminé' : '⏳ Prêt'}</span>
        </div>
    `).join('');

    container.innerHTML = `
        <div class="glass" style="padding: 2rem; max-width: 560px; margin: 2rem auto; border-radius: var(--radius-lg);">
            <div style="text-align: center; margin-bottom: 2rem;">
                <i class="fa-solid fa-door-open" style="font-size:2rem; color:var(--accent); margin-bottom:0.75rem;"></i>
                <h2>Salle d'attente</h2>
                
                <div style="display:flex; align-items:center; justify-content:center; gap:15px; margin: 1rem 0;">
                    <div style="font-size: 2.5rem; font-family: var(--font-mono); color: var(--primary); letter-spacing: 6px; font-weight:700;">
                        ${roomId}
                    </div>
                    <button onclick="window.copyRoomCode('${roomId}')" id="copy-btn" class="glass" title="Copier le code" 
                        style="width:45px; height:45px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:var(--text-main); cursor:pointer; transition: all 0.2s; border: 1px solid #eee; background: white;">
                        <i class="fa-solid fa-copy"></i>
                    </button>
                </div>

                <p style="color:var(--text-muted); font-size:0.85rem;">Partagez ce code avec vos amis</p>
            </div>

            <div style="margin-bottom: 1.5rem;">
                <h3 style="margin-bottom: 0.75rem; font-size:0.9rem; text-transform:uppercase; letter-spacing:0.1em; color:var(--text-muted);">
                    Joueurs (${Object.keys(data.players).length}/25)
                </h3>
                ${playersList}
            </div>

            ${isHost ? `
                <button onclick="window.startMpMatch()" class="btn-accent" style="width:100%; justify-content:center; font-size:1rem;">
                    <i class="fa-solid fa-play"></i> Démarrer la partie
                </button>
            ` : `
                <div style="text-align:center; color:var(--text-muted); padding:1rem;">
                    <i class="fa-solid fa-spinner fa-spin" style="margin-right:6px;"></i>
                    En attente que l'hôte lance la partie...
                </div>
            `}
        </div>
    `;
}

// Global copy helper
window.copyRoomCode = async (code) => {
    try {
        await navigator.clipboard.writeText(code);
        const btn = document.getElementById('copy-btn');
        const icon = btn.querySelector('i');
        
        // Visual feedback
        icon.className = 'fa-solid fa-check';
        btn.style.borderColor = 'var(--primary)';
        btn.style.color = 'var(--primary)';
        
        setTimeout(() => {
            icon.className = 'fa-solid fa-copy';
            btn.style.borderColor = '#eee';
            btn.style.color = 'var(--text-main)';
        }, 2000);
    } catch (err) {
        console.error('Failed to copy!', err);
    }
};

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 7).toUpperCase();
}

// Expose for lobby HTML button
window.startMpMatch = startMatch;
