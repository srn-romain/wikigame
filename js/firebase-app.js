import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
    getFirestore,
    collection, doc, setDoc, getDoc, updateDoc,
    onSnapshot, increment, serverTimestamp,
    runTransaction, query, where, getDocs, deleteDoc
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

        // Only persist data for non-anonymous users
        if (!user.isAnonymous) {
            try {
                const userRef = doc(db, "users", user.uid);
                const snap    = await getDoc(userRef);

                if (!snap.exists()) {
                    // First time: create full document
                    await setDoc(userRef, {
                        uid:            user.uid,
                        email:          user.email || null,
                        pseudo:         user.displayName || null,
                        bio:            "",
                        photoURL:       user.photoURL || null,
                        createdAt:      serverTimestamp(),
                        lastLoginAt:    serverTimestamp(),
                        // Stats
                        gamesPlayed:    0,
                        dailySolvedTotal: 0,
                        // Daily state (reset each day)
                        lastDailyDate:  null,
                        dailyFoundToday: false
                    });
                } else {
                    // Update only the login timestamp
                    await updateDoc(userRef, { lastLoginAt: serverTimestamp() });
                }
            } catch (e) {
                console.error("Auth: Error syncing user doc:", e);
            }
        }

        if (_authResolve) { _authResolve(user); _authResolve = null; }
    } else {
        console.log("Auth: No user – signing in anonymously...");
        signInAnonymously(auth).catch(err => console.error("Auth: Anon error:", err));
    }
});

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
    runTransaction, query, where, getDocs, deleteDoc,
    waitForAuth, getCurrentUser
};
