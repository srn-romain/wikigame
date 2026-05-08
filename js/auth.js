import { 
    db, auth, googleProvider, 
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInWithPopup,
    signOut,
    updateProfile,
    sendPasswordResetEmail,
    deleteUser,
    getCurrentUser,
    doc, getDoc, setDoc, updateDoc
} from './firebase-app.js';

/**
 * Opens the Auth Modal
 * @param {string} mode 'login' | 'signup'
 */
export async function openAuthModal(mode = 'login') {
    const modalContainer = document.getElementById('modal-container');
    const user = getCurrentUser();

    // If user is already logged in (not anonymously), show a "Profile/Logout" view instead
    if (user && !user.isAnonymous) {
        // Fetch extended profile from Firestore
        const userDoc = await getDoc(doc(db, "users", user.uid));
        const userData = userDoc.exists() ? userDoc.data() : {
            pseudo: user.displayName || "",
            bio: "",
            gamesPlayed: 0,
            dailySolved: 0
        };
        renderProfileModal(modalContainer, user, userData);
    } else {
        renderAuthForm(modalContainer, mode);
    }

    modalContainer.classList.remove('hidden');
}

function renderAuthForm(container, mode) {
    container.innerHTML = `
        <div class="auth-modal">
            <button class="close-modal" id="close-auth">&times;</button>
            <div class="auth-tabs">
                <button class="auth-tab" id="tab-login" data-tab="login">Connexion</button>
                <button class="auth-tab" id="tab-signup" data-tab="signup">Inscription</button>
            </div>

            <div id="auth-error" class="auth-error"></div>
            <div id="auth-success" class="auth-error" style="background:rgba(16, 185, 129, 0.1); color:var(--accent); border-color:rgba(16, 185, 129, 0.2);"></div>

            <form id="auth-form" class="auth-form">
                <div class="form-group">
                    <label>Email</label>
                    <input type="email" id="auth-email" placeholder="votre@email.com" required>
                </div>
                <div class="form-group">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <label>Mot de passe</label>
                        <a href="#" id="forgot-password" style="font-size:0.75rem; color:var(--primary); text-decoration:none;">Oublié ?</a>
                    </div>
                    <input type="password" id="auth-password" placeholder="••••••••" required>
                </div>
                <button type="submit" id="auth-submit" class="btn-primary" style="margin-top:0.5rem; justify-content:center;">
                    Chargement...
                </button>
            </form>

            <div class="divider">ou</div>

            <button id="google-login" class="btn-google">
                <svg width="18" height="18" viewBox="0 0 18 18"><path d="M17.64 9.2c0-.63-.06-1.25-.16-1.84H9v3.47h4.84c-.21 1.12-.84 2.07-1.79 2.7l2.85 2.2c1.67-1.53 2.63-3.8 2.63-6.53z" fill="#4285F4"/><path d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.85-2.2c-.79.53-1.8.85-3.11.85-2.39 0-4.41-1.61-5.14-3.77L.9 13.06C2.39 16 5.45 18 9 18z" fill="#34A853"/><path d="M3.86 10.74c-.18-.54-.28-1.12-.28-1.74s.1-1.2.28-1.74L.9 4.97C.33 6.13 0 7.47 0 9s.33 2.87.9 4.03l2.96-2.29z" fill="#FBBC05"/><path d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.47.89 11.42 0 9 0 5.45 0 2.39 2 0.9 4.97l2.96 2.29c.73-2.16 2.75-3.77 5.14-3.77z" fill="#EA4335"/></svg>
                Continuer avec Google
            </button>
        </div>
    `;

    setupFormEvents(container, mode);
}

