/**
 * multiplayer.js — Mode Compétition
 * Collection: rooms/{roomId}
 * {
 *   roomId, name, creatorUid, hostId, state, locked, maxRounds, currentRound,
 *   articleId, startTime, createdAt,
 *   players: { [uid]: { name, isHost, approved, roundScores, totalScore, finished, attempts } },
 *   pending: { [uid]: { name } }
 * }
 */
import { db, waitForAuth, getCurrentUser, doc, setDoc, getDoc, updateDoc, onSnapshot, deleteField } from './firebase-app.js';
import { fetchRandomArticle } from './wiki.js';
import { initGame } from './game.js';
import { showInfoModal } from './auth.js';

let _unsub = null;
let _roomId = null;

// ── CRÉER UNE SALLE ──────────────────────────────────────────────
export async function createRoom({ roomName, username, maxRounds }) {
    const user = await waitForAuth();
    if (!user) return;

    const roomId  = _genCode();
    const roomRef = doc(db, "rooms", roomId);

    await setDoc(roomRef, {
        roomId,
        name:       roomName || `Salle de ${username}`,
        creatorUid: user.uid,
        hostId:     user.uid,
        state:      "WAITING",
        locked:     false,
        maxRounds:  maxRounds || 3,
        currentRound: 1,
        articleId:  null,
        startTime:  null,
        createdAt:  Date.now(),
        players: {
            [user.uid]: { name: username, isHost: true, approved: true, roundScores: {}, totalScore: 0, finished: false, attempts: 0 }
        },
        pending: {}
    });

    _roomId = roomId;
    _subscribe(roomId);
}

// ── REJOINDRE (en attente d'approbation) ─────────────────────────
export async function joinRoom(roomId, username) {
    const user = await waitForAuth();
    if (!user) throw new Error("Erreur d'authentification.");

    roomId = roomId.toUpperCase().trim();
    const roomRef = doc(db, "rooms", roomId);

    let snap;
    try {
        snap = await getDoc(roomRef);
    } catch (e) {
        throw new Error("Impossible de contacter le serveur. Vérifiez votre connexion.");
    }

    if (!snap.exists()) throw new Error("Salle introuvable !");

    const data = snap.data();
    if (data.locked)             throw new Error("Cette salle est verrouillée.");
    if (data.state !== "WAITING") throw new Error("La partie a déjà commencé !");

    // Déjà approuvé ? Reconnexion directe
    if (data.players?.[user.uid]?.approved) {
        _roomId = roomId;
        _subscribe(roomId);
        return;
    }

    // Déjà en attente ? Juste réabonner
    if (data.pending?.[user.uid]) {
        _roomId = roomId;
        _subscribe(roomId);
        return;
    }

    try {
        await updateDoc(roomRef, { [`pending.${user.uid}`]: { name: username } });
    } catch (e) {
        throw new Error("Impossible de rejoindre la salle. Vérifiez les permissions Firebase.");
    }

    _roomId = roomId;
    _subscribe(roomId);
}

// ── ACTIONS ADMIN ─────────────────────────────────────────────────
export async function approvePlayer(uid) {
    const snap = await getDoc(doc(db, "rooms", _roomId));
    const name = snap.data().pending?.[uid]?.name || uid;
    const updates = {};
    updates[`players.${uid}`] = { name, isHost: false, approved: true, roundScores: {}, totalScore: 0, finished: false, attempts: 0 };
    updates[`pending.${uid}`] = deleteField();
    await updateDoc(doc(db, "rooms", _roomId), updates);
}

export async function rejectPlayer(uid) {
    const updates = {};
    updates[`pending.${uid}`] = deleteField();
    await updateDoc(doc(db, "rooms", _roomId), updates);
}

export async function toggleLock() {
    const snap = await getDoc(doc(db, "rooms", _roomId));
    await updateDoc(doc(db, "rooms", _roomId), { locked: !snap.data().locked });
}

