import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
    getFirestore,
    collection, doc, setDoc, getDoc, updateDoc,
    onSnapshot, increment, serverTimestamp,
    runTransaction, query, where, getDocs, deleteDoc, deleteField, arrayUnion,
    orderBy, limit, getCountFromServer,
    enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
    getAuth,
    signInAnonymously,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInWithPopup,
    GoogleAuthProvider,
    signOut,
    updateProfile,
    sendPasswordResetEmail,
    deleteUser
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import firebaseConfig from './firebase-config.js';
import { getAvatarHtml } from './avatars.js';


// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// Activation du cache local (Offline Persistence)
enableIndexedDbPersistence(db).catch((err) => {
    if (err.code == 'failed-precondition') {
        console.warn("Firestore: Persistence failed (multiple tabs).");
    } else if (err.code == 'unimplemented') {
        console.warn("Firestore: Persistence not supported.");
    }
});

let currentUser = null;

// Resolves once auth state is known (user logged in)
let _authResolve;
const authReady = new Promise(resolve => { _authResolve = resolve; });

onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (user) {
        console.log("Auth: Logged in. UID:", user.uid, "| anon:", user.isAnonymous);
        updateUserProfileUI(user);

        // ✅ Résoudre authReady IMMÉDIATEMENT — ne pas bloquer sur Firestore
        if (_authResolve) { _authResolve(user); _authResolve = null; }

        // Sync Firestore en arrière-plan uniquement pour les utilisateurs connectés
        if (!user.isAnonymous) {
            _syncUserDoc(user); // async, non bloquant
        }
    } else {
        console.log("Auth: No user – signing in anonymously...");
        signInAnonymously(auth).catch(err => {
            console.error("Auth: Anon sign-in error:", err);
            // Fallback: create a local guest if Firebase Anon Auth is disabled
            let localGuestId = localStorage.getItem("localGuestId");
            if (!localGuestId) {
                localGuestId = "guest_" + Math.random().toString(36).substr(2, 9);
                localStorage.setItem("localGuestId", localGuestId);
            }
            currentUser = { uid: localGuestId, isAnonymous: true, isLocalGuest: true };
            if (_authResolve) { _authResolve(currentUser); _authResolve = null; }
            updateUserProfileUI(currentUser);
        });
    }
});

async function _syncUserDoc(user) {
    try {
        const userRef = doc(db, "users", user.uid);
        const snap    = await getDoc(userRef);
        if (!snap.exists()) {
            await setDoc(userRef, {
                uid:              user.uid,
                email:            user.email || null,
                pseudo:           user.displayName || null,
                bio:              "",
                avatarId:         0,
                photoURL:         user.photoURL || null,

                createdAt:        serverTimestamp(),
                lastLoginAt:      serverTimestamp(),
                xp:               0,
                isPublic:         true,
                gamesPlayed:      0,
                dailyHistory:     []
            });
        } else {
            const data = snap.data();
            const updates = { lastLoginAt: serverTimestamp() };
            
            // Gestion de l'assiduité (Missions)
            const todayStr = new Date().toISOString().split('T')[0];
            const lastDay = data.lastActiveDay || "";
            
            if (lastDay !== todayStr) {
                updates.lastActiveDay = todayStr;
                updates.daysPlayed = increment(1);
                
                // Calcul de la série (streak)
                const yesterday = new Date();
                yesterday.setDate(yesterday.getDate() - 1);
                const yesterdayStr = yesterday.toISOString().split('T')[0];
                
                if (lastDay === yesterdayStr) {
                    updates.streak = increment(1);
                } else {
                    updates.streak = 1;
                }
            }

            // S'assurer que les anciens utilisateurs ont les champs nécessaires pour le classement
            if (data.xp === undefined) updates.xp = 0;
            if (data.isPublic === undefined) updates.isPublic = true;
            
            await updateDoc(userRef, updates);
        }

        // 🔄 Rafraîchir l'UI avec les données fraîches de Firestore (Pseudo et Photo)
        const finalSnap = await getDoc(userRef);
        if (finalSnap.exists()) {
            updateUserProfileUI(user, finalSnap.data());
        }
    } catch (e) {
        console.error("Auth: Error syncing user doc:", e);
    }
}

export async function incrementGlobalStat(statName) {
    try {
        const statsRef = doc(db, "global_stats", "counters");
        await setDoc(statsRef, { [statName]: increment(1) }, { merge: true });
    } catch (e) {
        console.error("Stats: Error incrementing global stat:", statName, e);
    }
}



function getCurrentUser() { return currentUser; }
function waitForAuth()    { return authReady; }

let _lastNavUpdate = { name: '', photo: '', avatarId: -1 };


// Cache global pour les images en échec (évite les 429 et le clignotement)
window._failedAvatarUrls = window._failedAvatarUrls || new Set();

window._handleAvatarError = (img, url, fallbackIcon = 'fa-user-astronaut') => {
    window._failedAvatarUrls.add(url);
    img.outerHTML = `<i class="fa-solid ${fallbackIcon}"></i>`;
};