function renderProfileModal(container, user, userData) {
    container.innerHTML = `
        <div class="auth-modal" style="max-width: 450px;">
            <button class="close-modal" id="close-auth">&times;</button>
            
            <div style="text-align:center; margin-bottom: 1.5rem;">
                <div class="avatar-placeholder" style="width:70px; height:70px; font-size:1.8rem; margin: 0 auto 0.75rem;">
                    ${user.photoURL ? `<img src="${user.photoURL}" class="avatar-img" style="width:70px; height:70px;">` : `<i class="fa-solid fa-user-astronaut"></i>`}
                </div>
                <h2 style="margin-bottom:0.25rem;">Mon Profil</h2>
                <p style="color:var(--text-muted); font-size:0.8rem;">${user.email}</p>
            </div>

            <div class="stats-row" style="display:grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 1.5rem;">
                <div class="glass" style="padding: 12px; text-align:center; border-radius:12px;">
                    <div style="font-size:1.2rem; font-weight:800; color:var(--primary);">${userData.gamesPlayed || 0}</div>
                    <div style="font-size:0.65rem; color:var(--text-muted); text-transform:uppercase;">Parties</div>
                </div>
                <div class="glass" style="padding: 12px; text-align:center; border-radius:12px;">
                    <div style="font-size:1.2rem; font-weight:800; color:var(--accent);">${userData.dailySolved || 0}</div>
                    <div style="font-size:0.65rem; color:var(--text-muted); text-transform:uppercase;">Défis Trouvés</div>
                </div>
            </div>

            <div id="profile-msg" class="auth-error" style="background:rgba(16, 185, 129, 0.1); color:var(--accent); border-color:rgba(16, 185, 129, 0.2);"></div>

            <div class="auth-form">
                <div class="form-group">
                    <label>Pseudo</label>
                    <input type="text" id="profile-pseudo" value="${userData.pseudo || ''}" placeholder="Votre pseudo">
                </div>
                <div class="form-group">
                    <label>Bio (max 100 caractères)</label>
                    <textarea id="profile-bio" maxlength="100" style="background:rgba(0,0,0,0.3); border:1px solid var(--glass-border); padding:0.8rem; border-radius:var(--radius-md); color:white; font-family:var(--font-ui); resize:none; height:60px;">${userData.bio || ''}</textarea>
                </div>
                
                <button id="save-profile" class="btn-primary" style="justify-content:center;">
                    Sauvegarder les modifications
                </button>

                <button id="reset-pwd-profile" style="background:none; border:none; color:var(--primary); font-size:0.8rem; cursor:pointer; margin-top:0.5rem; text-decoration:underline;">
                    Réinitialiser mon mot de passe
                </button>
            </div>

            <div class="divider" style="margin: 1.5rem 0 1rem;">Actions</div>
            
            <div style="display:flex; flex-direction:column; gap:8px;">
                <button id="logout-btn" class="btn-primary" style="width:100%; background:rgba(255,255,255,0.05); color:white; border: 1px solid var(--glass-border); justify-content:center;">
                    <i class="fa-solid fa-right-from-bracket"></i> Déconnexion
                </button>
                <button id="delete-account-btn" style="color:#f87171; font-size:0.75rem; background:none; border:none; cursor:pointer; text-decoration:underline;">
                    Supprimer mon compte
                </button>
            </div>
        </div>
    `;

    setupProfileEvents(container, user, userData);
}

function setupProfileEvents(container, user, userData) {
    const closeBtn = document.getElementById('close-auth');
    const saveBtn = document.getElementById('save-profile');
    const logoutBtn = document.getElementById('logout-btn');
    const deleteBtn = document.getElementById('delete-account-btn');
    const resetBtn = document.getElementById('reset-pwd-profile');
    const msgEl = document.getElementById('profile-msg');

    closeBtn.onclick = () => container.classList.add('hidden');

    resetBtn.onclick = async () => {
        try {
            await sendPasswordResetEmail(auth, user.email);
            msgEl.textContent = "Email de réinitialisation envoyé !";
            msgEl.style.display = 'block';
        } catch (e) {
            msgEl.textContent = "Erreur : " + e.message;
            msgEl.style.color = "#f87171";
            msgEl.style.display = 'block';
        }
    };

    saveBtn.onclick = async () => {
        const pseudo = document.getElementById('profile-pseudo').value;
        const bio = document.getElementById('profile-bio').value;
        saveBtn.disabled = true;
        saveBtn.textContent = "Enregistrement...";

        try {
            // Update Auth profile
            await updateProfile(user, { displayName: pseudo });
            
            // Update Firestore document
            await setDoc(doc(db, "users", user.uid), {
                pseudo,
                bio,
                updatedAt: Date.now()
            }, { merge: true });

            msgEl.textContent = "Profil mis à jour !";
            msgEl.style.display = 'block';
            setTimeout(() => msgEl.style.display = 'none', 3000);
        } catch (e) {
            console.error(e);
            msgEl.textContent = "Erreur lors de la sauvegarde.";
            msgEl.style.color = "#f87171";
            msgEl.style.display = 'block';
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = "Sauvegarder les modifications";
        }
    };

    logoutBtn.onclick = async () => {
        await signOut(auth);
        container.classList.add('hidden');
    };

    deleteBtn.onclick = async () => {
        if (!confirm("Supprimer votre compte définitivement ?")) return;
        try {
            await deleteUser(user);
            container.classList.add('hidden');
        } catch (e) {
            msgEl.textContent = "Action récente requise. Reconnectez-vous.";
            msgEl.style.color = "#f87171";
            msgEl.style.display = 'block';
        }
    };
}