export async function startRound() {
    const article = await fetchRandomArticle();
    if (!article) { 
        showInfoModal("Erreur", "Impossible de charger un article aléatoire depuis Wikipédia.", "error"); 
        return; 
    }

    const snap = await getDoc(doc(db, "rooms", _roomId));
    const data = snap.data();

    // Remettre finished à false pour tous les joueurs
    const updates = { state: "PLAYING", articleId: article.id, startTime: Date.now() };
    Object.keys(data.players || {}).forEach(uid => {
        updates[`players.${uid}.finished`] = false;
        updates[`players.${uid}.attempts`] = 0;
    });
    await updateDoc(doc(db, "rooms", _roomId), updates);
}

export async function pauseGame() {
    const snap = await getDoc(doc(db, "rooms", _roomId));
    const cur  = snap.data().state;
    await updateDoc(doc(db, "rooms", _roomId), { state: cur === "PAUSED" ? "PLAYING" : "PAUSED" });
}

export async function stopGame() {
    await updateDoc(doc(db, "rooms", _roomId), { state: "FINISHED" });
}

export async function nextArticle() {
    const snap = await getDoc(doc(db, "rooms", _roomId));
    const data = snap.data();
    const nextRound = (data.currentRound || 1) + 1;

    if (nextRound > data.maxRounds) {
        await updateDoc(doc(db, "rooms", _roomId), { state: "FINISHED" });
        return;
    }

    const article = await fetchRandomArticle();
    if (!article) return;

    const updates = { state: "PLAYING", articleId: article.id, startTime: Date.now(), currentRound: nextRound };
    Object.keys(data.players || {}).forEach(uid => {
        updates[`players.${uid}.finished`] = false;
        updates[`players.${uid}.attempts`] = 0;
    });
    await updateDoc(doc(db, "rooms", _roomId), updates);
}

// ── RAPPORT DE PROGRESSION ────────────────────────────────────────
export async function reportProgress(found, total, finished, attempts) {
    const user = getCurrentUser();
    if (!_roomId || !user) return;

    const snap = await getDoc(doc(db, "rooms", _roomId));
    const data = snap.data();
    const round = data.currentRound || 1;

    const updates = {
        [`players.${user.uid}.finished`]: finished,
        [`players.${user.uid}.attempts`]: attempts,
        [`players.${user.uid}.roundScores.${round}`]: found
    };

    // Recalculer le total
    const existing = data.players?.[user.uid]?.roundScores || {};
    const total_score = Object.values({ ...existing, [round]: found }).reduce((a, b) => a + b, 0);
    updates[`players.${user.uid}.totalScore`] = total_score;

    await updateDoc(doc(db, "rooms", _roomId), updates);
}

// ── SUBSCRIPTION ──────────────────────────────────────────────────
function _subscribe(roomId) {
    if (_unsub) { _unsub(); _unsub = null; }

    _unsub = onSnapshot(doc(db, "rooms", roomId), (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        const user = getCurrentUser();

        if (data.state === "WAITING") {
            window._mpGameStarted = false;
            window._mpArticleId = null;
            _renderLobby(data, roomId, user);
        } else if (data.state === "PLAYING") {
            if (!window._mpGameStarted || window._mpArticleId !== data.articleId) {
                window._mpGameStarted = true;
                window._mpArticleId = data.articleId;
                _startGame(data.articleId, data);
            } else {
                // Reprise après pause
                const banner = document.getElementById('mp-pause-banner');
                if (banner) {
                    banner.remove();
                    if (window._resumeTimer) window._resumeTimer();
                }
            }
            if (data.creatorUid === user?.uid) {
                _updateAdminPanel(data);
            }
            _updateLivePlayers(data);
        } else if (data.state === "PAUSED") {
            if (window._pauseTimer) window._pauseTimer();
            _showPauseBanner();
        } else if (data.state === "FINISHED") {
            if (window._pauseTimer) window._pauseTimer();
            _renderLeaderboard(data);
        }
    });
}

