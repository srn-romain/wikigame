import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, doc, setDoc, getDoc, updateDoc, onSnapshot, arrayUnion, increment } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
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

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// Simple User Management
let currentUser = null;

// Resolves once auth state is known (user logged in)
let _authResolve;
const authReady = new Promise(resolve => { _authResolve = resolve; });

onAuthStateChanged(auth, (user) => {
    currentUser = user;
    if (user) {
        console.log("Auth: State change -> Logged in. UID:", user.uid);
        updateUserProfile(user);
        if (_authResolve) _authResolve(user);
    } else {
        console.log("Auth: State change -> No user detected. Attempting anonymous sign-in...");
        signInAnonymously(auth).catch(err => console.error("Auth: Anonymous error:", err));
    }
});

export function getCurrentUser() { return currentUser; }
export function waitForAuth() { return authReady; }

function updateUserProfile(user) {
    const btn = document.getElementById('user-profile-btn');
    if (!btn) return;
    
    const isAnon = user.isAnonymous;
    const name = user.displayName || user.email?.split('@')[0] || `Joueur-${user.uid.slice(0, 4)}`;
    const photo = user.photoURL;

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
    signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup, signOut, updateProfile,
    sendPasswordResetEmail, deleteUser,
    collection, doc, setDoc, getDoc, updateDoc, onSnapshot, arrayUnion, increment 
};
