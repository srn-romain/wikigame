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
import { db, waitForAuth, getCurrentUser, doc, setDoc, getDoc, updateDoc, onSnapshot, deleteField, collection, query, where, getDocs, deleteDoc } from './firebase-app.js';
import { fetchRandomArticle } from './wiki.js';
import { initGame } from './game.js';
import { showInfoModal } from './auth.js';
import { navigateTo } from './main.js';
import confetti from 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/+esm';


let _unsub = null;
let _roomId = null;
let _countdownInterval = null;
let _lastRoomData = null; // Cache pour éviter les getDoc() répétitifs

// ── CRÉER UNE SALLE ──────────────────────────────────────────────
export async function createRoom({ roomName, username, maxRounds, winMode }) {
    const user = await waitForAuth();
    if (!user) return;

    // Fallback TTL : Nettoyage des anciennes salles de cet utilisateur
    try {
        const oldRoomsQuery = query(
            collection(db, "rooms"), 
            where("creatorUid", "==", user.uid),
            where("expireAt", "<", new Date())
        );
        const oldSnaps = await getDocs(oldRoomsQuery);
        oldSnaps.forEach(oldDoc => deleteDoc(oldDoc.ref));
    } catch (e) { 
        console.warn("Multiplayer: Cleanup failed", e); 
    }

    const roomId  = _genCode();
    const roomRef = doc(db, "rooms", roomId);

    const { incrementGlobalStat } = await import('./firebase-app.js');
    incrementGlobalStat('roomsCreated');

    await setDoc(roomRef, {
        roomId,
        name:       roomName || `Salle de ${username}`,
        creatorUid: user.uid,
        hostId:     user.uid,
        state:      "WAITING",
        locked:     false,
        maxRounds:  maxRounds || 3,
        winMode:    winMode || 1,
        currentRound: 1,
        articleId:  null,
        startTime:  null,
        createdAt:  Date.now(),
        expireAt:   new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // TTL: 30 jours
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
    
    // Vérification de l'expiration (Fallback TTL)
    const expireDate = data.expireAt?.toDate ? data.expireAt.toDate() : new Date(data.expireAt || 0);
    if (expireDate < new Date()) {
        throw new Error("Cette salle a expiré (limite de 30 jours).");
    }

    if (data.locked)             throw new Error("Cette salle est verrouillée.");
    if (data.state === "FINISHED") throw new Error("Cette partie est déjà terminée.");

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
    const btn = document.getElementById('mp-start-btn');
    const originalHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Recherche d\'un article…';
    }

    try {
        // Signaler la recherche à tout le monde
        await updateDoc(doc(db, "rooms", _roomId), { state: "SEARCHING" });

        const article = await fetchRandomArticle();
        if (!article) { 
            showInfoModal("Erreur", "Impossible de charger un article aléatoire depuis Wikipédia.", "error"); 
            await updateDoc(doc(db, "rooms", _roomId), { state: "WAITING" });
            if (btn) { btn.disabled = false; btn.innerHTML = originalHtml; }
            return; 
        }

        const snap = await getDoc(doc(db, "rooms", _roomId));
        const data = snap.data();

        // Remettre finished à false pour tous les joueurs
        const updates = { 
            state: "PLAYING", 
            articleId: article.id, 
            startTime: Date.now(),
            roundWinner: deleteField(),
            countdownEnd: deleteField(),
            roundFinished: deleteField()
        };
    Object.keys(data.players || {}).forEach(uid => {
        updates[`players.${uid}.finished`] = false;
        updates[`players.${uid}.attempts`] = 0;
    });
    await updateDoc(doc(db, "rooms", _roomId), updates);
    } catch (err) {
        console.error(err);
        showInfoModal("Erreur", "Une erreur est survenue lors du lancement de la manche.", "error");
        await updateDoc(doc(db, "rooms", _roomId), { state: "WAITING" });
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    }
}

export async function pauseGame() {
    const user = getCurrentUser();
    if (!user) return;

    const roomRef = doc(db, "rooms", _roomId);
    const snap = await getDoc(roomRef);
    if (!snap.exists()) return;
    const data = snap.data();

    if (data.state === "PLAYING") {
        // N'importe qui peut mettre pause
        await updateDoc(roomRef, { 
            state: "PAUSED", 
            pausedBy: user.uid 
        });
    } else if (data.state === "PAUSED") {
        // Seul celui qui a mis pause (ou l'admin par sécurité ?) peut relancer
        // On suit la règle demandée : celui qui a mis pause relance.
        if (data.pausedBy === user.uid) {
            await updateDoc(roomRef, { 
                state: "PLAYING", 
                pausedBy: deleteField() 
            });
        }
    }
}

export async function stopGame() {
    await updateDoc(doc(db, "rooms", _roomId), { state: "FINISHED" });
}

export async function nextArticle() {
    const snap = await getDoc(doc(db, "rooms", _roomId));
    const data = snap.data();
    const nextRound = (data.currentRound || 1) + 1;

    // Signaler la recherche
    await updateDoc(doc(db, "rooms", _roomId), { state: "SEARCHING" });

    if (nextRound > data.maxRounds) {
        await updateDoc(doc(db, "rooms", _roomId), { state: "FINISHED" });
        return;
    }

    const article = await fetchRandomArticle();
    if (!article) {
        await updateDoc(doc(db, "rooms", _roomId), { state: "WAITING" });
        return;
    }

    const updates = { 
        state: "PLAYING", 
        articleId: article.id, 
        startTime: Date.now(), 
        currentRound: nextRound,
        roundWinner: deleteField(),
        countdownEnd: deleteField(),
        roundFinished: deleteField()
    };
    Object.keys(data.players || {}).forEach(uid => {
        updates[`players.${uid}.finished`] = false;
        updates[`players.${uid}.attempts`] = 0;
    });
    await updateDoc(doc(db, "rooms", _roomId), updates);
}

// ── QUITTER LA SALLE ─────────────────────────────────────────────
export function leaveRoom() {
    console.log("Multiplayer: Leaving room and cleaning up listeners...");
    if (_unsub) { _unsub(); _unsub = null; }
    if (_countdownInterval) { clearInterval(_countdownInterval); _countdownInterval = null; }
    if (window._mpHeartbeat) { clearInterval(window._mpHeartbeat); window._mpHeartbeat = null; }
    _roomId = null;
    _lastRoomData = null;
    window._mpGameStarted = false;
    window._mpArticleId = null;
    window.mpReportProgress = null;
}
window.mpLeaveRoom = leaveRoom;

// ── RAPPORT DE PROGRESSION ────────────────────────────────────────
export async function reportProgress(found, total, finished, attempts) {
    if (!_roomId) return;
    const user = getCurrentUser();
    if (!user) return;

    console.log(`Multiplayer: Reporting progress for ${user.uid} - Found: ${found}/${total}, Finished: ${finished}`);

    const roomRef = doc(db, "rooms", _roomId);
    const data = _lastRoomData; // Utilisation du cache local au lieu d'un getDoc()
    if (!data) return;

    const round = data.currentRound || 1;
    const updates = {};
    
    // Calcul du score (mots trouvés)
    let scoreForRound = found;

    // Mode 2 : Bonus de vitesse si l'article est trouvé
    if (data.winMode === 2 && finished && !data.players[user.uid]?.finished) {
        const elapsedSec = Math.floor((Date.now() - data.startTime) / 1000);
        // Bonus dégressif : 200 points si trouvé en 10s, 0 si > 3min30
        const timeBonus = Math.max(0, 200 - Math.floor(elapsedSec / 1)); 
        scoreForRound += timeBonus;
    }

    updates[`players.${user.uid}.roundScores.${round}`] = scoreForRound;
    updates[`players.${user.uid}.finished`] = finished;
    updates[`players.${user.uid}.attempts`] = attempts;

    // Recalculer le score total
    const existing = data.players?.[user.uid]?.roundScores || {};
    const total_score = Object.values({ ...existing, [round]: scoreForRound }).reduce((a, b) => a + b, 0);
    updates[`players.${user.uid}.totalScore`] = total_score;

    // Logique de fin de manche
    if (finished && data.state === "PLAYING") {
        const winnerName = user.displayName || user.uid;
        if (data.winMode === 1) {
            // Mode 1 : Stop immédiat pour tout le monde
            updates.state = "PAUSED";
            updates.roundFinished = true;
            updates.roundWinner = winnerName;
        } else if (data.winMode === 3 && !data.countdownEnd) {
            // Mode 3 : Déclenchement du compte à rebours de 1 minute
            updates.countdownEnd = Date.now() + 60000;
            updates.roundWinner = winnerName;
        }
    }

    await updateDoc(roomRef, updates);
}

// ── SUBSCRIPTION ──────────────────────────────────────────────────
function _subscribe(roomId) {
    if (_unsub) { _unsub(); _unsub = null; }

    _unsub = onSnapshot(doc(db, "rooms", roomId), (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        _lastRoomData = data; // Mise à jour du cache local

        // Vérification de l'expiration en temps réel
        const expireDate = data.expireAt?.toDate ? data.expireAt.toDate() : new Date(data.expireAt || 0);
        if (expireDate < new Date()) {
            showInfoModal("Salle expirée", "Cette salle a dépassé la limite de 30 jours et n'est plus accessible.", "info");
            leaveRoom();
            navigateTo('home');
            return;
        }

        const user = getCurrentUser();

        // Heartbeat pour la présence
        if (!window._mpHeartbeat) {
            window._mpHeartbeat = setInterval(() => {
                const u = getCurrentUser();
                if (u && _roomId) {
                    updateDoc(doc(db, "rooms", _roomId), { [`players.${u.uid}.lastSeen`]: Date.now() });
                }
            }, 20000);
        }

        if (data.state === "WAITING") {
            window._mpGameStarted = false;
            window._mpArticleId = null;
            _renderLobby(data, roomId, user);
        } else if (data.state === "SEARCHING") {
            _renderSearching(data);
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
            _updateCountdown(data);
        } else if (data.state === "PAUSED") {
            if (window._pauseTimer) window._pauseTimer();
            _showPauseBanner();
        } else if (data.state === "FINISHED") {
            if (window._pauseTimer) window._pauseTimer();
            _renderLeaderboard(data);
            _checkMultiplayerRewards(data);
        }
    });
}

async function _checkMultiplayerRewards(data) {
    const user = getCurrentUser();
    if (!user || user.isAnonymous) return;
    
    // Éviter les doubles récompenses pour la même session/salle
    const rewardKey = `reward_mp_${_roomId}`;
    if (localStorage.getItem(rewardKey)) return;
    
    const players = Object.entries(data.players || {})
        .sort(([, a], [, b]) => b.totalScore - a.totalScore);
    
    const N = players.length;
    if (N < 2) return; // Pas de points si on est tout seul

    const myIndex = players.findIndex(([uid]) => uid === user.uid);
    if (myIndex === -1) return;
    
    const rank = myIndex + 1;
    // Formule : XP = max(0, min(8, (N - rank) * 2))
    const xpToAdd = Math.max(0, Math.min(8, (N - rank) * 2));
    
    if (xpToAdd > 0) {
        const { db, updateDoc, doc, increment } = await import("./firebase-app.js");
        try {
            const updates = { 
                xp: increment(xpToAdd),
                mpGamesPlayed: increment(1)
            };
            if (rank === 1) updates.mpWins = increment(1);
            
            await updateDoc(doc(db, "users", user.uid), updates);
            console.log(`Competition Rewards: +${xpToAdd} XP (Rank #${rank}/${N})`);
        } catch (e) {
            console.error("Competition Rewards: Error updating XP", e);
        }
    } else {
        // Même si 0 XP gagné, on compte la partie jouée
        const { db, updateDoc, doc, increment } = await import("./firebase-app.js");
        await updateDoc(doc(db, "users", user.uid), { mpGamesPlayed: increment(1) }).catch(() => {});
    }
    
    localStorage.setItem(rewardKey, "true");
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
    
    const user = getCurrentUser();
    const isAdmin = user && data.creatorUid === user.uid;
    const round = data.currentRound || 1;
    
    // Players (approved) avec leur UID
    const players = Object.entries(data.players || {}).filter(([uid, p]) => p.approved);
    
    // Tri par mots trouvés dans la manche en cours
    players.sort(([uidA, a], [uidB, b]) => {
        const scoreA = a.roundScores?.[round] || 0;
        const scoreB = b.roundScores?.[round] || 0;
        return scoreB - scoreA;
    });

    let html = players.map(([uid, p]) => {
        const found = p.roundScores?.[round] || 0;
        const finishedIcon = p.finished ? '<i class="fa-solid fa-check-circle" style="color:#10b981;"></i>' : '';
        const isOffline = p.lastSeen && (Date.now() - p.lastSeen > 45000);
        const isMe = user && uid === user.uid;
        
        let style = `display:flex; align-items:center; gap:10px; padding:8px 12px; border-radius:10px; margin-bottom:6px; border:1px solid #e5e7eb; transition:all 0.3s; position:relative;`;
        
        if (isMe) {
            style += `outline: 2px solid var(--accent); outline-offset: -2px; box-shadow: 0 4px 12px rgba(243, 156, 18, 0.15);`;
        }

        if (p.finished) {
            style += `background:#ecfdf5; border-color:#10b981;`;
        } else if (isOffline) {
            style += `background:#f9fafb; border-color:#f3f4f6; opacity:0.6; filter:grayscale(1);`;
        } else {
            style += `background:white;`;
        }

        return `
            <div style="${style}">
                <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:flex; gap:6px; align-items:center; font-size:0.85rem; font-weight:${isMe ? '800' : '600'}; color:${isOffline ? '#9ca3af' : 'var(--text-main)'}">
                    ${isMe ? '<i class="fa-solid fa-caret-right" style="color:var(--accent);"></i>' : ''}
                    ${p.name} ${finishedIcon}
                </span>
                <div style="display:flex; gap:8px; align-items:center;">
                    <span style="font-size:0.65rem; color:#9ca3af;"><i class="fa-solid fa-bullseye"></i> ${p.attempts || 0}</span>
                    <div class="guess-badge" style="background:${p.finished ? '#10b981' : 'var(--primary)'}; color:white; min-width:24px; height:24px; padding:0 6px;">${found}</div>
                </div>
            </div>
        `;
    }).join('');

    // Afficher les demandes en attente pour l'admin
    const pending = Object.entries(data.pending || {});
    if (isAdmin && pending.length > 0) {
        html += `
            <div style="border-top:1px dashed #d1d5db; margin-top:1rem; padding-top:1rem;">
                <p style="font-size:0.65rem; font-weight:800; color:var(--accent); text-transform:uppercase; margin-bottom:0.75rem; letter-spacing:0.05em;">
                    <i class="fa-solid fa-user-clock"></i> Demandes (${pending.length})
                </p>
                ${pending.map(([uid, p]) => `
                    <div style="display:flex; justify-content:space-between; align-items:center; background:#fffbeb; padding:6px 10px; border-radius:8px; margin-bottom:5px; border:1px solid #fde68a;">
                        <span style="font-size:0.75rem; font-weight:600; color:#92400e; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-right:8px;">${p.name}</span>
                        <div style="display:flex; gap:4px;">
                            <button onclick="window._mpApprove('${uid}')" style="all:unset; cursor:pointer; color:#065f46; background:#d1fae5; width:22px; height:22px; display:flex; align-items:center; justify-content:center; border-radius:4px; font-size:0.75rem;"><i class="fa-solid fa-check"></i></button>
                            <button onclick="window._mpReject('${uid}')" style="all:unset; cursor:pointer; color:#991b1b; background:#fee2e2; width:22px; height:22px; display:flex; align-items:center; justify-content:center; border-radius:4px; font-size:0.75rem;"><i class="fa-solid fa-xmark"></i></button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    listEl.innerHTML = html;
}

// ── PANNEAU ADMIN (pendant la partie) ────────────────────────────
function _injectAdminPanel(data) {
    const slot = document.getElementById('mp-admin-slot');
    if (!slot || document.getElementById('mp-admin-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'mp-admin-panel';
    panel.style.cssText = `
        background: white; border: 1px solid #e5e7eb; border-radius: 14px;
        padding: 12px 20px; box-shadow: 0 4px 15px rgba(0,0,0,0.05);
        display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;
        margin-bottom: 1.5rem; width: 100%;
    `;
    panel.innerHTML = `
        <div style="font-weight:800; font-size:0.75rem; text-transform:uppercase; letter-spacing:.05em; color:#6b7280; display:flex; align-items:center; gap:8px;">
            <i class="fa-solid fa-crown" style="color:gold;"></i> Admin
        </div>
        <div id="mp-round-info" style="font-size:0.85rem; color:#374151; font-weight:700; margin-right:auto;"></div>
        
        <div style="display:flex; gap:8px;">
            <button id="mp-pause-btn" onclick="window._mpPause()" style="all:unset; cursor:pointer; background:#f3f4f6; color:#374151; border:1px solid #d1d5db; padding:6px 14px; border-radius:8px; font-size:0.8rem; font-weight:600; display:flex; align-items:center; gap:6px; transition:all 0.2s;">
                <i class="fa-solid fa-pause"></i> Pause
            </button>
            <button id="mp-next-btn" onclick="window._mpNext()" style="all:unset; cursor:pointer; background:var(--accent); color:white; padding:6px 14px; border-radius:8px; font-size:0.8rem; font-weight:600; display:flex; align-items:center; gap:6px;">
                <i class="fa-solid fa-forward"></i> Suivant
            </button>
            <button id="mp-stop-btn" onclick="window._mpStop()" style="all:unset; cursor:pointer; background:#fef2f2; color:#dc2626; padding:6px 14px; border-radius:8px; font-size:0.8rem; font-weight:600; display:flex; align-items:center; gap:6px;">
                <i class="fa-solid fa-stop"></i> Arrêter
            </button>
        </div>
    `;
    slot.appendChild(panel);
    _updateAdminPanel(data);
}

// ── COMPTE À REBOURS (Mode 3) ─────────────────────────────────────
function _updateCountdown(data) {
    if (data.countdownEnd && data.state === "PLAYING") {
        if (!_countdownInterval) {
            _countdownInterval = setInterval(() => {
                const remaining = Math.max(0, Math.floor((data.countdownEnd - Date.now()) / 1000));
                const banner = document.getElementById('mp-countdown-banner');
                if (banner) {
                    banner.querySelector('.cd-time').textContent = remaining;
                }
                if (remaining <= 0) {
                    clearInterval(_countdownInterval);
                    _countdownInterval = null;
                    if (data.creatorUid === getCurrentUser()?.uid) {
                        updateDoc(doc(db, "rooms", _roomId), { state: "PAUSED", roundFinished: true });
                    }
                }
            }, 1000);
        }
        
        // Affichage initial ou forcé
        let banner = document.getElementById('mp-countdown-banner');
        const slot = document.getElementById('mp-admin-slot');
        if (slot && !banner) {
            banner = document.createElement('div');
            banner.id = 'mp-countdown-banner';
            banner.style.cssText = `
                background: #fffbeb; border: 1px solid #fde68a; border-radius: 12px;
                padding: 10px 15px; margin-bottom: 1rem; display: flex; align-items: center; justify-content: center; gap: 10px;
                font-weight: 800; color: #92400e; width: 100%;
            `;
            banner.innerHTML = `
                <i class="fa-solid fa-hourglass-start fa-spin"></i>
                <span>DERNIÈRE MINUTE ! <span class="cd-time" style="font-family:var(--font-mono); font-size:1.2rem;">--</span>s</span>
            `;
            slot.insertBefore(banner, slot.firstChild);
        }
    } else {
        if (_countdownInterval) {
            clearInterval(_countdownInterval);
            _countdownInterval = null;
        }
        document.getElementById('mp-countdown-banner')?.remove();
    }
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
        
        // Amélioration visuelle dynamique
        if (paused) {
            pauseBtn.style.background = 'var(--primary)';
            pauseBtn.style.color = 'white';
            pauseBtn.style.borderColor = 'transparent';
        } else {
            pauseBtn.style.background = '#f3f4f6';
            pauseBtn.style.color = '#374151';
            pauseBtn.style.borderColor = '#d1d5db';
        }
    }
}

function _removeAdminPanel() {
    document.getElementById('mp-admin-panel')?.remove();
}

function _showPauseBanner() {
    if (document.getElementById('mp-pause-banner')) return;
    if (!_lastRoomData) return;

    const data = _lastRoomData;
    const winner = data.roundWinner ? (data.players[data.roundWinner]?.name || "Un joueur") : null;
    const isTimeUp = data.roundFinished;

    const banner = document.createElement('div');
    banner.id = 'mp-pause-banner';
    banner.style.cssText = `
        position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:300;
        display:flex; align-items:center; justify-content:center;
        backdrop-filter: blur(4px);
    `;
    
    const user = getCurrentUser();
    const isAdmin = user && data.creatorUid === user.uid;

    const pauserUid = data.pausedBy;
    const pauserName = pauserUid ? (data.players[pauserUid]?.name || "Un joueur") : null;
    const canResume = user && user.uid === pauserUid;

    let content = "";
        if (winner) {
            content = `
                <i class="fa-solid fa-trophy" style="font-size:3rem; color:#f1c40f; margin-bottom:1rem;"></i>
                <h2 style="margin:0; font-size:1.8rem;">Article trouvé !</h2>
                <p style="color:#6b7280; margin-top:.75rem; font-size:1.1rem;">Bravo à <strong>${winner}</strong></p>
                ${isAdmin ? `
                    <button onclick="window._mp${data.currentRound < data.maxRounds ? 'Next' : 'Stop'}()" class="btn-primary" style="margin-top:2rem; width:100%; justify-content:center;">
                        <i class="fa-solid fa-${data.currentRound < data.maxRounds ? 'forward' : 'square-poll-vertical'}"></i>
                        ${data.currentRound < data.maxRounds ? 'Manche suivante' : 'Voir les résultats'}
                    </button>
                ` : `
                    <p style="color:#94a3b8; font-size:0.85rem; margin-top:1.5rem;">L'hôte va bientôt lancer la suite…</p>
                `}
            `;
        } else if (isTimeUp) {
            content = `
                <i class="fa-solid fa-hourglass-end" style="font-size:3rem; color:var(--accent); margin-bottom:1rem;"></i>
                <h2 style="margin:0; font-size:1.8rem;">Temps écoulé !</h2>
                <p style="color:#6b7280; margin-top:.75rem; font-size:1.1rem;">La manche est terminée.</p>
                ${isAdmin ? `
                    <button onclick="window._mp${data.currentRound < data.maxRounds ? 'Next' : 'Stop'}()" class="btn-primary" style="margin-top:2rem; width:100%; justify-content:center;">
                        <i class="fa-solid fa-${data.currentRound < data.maxRounds ? 'forward' : 'square-poll-vertical'}"></i>
                        ${data.currentRound < data.maxRounds ? 'Manche suivante' : 'Voir les résultats'}
                    </button>
                ` : `
                    <p style="color:#94a3b8; font-size:0.85rem; margin-top:1.5rem;">L'hôte va bientôt lancer la suite…</p>
                `}
            `;
        } else {
            content = `
                <i class="fa-solid fa-pause" style="font-size:2rem; color:var(--accent); margin-bottom:1rem;"></i>
                <h2 style="margin:0;">Partie en pause</h2>
                <p style="color:#6b7280; margin-top:.5rem;"><strong>${pauserName}</strong> a mis la partie en pause.</p>
                ${canResume ? `
                    <button onclick="window._mpPause()" class="btn-primary" style="margin-top:2rem; width:100%; justify-content:center;">
                        <i class="fa-solid fa-play"></i> Reprendre la partie
                    </button>
                ` : `
                    <p style="color:#94a3b8; font-size:0.85rem; margin-top:1.5rem;">En attente de reprise par ${pauserName}…</p>
                `}
            `;
        }

        banner.innerHTML = `
            <div class="glass" style="background:white; padding:3rem; border-radius:24px; text-align:center; box-shadow:0 20px 50px rgba(0,0,0,0.2); max-width:90%; width:400px;">
                ${content}
            </div>
        `;
        document.body.appendChild(banner);
}

// ── ÉCRAN DE RECHERCHE (LOADER SYNC) ──────────────────────────────
function _renderSearching(data) {
    const container = document.getElementById('main-container');
    if (!container) return;

    const hostName = data.players[data.hostId]?.name || "L'hôte";

    container.innerHTML = `
        <div class="glass" style="max-width:450px; margin:4rem auto; padding:3.5rem 2rem; text-align:center; border-radius:24px; box-shadow:0 20px 50px rgba(0,0,0,0.1);">
            <div class="loading-spinner" style="margin: 0 auto 2rem; width: 60px; height: 60px; border-width: 6px; border-top-color: var(--accent);"></div>
            <h2 style="margin:0 0 1rem; font-size:1.6rem; font-weight:800; color:#111827;">Préparation de la manche...</h2>
            <div style="background:#f3f4f6; padding:1.25rem; border-radius:16px; border:1px solid #e5e7eb;">
                <p style="color:#4b5563; line-height:1.6; margin:0; font-size:1rem;">
                    <i class="fa-solid fa-crown" style="color:#fbbf24; margin-right:6px;"></i>
                    <strong>${hostName}</strong> a lancé la partie !
                </p>
                <p style="color:#6b7280; font-size:0.9rem; margin-top:0.5rem;">
                    <span id=" loading-status-text\>Recherche d'un article</span> Wikipédia passionnant en cours...
                </p>
            </div>
            <p style="color:#94a3b8; font-size:0.8rem; margin-top:2rem;">
                <i class="fa-solid fa-bolt fa-fade"></i> Tenez-vous prêt, ça va commencer !
            </p>
        </div>
    `;
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
            <button id="mp-start-btn" onclick="window._mpStart()" class="btn-accent" style="width:100%;justify-content:center;font-size:1rem;" ${players.length < 1 ? 'disabled' : ''}>
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

    // Confetti pour le podium !
    const myIndex = players.findIndex(([uid]) => uid === user?.uid);
    if (myIndex !== -1 && myIndex < 3) {
        confetti({
            particleCount: 100,
            spread: 60,
            origin: { y: 0.6 },
            colors: ['#f1c40f', '#f39c12', '#e67e22'] // Gold/Bronze colors
        });
    }

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
