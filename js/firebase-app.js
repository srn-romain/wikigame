// Import Firebase SDKs from CDN
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, doc, setDoc, getDoc, updateDoc, onSnapshot, arrayUnion } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import firebaseConfig from './firebase-config.js';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Simple User Management
let currentUser = null;

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        console.log("Logged in:", user.uid);
        updateUserProfile(user);
    } else {
        signInAnonymously(auth).catch(console.error);
    }
});

function updateUserProfile(user) {
    const btn = document.getElementById('user-profile-btn');
    if (btn) btn.innerHTML = `<span class="username">Joueur-${user.uid.slice(0, 4)}</span><div class="avatar-placeholder" style="background:var(--accent);"><i class="fa-solid fa-user-astronaut"></i></div>`;
}

export { db, auth, currentUser, collection, doc, setDoc, getDoc, updateDoc, onSnapshot, arrayUnion };