function setupFormEvents(container, initialMode) {
    const form = document.getElementById('auth-form');
    const submitBtn = document.getElementById('auth-submit');
    const errorEl = document.getElementById('auth-error');
    const successEl = document.getElementById('auth-success');
    const closeBtn = document.getElementById('close-auth');
    const googleBtn = document.getElementById('google-login');
    const forgotLink = document.getElementById('forgot-password');
    const tabs = {
        login: document.getElementById('tab-login'),
        signup: document.getElementById('tab-signup')
    };

    let currentMode = initialMode;

    const switchTab = (mode) => {
        currentMode = mode;
        tabs.login.classList.toggle('active', mode === 'login');
        tabs.signup.classList.toggle('active', mode === 'signup');
        submitBtn.textContent = mode === 'login' ? 'Se connecter' : 'Créer un compte';
        forgotLink.style.visibility = mode === 'login' ? 'visible' : 'hidden';
        errorEl.style.display = 'none';
        successEl.style.display = 'none';
    };

    switchTab(initialMode);
    closeBtn.onclick = () => container.classList.add('hidden');
    tabs.login.onclick = () => switchTab('login');
    tabs.signup.onclick = () => switchTab('signup');

    if (forgotLink) {
        forgotLink.onclick = async (e) => {
            e.preventDefault();
            const email = document.getElementById('auth-email').value;
            if (!email) {
                errorEl.textContent = "Entrez votre email.";
                errorEl.style.display = 'block';
                return;
            }
            try {
                await sendPasswordResetEmail(auth, email);
                successEl.textContent = "Email envoyé !";
                successEl.style.display = 'block';
            } catch (e) {
                errorEl.textContent = formatError(e.code);
                errorEl.style.display = 'block';
            }
        };
    }

    googleBtn.onclick = async () => {
        try {
            await signInWithPopup(auth, googleProvider);
            container.classList.add('hidden');
        } catch (e) {
            errorEl.textContent = e.message;
            errorEl.style.display = 'block';
        }
    };

    form.onsubmit = async (e) => {
        e.preventDefault();
        const email = document.getElementById('auth-email').value;
        const password = document.getElementById('auth-password').value;
        submitBtn.disabled = true;

        try {
            if (currentMode === 'login') {
                await signInWithEmailAndPassword(auth, email, password);
            } else {
                await createUserWithEmailAndPassword(auth, email, password);
            }
            container.classList.add('hidden');
        } catch (e) {
            errorEl.textContent = formatError(e.code);
            errorEl.style.display = 'block';
        } finally {
            submitBtn.disabled = false;
        }
    };
}

function formatError(code) {
    switch (code) {
        case 'auth/user-not-found': return 'Utilisateur non trouvé.';
        case 'auth/wrong-password': return 'Mot de passe incorrect.';
        case 'auth/email-already-in-use': return 'Cet email est déjà utilisé.';
        case 'auth/weak-password': return 'Le mot de passe est trop court.';
        case 'auth/invalid-email': return 'Email non valide.';
        default: return 'Une erreur est survenue.';
    }
}
