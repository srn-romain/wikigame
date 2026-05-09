/**
 * multiplayer.js
 * Gestion du mode compétition (salles multijoueur).
 *
 * Collection Firestore : rooms/{roomId}
 * Structure d'un document room :
 * {
 *   roomId:     string,          // code salle (5 caractères uppercase)
 *   creatorUid: string,          // UID Firebase de l'hôte (admin)
 *   hostId:     string,          // alias de creatorUid (pour compatibilité)
 *   state:      "WAITING" | "PLAYING" | "FINISHED",
 *   createdAt:  number (ms),
 *   articleId:  string | null,
 *   startTime:  number | null,
 *   players: {
 *     [uid]: {
 *       name:     string,
 *       score:    number,
 *       finished: boolean,
 *       isHost:   boolean,
 *       attempts: number
 *     }
 *   }
 * }
 */
import { db, waitForAuth, getCurrentUser, doc, setDoc, getDoc, updateDoc, onSnapshot, serverTimestamp } from './firebase-app.js';
import { fetchRandomArticle } from './wiki.js';
import { initGame } from './game.js';

// ─────────────────────────────────────────────
// STATE LOCAL
// ─────────────────────────────────────────────
let _unsubscribeRoom = null;
let _currentRoomId   = null;

// ─────────────────────────────────────────────
// CRÉER UNE SALLE
// ─────────────────────────────────────────────
export async function createRoom(username) {
    try {
        const user = await waitForAuth();
        if (!user) { alert("Erreur d'authentification."); return; }

        const roomId  = _generateRoomCode();
        const roomRef = doc(db, "rooms", roomId);

        await setDoc(roomRef, {
            roomId:     roomId,
            creatorUid: user.uid,   // UID du créateur (admin)
            hostId:     user.uid,   // alias identique
            state:      "WAITING",
            createdAt:  Date.now(),
            articleId:  null,
            startTime:  null,
            players: {
                [user.uid]: {
                    name:     username || `Joueur-${user.uid.slice(0, 4)}`,
                    score:    0,
                    attempts: 0,
                    finished: false,
                    isHost:   true
                }
            }
        });

        console.log("MP: Room created:", roomId, "by", user.uid);
        _currentRoomId = roomId;
        _subscribeToRoom(roomId);
    } catch (err) {
        console.error("MP: createRoom error:", err);
        alert("Erreur lors de la création de la salle : " + err.message);
    }
}

// ─────────────────────────────────────────────
// REJOINDRE UNE SALLE
// ─────────────────────────────────────────────
export async function joinRoom(roomId, username) {
    try {
        const user = await waitForAuth();
        if (!user) { alert("Erreur d'authentification."); return; }

        roomId = roomId.toUpperCase().trim();
        const roomRef = doc(db, "rooms", roomId);
        const snap    = await getDoc(roomRef);

        if (!snap.exists()) {
            alert("Salle introuvable !");
            return;
        }

        const data = snap.data();

        if (data.state !== "WAITING") {
            alert("La partie a déjà commencé !");
            return;
        }

        // Vérifier si le joueur est déjà dans la salle (reconnexion)
        const alreadyIn = data.players && data.players[user.uid];

        if (!alreadyIn) {
            await updateDoc(roomRef, {
                [`players.${user.uid}`]: {
                    name:     username || `Joueur-${user.uid.slice(0, 4)}`,
                    score:    0,
                    attempts: 0,
                    finished: false,
                    isHost:   false
                }
            });
        }

        console.log("MP: Joined room:", roomId, "as", user.uid);
        _currentRoomId = roomId;
        _subscribeToRoom(roomId);
    } catch (err) {
        console.error("MP: joinRoom error:", err);
        alert("Erreur de connexion : " + err.message);
    }
}

// ─────────────────────────────────────────────
// DÉMARRER LA PARTIE (hôte uniquement)
// ─────────────────────────────────────────────
export async function startMatch() {
    if (!_currentRoomId) return;

    const user = getCurrentUser();
    if (!user) return;

    // Vérifier que c'est bien le créateur
    const roomRef = doc(db, "rooms", _currentRoomId);
    const snap    = await getDoc(roomRef);
    if (!snap.exists()) return;

    const data = snap.data();
    if (data.creatorUid !== user.uid) {
        alert("Seul le créateur peut démarrer la partie.");
        return;
    }

    const article = await fetchRandomArticle();
    if (!article) { alert("Impossible de charger un article."); return; }

    await updateDoc(roomRef, {
        state:     "PLAYING",
        articleId: article.id,
        startTime: Date.now()
    });

    console.log("MP: Match started in room", _currentRoomId, "article:", article.id);
}

