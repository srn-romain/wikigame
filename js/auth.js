import { 
    auth, googleProvider, 
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInWithPopup,
    signOut,
    updateProfile,
    sendPasswordResetEmail,
    deleteUser,
    getCurrentUser 
} from './firebase-app.js';

/**
 * Opens the Auth Modal
 * @param {string} mode 'login' | 'signup'
 */
export function openAuthModal(mode = 'login') {
    const modalContainer = document.getElementById('modal-container');
    const user = getCurrentUser();

    // If user is already logged in (not anonymously), show a "Profile/Logout" view instead
    if (user && !user.isAnonymous) {
        renderProfileModal(modalContainer, user);
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

function renderProfileModal(container, user) {
    container.innerHTML = `
        <div class="auth-modal">
            <button class="close-modal" id="close-auth">&times;</button>
            <div style="text-align:center; margin-bottom: 2rem;">
                <div class="avatar-placeholder" style="width:80px; height:80px; font-size:2rem; margin: 0 auto 1rem;">
                    ${user.photoURL ? `<img src="${user.photoURL}" class="avatar-img" style="width:80px; height:80px;">` : `<i class="fa-solid fa-user-astronaut"></i>`}
                </div>
                <h2 style="margin-bottom:0.25rem;">${user.displayName || 'Explorateur'}</h2>
                <p style="color:var(--text-muted); font-size:0.9rem;">${user.email}</p>
            </div>

            <div id="profile-error" class="auth-error"></div>
            
            <div class="logout-section" style="display:flex; flex-direction:column; gap:10px;">
                <button id="logout-btn" class="btn-primary" style="width:100%; background:rgba(255,255,255,0.05); color:white; border: 1px solid var(--glass-border); justify-content:center;">
                    <i class="fa-solid fa-right-from-bracket"></i> Déconnexion
                </button>
                <button id="delete-account-btn" style="background:none; border:none; color:#f87171; font-size:0.8rem; cursor:pointer; padding:10px; text-decoration:underline;">
                    Supprimer mon compte
                </button>
            </div>
        </div>
    `;

    document.getElementById('close-auth').onclick = () => container.classList.add('hidden');
    
    document.getElementById('logout-btn').onclick = async () => {
        try {
            await signOut(auth);
            container.classList.add('hidden');
        } catch (e) {
            console.error("Logout error:", e);
        }
    };

    document.getElementById('delete-account-btn').onclick = async () => {
        if (!confirm("Êtes-vous sûr de vouloir supprimer votre compte définitivement ? Cette action est irréversible.")) return;
        
        try {
            await deleteUser(user);
            container.classList.add('hidden');
            alert("Compte supprimé avec succès.");
        } catch (e) {
            console.error("Delete error:", e);
            const errEl = document.getElementById('profile-error');
            errEl.textContent = e.code === 'auth/requires-recent-login' 
                ? "Pour supprimer votre compte, vous devez vous être connecté récemment. Reconnectez-vous puis réessayez."
                : "Erreur lors de la suppression.";
            errEl.style.display = 'block';
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
        // Update tabs active state
        tabs.login.classList.toggle('active', mode === 'login');
        tabs.signup.classList.toggle('active', mode === 'signup');
        
        // Update form elements
        submitBtn.textContent = mode === 'login' ? 'Se connecter' : 'Créer un compte';
        forgotLink.style.visibility = mode === 'login' ? 'visible' : 'hidden';
        
        // Reset errors
        errorEl.style.display = 'none';
        successEl.style.display = 'none';
    };

    // Initialize state
    switchTab(initialMode);

    closeBtn.onclick = () => container.classList.add('hidden');

    tabs.login.onclick = () => switchTab('login');
    tabs.signup.onclick = () => switchTab('signup');

    if (forgotLink) {
        forgotLink.onclick = async (e) => {
            e.preventDefault();
            const email = document.getElementById('auth-email').value;
            if (!email) {
                errorEl.textContent = "Entrez votre email pour réinitialiser le mot de passe.";
                errorEl.style.display = 'block';
                return;
            }
            try {
                await sendPasswordResetEmail(auth, email);
                successEl.textContent = "Email de réinitialisation envoyé !";
                successEl.style.display = 'block';
                errorEl.style.display = 'none';
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
        errorEl.style.display = 'none';
        successEl.style.display = 'none';
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
        case 'auth/weak-password': return 'Le mot de passe est trop court (min 6 caractères).';
        case 'auth/invalid-email': return 'Email non valide.';
        default: return 'Une erreur est survenue. Réessayez.';
    }
}