function updateUserProfileUI(user, firestoreData = null) {
    const btn = document.getElementById('user-profile-btn');
    const adminArea = document.getElementById('admin-nav-area');
    if (!btn) return;

    const isAnon = user.isAnonymous;
    
    // Préférer les données Firestore si disponibles, sinon utiliser Auth
    const name = (firestoreData && firestoreData.pseudo) 
        ? firestoreData.pseudo 
        : (user.displayName || user.email?.split('@')[0] || `Joueur-${user.uid.replace('guest_', '').slice(0, 4).toUpperCase()}`);
        
    // Priorité absolue aux avatars. On ignore la photo Google pour éviter les erreurs 429
    // et respecter la consigne de suppression de la gestion des photos de profil.
    let photo = (firestoreData && firestoreData.photoURL) ? firestoreData.photoURL : null;


    let avatarId = firestoreData?.avatarId ?? -1;

    // Si l'image a déjà échoué, on utilise le placeholder
    if (photo && window._failedAvatarUrls.has(photo)) {
        photo = null;
    }

    const isAdmin = Boolean(firestoreData && (firestoreData.isAdmin === true || firestoreData.role === 'admin'));

    // ⚡ Optimisation : Éviter de rafraichir le DOM si rien n'a changé
    if (_lastNavUpdate.name === name && 
        _lastNavUpdate.photo === (photo || '') && 
        _lastNavUpdate.avatarId === avatarId &&
        _lastNavUpdate.isAdmin === isAdmin) {
        return;
    }
    _lastNavUpdate = { name, photo: photo || '', avatarId, isAdmin };

    // 1. Gérer le bouton Admin (Indépendant)
    if (adminArea) {
        if (isAdmin) {
            adminArea.innerHTML = `<div id="nav-admin-shortcut" style="color:var(--accent); margin-right:15px; font-size:1.1rem; padding: 8px; cursor:pointer; transition:all 0.2s;" title="Console Admin" onmouseover="this.style.transform='translateY(-2px)';" onmouseout="this.style.transform='none';"><i class="fa-solid fa-user-shield"></i></div>`;
            document.getElementById('nav-admin-shortcut').onclick = (e) => {
                e.stopPropagation();
                if (window.openAdminDashboard) window.openAdminDashboard();
            };
        } else {
            adminArea.innerHTML = '';
        }
    }

    // 2. Gérer le bouton Profil
    const fallbackIcon = isAnon ? 'fa-user' : 'fa-user-astronaut';
    
    let avatarHtml = '';
    if (firestoreData && firestoreData.avatarId !== undefined) {
        avatarHtml = getAvatarHtml(firestoreData.avatarId, "34px", "0.9rem");
    } else if (photo && !window._failedAvatarUrls.has(photo)) {
        avatarHtml = `<img src="${photo}" class="avatar-img" alt="avatar" onerror="window._handleAvatarError(this, '${photo}', '${fallbackIcon}')">`;
    } else {
        // Avatar par défaut si rien d'autre n'est dispo
        avatarHtml = getAvatarHtml(0, "34px", "0.9rem");
    }


    btn.innerHTML = `
        <span class="username">${name}</span>
        ${avatarHtml}
    `;

    // Bouton de déconnexion rapide dans la navbar
    let logoutNavBtn = document.getElementById('nav-logout-btn');
    if (!isAnon) {
        if (!logoutNavBtn) {
            logoutNavBtn = document.createElement('button');
            logoutNavBtn.id = 'nav-logout-btn';
            logoutNavBtn.title = 'Se déconnecter';
            logoutNavBtn.innerHTML = '<i class="fa-solid fa-right-from-bracket"></i>';
            logoutNavBtn.style.cssText = 'background:transparent; border:none; color:rgba(255,255,255,0.8); font-size:1rem; cursor:pointer; padding:0.4rem 0.6rem; border-radius:6px; transition:all 0.2s; margin-left:4px;';
            logoutNavBtn.onmouseover = () => { logoutNavBtn.style.background = 'rgba(255,255,255,0.15)'; logoutNavBtn.style.color = 'white'; };
            logoutNavBtn.onmouseout = () => { logoutNavBtn.style.background = 'transparent'; logoutNavBtn.style.color = 'rgba(255,255,255,0.8)'; };
            logoutNavBtn.onclick = async (e) => {
                e.stopPropagation();
                await signOut(auth);
                window.location.href = window.location.origin + window.location.pathname;
            };
            btn.parentElement.appendChild(logoutNavBtn);
        }
    } else {
        if (logoutNavBtn) logoutNavBtn.remove();
    }
}


export {
    db, auth, googleProvider,
    signInWithEmailAndPassword, createUserWithEmailAndPassword,
    signInWithPopup, signOut, updateProfile,
    sendPasswordResetEmail, deleteUser,
    collection, doc, setDoc, getDoc, updateDoc,
    onSnapshot, increment, serverTimestamp,
    runTransaction, query, where, getDocs, deleteDoc, deleteField, arrayUnion,
    orderBy, limit, getCountFromServer,
    waitForAuth, getCurrentUser, updateUserProfileUI
};
