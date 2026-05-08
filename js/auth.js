import { 
    auth, googleProvider, 
    signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup, signOut, updateProfile,
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
                <button class="auth-tab ${mode === 'login' ? 'active' : ''}" data-tab="login">Connexion</button>
                <button class="auth-tab ${mode === 'signup' ? 'active' : ''}" data-tab="signup">Inscription</button>
            </div>

            <div id="auth-error" class="auth-error"></div>

            <form id="auth-form" class="auth-form">
                <div class="form-group">
                    <label>Email</label>
                    <input type="email" id="auth-email" placeholder="votre@email.com" required>
                </div>
                <div class="form-group">
                    <label>Mot de passe</label>
                    <input type="password" id="auth-password" placeholder="••••••••" required>
                </div>
                <button type="submit" class="btn-primary" style="margin-top:0.5rem; justify-content:center;">
                    ${mode === 'login' ? 'Se connecter' : 'Créer un compte'}
                </button>
            </form>

            <div class="divider">ou</div>

            <button id="google-login" class="btn-google">
                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/pwa/google.svg" width="20" alt="google">
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
            
            <div class="logout-section">
                <button id="logout-btn" class="btn-primary" style="width:100%; background:rgba(248, 113, 113, 0.1); color:#f87171; border: 1px solid rgba(248, 113, 113, 0.2); justify-content:center;">
                    <i class="fa-solid fa-right-from-bracket"></i> Déconnexion
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
}

function setupFormEvents(container, currentMode) {
    const form = document.getElementById('auth-form');
    const errorEl = document.getElementById('auth-error');
    const closeBtn = document.getElementById('close-auth');
    const googleBtn = document.getElementById('google-login');
    const tabs = document.querySelectorAll('.auth-tab');

    closeBtn.onclick = () => container.classList.add('hidden');

    tabs.forEach(tab => {
        tab.onclick = () => {
            const newMode = tab.dataset.tab;
            if (newMode !== currentMode) renderAuthForm(container, newMode);
        };
    });

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
