import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
    getFirestore,
    collection, doc, setDoc, getDoc, updateDoc,
    onSnapshot, increment, serverTimestamp,
    runTransaction, query, where, getDocs, deleteDoc, deleteField
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
                dailySolvedTotal: 0,
                lastDailyDate:    null,
                dailyFoundToday:  false
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

function updateUserProfileUI(user) {
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
    `;
}

export {
    db, auth, googleProvider,
    signInWithEmailAndPassword, createUserWithEmailAndPassword,
    signInWithPopup, signOut, updateProfile,
    sendPasswordResetEmail, deleteUser,
    collection, doc, setDoc, getDoc, updateDoc,
    onSnapshot, increment, serverTimestamp,
    runTransaction, query, where, getDocs, deleteDoc, deleteField,
    waitForAuth, getCurrentUser
};
