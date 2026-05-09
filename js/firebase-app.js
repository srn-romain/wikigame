import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
    getFirestore,
    collection, doc, setDoc, getDoc, updateDoc,
    onSnapshot, increment, serverTimestamp,
    runTransaction, query, where, getDocs, deleteDoc, deleteField, arrayUnion,
    orderBy, limit, getCountFromServer
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

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

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
            // Résoudre quand même avec null pour éviter le blocage infini
            if (_authResolve) { _authResolve(null); _authResolve = null; }
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

function updateUserProfileUI(user) {
    const btn = document.getElementById('user-profile-btn');
    const adminArea = document.getElementById('admin-nav-area');
    if (!btn) return;

    const isAnon = user.isAnonymous;
    const name   = user.displayName || user.email?.split('@')[0] || `Joueur-${user.uid.slice(0, 4)}`;
    const photo  = user.photoURL;
    const isAdmin = user.uid === "xwX5eCsUqpRLIBAI3K5Y7y70HLp1";

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
    btn.innerHTML = `
        <span class="username">${name}</span>
        ${photo
            ? `<img src="${photo}" class="avatar-img" alt="avatar">`
            : `<div class="avatar-placeholder" style="background:${isAnon ? 'var(--text-muted)' : 'var(--accent)'};">
                   <i class="fa-solid ${isAnon ? 'fa-user' : 'fa-user-astronaut'}"></i>
               </div>`
        }
    `;
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
    waitForAuth, getCurrentUser
};
