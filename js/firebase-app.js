import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
    getFirestore,
    collection, doc, setDoc, getDoc, updateDoc,
    onSnapshot, increment, serverTimestamp,
    runTransaction, query, where, getDocs, deleteDoc, deleteField, arrayUnion
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
                gamesPlayed:      0,
                lastDailyDate:    null,
                dailyFoundToday:  false,
                dailyHistory:     []
            });
        } else {
            await updateDoc(userRef, { lastLoginAt: serverTimestamp() });
        }
    } catch (e) {
        console.error("Auth: Error syncing user doc:", e);
    }
}



function getCurrentUser() { return currentUser; }
function waitForAuth()    { return authReady; }

function updateUserProfileUI(user, userData = {}) {
    const btn = document.getElementById('user-profile-btn');
    if (!btn) return;

    const isAnon = user.isAnonymous;
    const name   = user.displayName || user.email?.split('@')[0] || `Joueur-${user.uid.slice(0, 4)}`;
    const photo  = user.photoURL;

    btn.innerHTML = `
        <span class="username">${name}</span>
        ${photo
            ? `<img src="${photo}" class="avatar-img" alt="avatar">`
            : `<div class="avatar-placeholder" style="background:${isAnon ? 'var(--text-muted)' : 'var(--accent)'};">
                   <i class="fa-solid ${isAnon ? 'fa-user' : 'fa-user-astronaut'}"></i>
               </div>`
        }
        <div class="glass" id="view-daily-history" style="padding: 12px; text-align:center; border-radius:12px; cursor:pointer; transition:all 0.2s; border:1px solid rgba(0,0,0,0.05);" onmouseover="this.style.transform='translateY(-2px)'; this.style.borderColor='var(--accent)';" onmouseout="this.style.transform='none'; this.style.borderColor='rgba(0,0,0,0.05)';">
            <div style="font-size:1.2rem; font-weight:800; color:var(--accent);">${(userData.dailyHistory || []).length}</div>
            <div style="font-size:0.65rem; color:var(--text-muted); text-transform:uppercase; font-weight:700;">Défis Quotidiens Résolus <i class="fa-solid fa-chevron-right" style="margin-left:4px; font-size:0.6rem;"></i></div>
        </div>
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
    waitForAuth, getCurrentUser
};