// ─────────────────────────────────────────────
// ÉCOUTER UNE SALLE (temps réel)
// ─────────────────────────────────────────────
function _subscribeToRoom(roomId) {
    // Désabonner l'ancien listener
    if (_unsubscribeRoom) { _unsubscribeRoom(); _unsubscribeRoom = null; }

    const roomRef = doc(db, "rooms", roomId);

    _unsubscribeRoom = onSnapshot(roomRef, (snapshot) => {
        if (!snapshot.exists()) {
            console.warn("MP: Room document deleted:", roomId);
            return;
        }
        const data = snapshot.data();
        console.log("MP: Room update received, state:", data.state);

        if (data.state === "WAITING") {
            _renderLobby(data, roomId);
        } else if (data.state === "PLAYING" && !window._mpGameStarted) {
            window._mpGameStarted = true;
            _startMpGame(data.articleId);
        }
    });
}

// ─────────────────────────────────────────────
// DÉMARRER LE JEU CÔTÉ CLIENT
// ─────────────────────────────────────────────
function _startMpGame(articleId) {
    // Injecter le hook de rapport de progression avant d'init le jeu
    window.mpReportProgress = (found, total, finished, attempts) => {
        _reportProgress(found, total, finished, attempts);
    };
    initGame('multiplayer', articleId);
}

async function _reportProgress(found, total, finished, attempts) {
    const user = getCurrentUser();
    if (!_currentRoomId || !user) return;

    try {
        const roomRef = doc(db, "rooms", _currentRoomId);
        await updateDoc(roomRef, {
            [`players.${user.uid}.score`]:    found,
            [`players.${user.uid}.finished`]: finished,
            [`players.${user.uid}.attempts`]: attempts
        });
    } catch (e) {
        console.error("MP: reportProgress error:", e);
    }
}

// ─────────────────────────────────────────────
// AFFICHAGE DU LOBBY
// ─────────────────────────────────────────────
function _renderLobby(data, roomId) {
    const container = document.getElementById('main-container');
    if (!container) return;

    const user      = getCurrentUser();
    const isCreator = user && data.creatorUid === user.uid;
    const players   = data.players || {};

    const playersList = Object.entries(players).map(([uid, p]) => `
        <div class="glass" style="padding:10px 14px; display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; border-radius:10px;">
            <span>
                ${p.isHost
                    ? '<i class="fa-solid fa-crown" style="color:gold; margin-right:6px;" title="Hôte"></i>'
                    : ''}
                ${p.name || uid.slice(0, 8)}
                ${uid === user?.uid ? '<span style="color:var(--text-muted); font-size:0.75rem;"> (vous)</span>' : ''}
            </span>
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
                    <button onclick="window._copyRoomCode('${roomId}')" id="copy-room-btn" class="glass" title="Copier le code"
                        style="width:45px; height:45px; border-radius:50%; display:flex; align-items:center; justify-content:center; cursor:pointer; border:1px solid #ddd; background:white; color:var(--text-main); transition:all 0.2s;">
                        <i class="fa-solid fa-copy"></i>
                    </button>
                </div>

                <p style="color:var(--text-muted); font-size:0.85rem;">Partagez ce code avec vos amis</p>
            </div>

            <div style="margin-bottom: 1.5rem;">
                <h3 style="margin-bottom: 0.75rem; font-size:0.9rem; text-transform:uppercase; letter-spacing:0.1em; color:var(--text-muted);">
                    Joueurs (${Object.keys(players).length}/25)
                </h3>
                ${playersList}
            </div>

            ${isCreator ? `
                <button onclick="window._startMpMatch()" class="btn-accent" style="width:100%; justify-content:center; font-size:1rem;">
                    <i class="fa-solid fa-play"></i> Démarrer la partie
                </button>
            ` : `
                <div style="text-align:center; color:var(--text-muted); padding:1rem;">
                    <i class="fa-solid fa-spinner fa-spin" style="margin-right:6px;"></i>
                    En attente que l'hôte lance la partie…
                </div>
            `}
        </div>
    `;
}

// ─────────────────────────────────────────────
// HELPERS GLOBAUX (appelés depuis le HTML injecté)
// ─────────────────────────────────────────────
window._copyRoomCode = async (code) => {
    try {
        await navigator.clipboard.writeText(code);
        const btn  = document.getElementById('copy-room-btn');
        const icon = btn?.querySelector('i');
        if (icon) icon.className = 'fa-solid fa-check';
        if (btn)  { btn.style.borderColor = 'var(--primary)'; btn.style.color = 'var(--primary)'; }
        setTimeout(() => {
            if (icon) icon.className = 'fa-solid fa-copy';
            if (btn)  { btn.style.borderColor = '#ddd'; btn.style.color = 'var(--text-main)'; }
        }, 2000);
    } catch (err) {
        console.error('Copy failed:', err);
    }
};

window._startMpMatch = startMatch;

// ─────────────────────────────────────────────
// UTILITAIRE
// ─────────────────────────────────────────────
function _generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// Exposer pour debug
export function getCurrentRoomId() { return _currentRoomId; }