// ── DÉMARRAGE DU JEU ─────────────────────────────────────────────
function _startGame(articleId, roomData) {
    window.mpReportProgress = (found, total, finished, attempts) => {
        reportProgress(found, total, finished, attempts);
    };
    initGame('multiplayer', articleId);

    // Injecter panneau admin après init
    const user = getCurrentUser();
    if (user && roomData.creatorUid === user.uid) {
        setTimeout(() => _injectAdminPanel(roomData), 300);
    }
}

// ── LIVE PLAYERS LIST ─────────────────────────────────────────────
function _updateLivePlayers(data) {
    const listEl = document.getElementById('players-live-list');
    if (!listEl) return;
    
    const round = data.currentRound || 1;
    const players = Object.values(data.players || {}).filter(p => p.approved);
    
    // Sort players by words found in current round (descending)
    players.sort((a, b) => {
        const scoreA = a.roundScores?.[round] || 0;
        const scoreB = b.roundScores?.[round] || 0;
        return scoreB - scoreA;
    });

    listEl.innerHTML = players.map(p => {
        const found = p.roundScores?.[round] || 0;
        const finishedIcon = p.finished ? '<i class="fa-solid fa-check-circle" style="color:#27ae60;"></i>' : '';
        return `
            <div class="guess-item">
                <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:flex; gap:6px; align-items:center;">
                    ${p.name} ${finishedIcon}
                </span>
                <div style="display:flex; gap:8px; align-items:center;">
                    <span style="font-size:0.7rem; color:var(--text-muted);"><i class="fa-solid fa-bullseye"></i> ${p.attempts || 0}</span>
                    <div class="guess-badge" style="background:var(--primary); color:white;">${found}</div>
                </div>
            </div>
        `;
    }).join('');
}

// ── PANNEAU ADMIN (pendant la partie) ────────────────────────────
function _injectAdminPanel(data) {
    if (document.getElementById('mp-admin-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'mp-admin-panel';
    panel.style.cssText = `
        position: fixed; top: 70px; right: 16px; z-index: 200;
        background: white; border: 1px solid #e5e7eb; border-radius: 14px;
        padding: 14px 18px; box-shadow: 0 8px 30px rgba(0,0,0,0.12);
        display: flex; flex-direction: column; gap: 8px; min-width: 200px;
    `;
    panel.innerHTML = `
        <div style="font-weight:800; font-size:0.8rem; text-transform:uppercase; letter-spacing:.05em; color:#6b7280; margin-bottom:4px;">
            <i class="fa-solid fa-crown" style="color:gold;"></i> Admin
        </div>
        <div id="mp-round-info" style="font-size:0.85rem; color:#374151; font-weight:600;"></div>
        <button id="mp-pause-btn" onclick="window._mpPause()" style="all:unset; cursor:pointer; background:#f3f4f6; padding:7px 12px; border-radius:8px; font-size:0.82rem; font-weight:600; text-align:center; transition:background .15s;">
            <i class="fa-solid fa-pause"></i> Pause
        </button>
        <button id="mp-next-btn" onclick="window._mpNext()" style="all:unset; cursor:pointer; background:var(--accent); color:white; padding:7px 12px; border-radius:8px; font-size:0.82rem; font-weight:600; text-align:center;">
            <i class="fa-solid fa-forward"></i> Article suivant
        </button>
        <button id="mp-stop-btn" onclick="window._mpStop()" style="all:unset; cursor:pointer; background:#fef2f2; color:#dc2626; padding:7px 12px; border-radius:8px; font-size:0.82rem; font-weight:600; text-align:center;">
            <i class="fa-solid fa-stop"></i> Arrêter
        </button>
    `;
    document.body.appendChild(panel);
    _updateAdminPanel(data);
}

function _updateAdminPanel(data) {
    const info = document.getElementById('mp-round-info');
    if (info) info.textContent = `Manche ${data.currentRound} / ${data.maxRounds}`;

    const pauseBtn = document.getElementById('mp-pause-btn');
    if (pauseBtn) {
        const paused = data.state === "PAUSED";
        pauseBtn.innerHTML = paused
            ? '<i class="fa-solid fa-play"></i> Reprendre'
            : '<i class="fa-solid fa-pause"></i> Pause';
    }
}

function _removeAdminPanel() {
    document.getElementById('mp-admin-panel')?.remove();
}

function _showPauseBanner() {
    if (document.getElementById('mp-pause-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'mp-pause-banner';
    banner.style.cssText = `
        position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:300;
        display:flex; align-items:center; justify-content:center;
    `;
    banner.innerHTML = `
        <div style="background:white; padding:2rem 3rem; border-radius:16px; text-align:center;">
            <i class="fa-solid fa-pause" style="font-size:2rem; color:var(--accent); margin-bottom:1rem;"></i>
            <h2 style="margin:0;">Partie en pause</h2>
            <p style="color:#6b7280; margin-top:.5rem;">En attente de l'hôte…</p>
        </div>
    `;
    document.body.appendChild(banner);
}

// ── LOBBY ─────────────────────────────────────────────────────────
function _renderLobby(data, roomId, user) {
    // Retirer bannière pause si présente
    document.getElementById('mp-pause-banner')?.remove();
    document.getElementById('mp-admin-panel')?.remove();

    const container = document.getElementById('main-container');
    if (!container) return;

    const isAdmin   = user && data.creatorUid === user.uid;
    const myData    = data.players?.[user?.uid];
    const isPending = !myData && data.pending?.[user?.uid];

    // Vue "en attente d'approbation"
    if (isPending) {
        container.innerHTML = `
            <div class="glass" style="max-width:400px;margin:4rem auto;padding:2rem;text-align:center;border-radius:var(--radius-lg);">
                <i class="fa-solid fa-hourglass-half" style="font-size:2rem;color:var(--accent);margin-bottom:1rem;"></i>
                <h2>En attente d'approbation</h2>
                <p style="color:var(--text-muted);margin-top:.5rem;">L'hôte doit vous accepter pour rejoindre la salle <strong>${roomId}</strong>.</p>
                <div style="margin-top:1.5rem;"><i class="fa-solid fa-spinner fa-spin"></i></div>
            </div>`;
        return;
    }

    const players = Object.entries(data.players || {});
    const pending = Object.entries(data.pending || {});

    const playerRows = players.map(([uid, p]) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#f9fafb;border-radius:10px;margin-bottom:6px;">
            <span style="font-weight:600;">
                ${p.isHost ? '<i class="fa-solid fa-crown" style="color:gold;margin-right:6px;"></i>' : ''}
                ${p.name}
                ${uid === user?.uid ? '<span style="color:var(--text-muted);font-size:0.75rem;"> (vous)</span>' : ''}
            </span>
            <span style="font-size:0.8rem;color:var(--text-muted);">✅ Accepté</span>
        </div>`).join('');

    const pendingRows = isAdmin && pending.length ? `
        <div style="margin-top:1.5rem;">
            <h3 style="font-size:0.8rem;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);margin-bottom:.75rem;">
                <i class="fa-solid fa-user-clock"></i> En attente (${pending.length})
            </h3>
            ${pending.map(([uid, p]) => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;margin-bottom:6px;">
                    <span style="font-weight:600;">${p.name}</span>
                    <div style="display:flex;gap:6px;">
                        <button onclick="window._mpApprove('${uid}')" style="all:unset;cursor:pointer;background:#d1fae5;color:#065f46;padding:4px 10px;border-radius:6px;font-size:0.8rem;font-weight:700;">✓ Accepter</button>
                        <button onclick="window._mpReject('${uid}')" style="all:unset;cursor:pointer;background:#fee2e2;color:#991b1b;padding:4px 10px;border-radius:6px;font-size:0.8rem;font-weight:700;">✕ Refuser</button>
                    </div>
                </div>`).join('')}
        </div>` : '';

    const adminControls = isAdmin ? `
        <div style="margin-top:1.5rem;display:flex;flex-direction:column;gap:8px;">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#f3f4f6;border-radius:10px;">
                <span style="font-size:0.85rem;font-weight:600;"><i class="fa-solid fa-lock${data.locked ? '' : '-open'}" style="margin-right:6px;"></i>${data.locked ? 'Salle verrouillée' : 'Salle ouverte'}</span>
                <button onclick="window._mpToggleLock()" style="all:unset;cursor:pointer;background:${data.locked ? '#fee2e2' : '#d1fae5'};color:${data.locked ? '#991b1b' : '#065f46'};padding:4px 12px;border-radius:6px;font-size:0.8rem;font-weight:700;">${data.locked ? 'Ouvrir' : 'Verrouiller'}</button>
            </div>
            <button onclick="window._mpStart()" class="btn-accent" style="width:100%;justify-content:center;font-size:1rem;" ${players.length < 1 ? 'disabled' : ''}>
                <i class="fa-solid fa-play"></i> Démarrer la partie
            </button>
        </div>` : `
        <div style="text-align:center;color:var(--text-muted);padding:1rem;margin-top:.5rem;">
            <i class="fa-solid fa-spinner fa-spin" style="margin-right:6px;"></i> En attente que l'hôte lance la partie…
        </div>`;

    container.innerHTML = `
        <div class="glass" style="padding:2rem;max-width:580px;margin:2rem auto;border-radius:var(--radius-lg);">
            <div style="text-align:center;margin-bottom:1.5rem;">
                <i class="fa-solid fa-door-open" style="font-size:2rem;color:var(--accent);margin-bottom:.75rem;"></i>
                <h2 style="margin:0 0 .25rem;">${data.name || roomId}</h2>
                <div style="display:flex;align-items:center;justify-content:center;gap:12px;margin-top:.75rem;">
                    <span style="font-family:var(--font-mono);font-size:2rem;font-weight:800;color:var(--primary);letter-spacing:6px;">${roomId}</span>
                    <button onclick="window._mpCopy('${roomId}')" id="copy-room-btn" style="all:unset;cursor:pointer;background:#f3f4f6;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:.9rem;" title="Copier">
                        <i class="fa-solid fa-copy"></i>
                    </button>
                </div>
                <p style="color:var(--text-muted);font-size:0.8rem;margin-top:.5rem;">Manche(s) : <strong>${data.maxRounds}</strong></p>
            </div>

            <div>
                <h3 style="font-size:0.8rem;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);margin-bottom:.75rem;">
                    Joueurs (${players.length}/25)
                </h3>
                ${playerRows || '<p style="color:var(--text-muted);text-align:center;font-size:.85rem;">Aucun joueur</p>'}
            </div>

            ${pendingRows}
            ${adminControls}
        </div>`;
}

// ── LEADERBOARD ───────────────────────────────────────────────────
function _renderLeaderboard(data) {
    _removeAdminPanel();
    document.getElementById('mp-pause-banner')?.remove();

    const container = document.getElementById('main-container');
    if (!container) return;

    document.getElementById('game-controls')?.classList.add('hidden');

    const players = Object.entries(data.players || {})
        .sort(([, a], [, b]) => b.totalScore - a.totalScore);

    const medals = ['🥇', '🥈', '🥉'];

    const rows = players.map(([uid, p], i) => {
        const roundCols = Array.from({ length: data.maxRounds }, (_, r) =>
            `<td style="text-align:center;padding:10px 8px;color:#374151;">${p.roundScores?.[r + 1] ?? '-'}</td>`
        ).join('');

        return `
            <tr style="background:${i === 0 ? '#fffbeb' : i % 2 === 0 ? '#f9fafb' : 'white'}; ${i === 0 ? 'font-weight:700;' : ''}">
                <td style="padding:12px 16px;display:flex;align-items:center;gap:10px;">
                    <span style="font-size:1.2rem;">${medals[i] || `${i + 1}.`}</span>
                    ${p.isHost ? '<i class="fa-solid fa-crown" style="color:gold;font-size:.75rem;"></i>' : ''}
                    ${p.name}
                </td>
                ${roundCols}
                <td style="text-align:center;padding:10px 16px;font-weight:800;color:var(--accent);font-size:1.05rem;">${p.totalScore}</td>
            </tr>`;
    }).join('');

    const roundHeaders = Array.from({ length: data.maxRounds }, (_, r) =>
        `<th style="text-align:center;padding:8px;font-size:.8rem;color:var(--text-muted);">M${r + 1}</th>`
    ).join('');

    const user    = getCurrentUser();
    const isAdmin = user && data.creatorUid === user.uid;

    container.innerHTML = `
        <div style="max-width:700px;margin:2rem auto;padding:0 1rem;">
            <div class="glass" style="padding:2rem;border-radius:var(--radius-lg);">
                <div style="text-align:center;margin-bottom:2rem;">
                    <i class="fa-solid fa-trophy" style="font-size:3rem;color:#f39c12;margin-bottom:.75rem;"></i>
                    <h2 style="margin:0;">Classement Final</h2>
                    <p style="color:var(--text-muted);font-size:.85rem;">${data.name || _roomId} · ${data.maxRounds} manche(s)</p>
                </div>

                <div style="overflow-x:auto;">
                    <table style="width:100%;border-collapse:collapse;font-size:.9rem;">
                        <thead>
                            <tr style="border-bottom:2px solid #e5e7eb;">
                                <th style="text-align:left;padding:8px 16px;font-size:.8rem;color:var(--text-muted);">Joueur</th>
                                ${roundHeaders}
                                <th style="text-align:center;padding:8px 16px;font-size:.8rem;color:var(--text-muted);">Total</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>

                ${isAdmin ? `
                    <div style="margin-top:2rem;display:flex;gap:10px;justify-content:center;">
                        <button onclick="window._mpNewGame()" class="btn-primary" style="justify-content:center;">
                            <i class="fa-solid fa-rotate"></i> Nouvelle partie
                        </button>
                    </div>` : `
                    <p style="text-align:center;color:var(--text-muted);margin-top:1.5rem;font-size:.85rem;">
                        <i class="fa-solid fa-spinner fa-spin"></i> En attente de l'hôte…
                    </p>`}
            </div>
        </div>`;
}

// ── GLOBALS (appelés depuis HTML injecté) ─────────────────────────
window._mpApprove     = approvePlayer;
window._mpReject      = rejectPlayer;
window._mpToggleLock  = toggleLock;
window._mpStart       = startRound;
window._mpPause       = pauseGame;
window._mpNext        = nextArticle;
window._mpStop        = stopGame;
window._mpNewGame     = () => {
    // Remettre la salle en état WAITING
    updateDoc(doc(db, "rooms", _roomId), {
        state: "WAITING", articleId: null, startTime: null, currentRound: 1
    }).then(() => {
        // Reset scores
        const user = getCurrentUser();
        // Full reset via snapshot
    });
};
window._mpCopy = async (code) => {
    await navigator.clipboard.writeText(code).catch(() => {});
    const btn = document.getElementById('copy-room-btn');
    if (btn) { btn.innerHTML = '<i class="fa-solid fa-check"></i>'; setTimeout(() => { btn.innerHTML = '<i class="fa-solid fa-copy"></i>'; }, 1500); }
};

// ── UTIL ──────────────────────────────────────────────────────────
function _genCode() {
    const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 5 }, () => c[Math.floor(Math.random() * c.length)]).join('');
}

export function getCurrentRoomId() { return _roomId; }
