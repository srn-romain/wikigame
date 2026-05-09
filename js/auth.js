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
            pseudo:           user.displayName || "",
            bio:              "",
            lastDailyDate:    null,
            dailyFoundToday:  false,
            dailyHistory:     []
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
        <div class="auth-modal profile-container" id="profile-modal-root" style="width:95%; max-width: 450px; padding:0; display:flex; flex-wrap:nowrap; overflow-x:hidden; overflow-y:auto; max-height:90vh; transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1); position:relative;">
            
            <!-- PANNEAU PRINCIPAL -->
            <div id="profile-main-view" style="width: 100%; min-width: 320px; max-width:450px; padding: 2rem; flex: 0 0 100%;">
                <button class="close-modal" id="close-auth">&times;</button>
                
                <div style="text-align:center; margin-bottom: 1.5rem;">
                    <div class="avatar-placeholder" style="width:70px; height:70px; font-size:1.8rem; margin: 0 auto 0.75rem;">
                        ${user.photoURL ? `<img src="${user.photoURL}" class="avatar-img" style="width:70px; height:70px;">` : `<i class="fa-solid fa-user-astronaut"></i>`}
                    </div>
                    <h2 style="margin-bottom:0.25rem;">Mon Profil</h2>
                    <p style="color:var(--text-muted); font-size:0.8rem;">${user.email}</p>
                </div>

                <div class="stats-row" style="display:grid; grid-template-columns: 1fr; gap: 10px; margin-bottom: 1.5rem;">
                                    <div class="glass" id="view-daily-history" style="padding: 12px; text-align:center; border-radius:12px; cursor:pointer; transition:all 0.2s; border:1px solid rgba(0,0,0,0.05);" onmouseover="this.style.transform='translateY(-2px)'; this.style.borderColor='var(--accent)';" onmouseout="this.style.transform='none'; this.style.borderColor='rgba(0,0,0,0.05)';">
                        <div style="font-size:1.2rem; font-weight:800; color:var(--accent);">${(userData.dailyHistory || []).length}</div>
                        <div style="font-size:0.65rem; color:var(--text-muted); text-transform:uppercase; font-weight:700;">Défis Résolus <i class="fa-solid fa-chevron-right" style="margin-left:4px; font-size:0.6rem;"></i></div>
                    </div>
                    <div class="glass" style="flex:1; padding:1.2rem; text-align:center; border: 1px solid #e5e7eb;">
                        <div style="font-size:1.2rem; font-weight:800; color:var(--primary);">${userData.xp || 0}</div>
                        <div style="font-size:0.65rem; color:var(--text-muted); text-transform:uppercase; font-weight:700;">Points XP</div>
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
                        <textarea id="profile-bio" maxlength="100" style="background:#f9fafb; border:1px solid #e5e7eb; padding:0.8rem; border-radius:var(--radius-md); color:var(--text-main); font-family:var(--font-ui); resize:none; height:60px; outline:none;">${userData.bio || ''}</textarea>
                    </div>

                    <div style="display:flex; align-items:center; gap:10px; margin: 10px 0; background: #f0f7ff; padding: 10px; border-radius: 8px;">
                        <input type="checkbox" id="profile-public" ${userData.isPublic !== false ? 'checked' : ''} style="width:18px; height:18px; cursor:pointer;">
                        <label for="profile-public" style="font-size:0.85rem; color:#1e40af; cursor:pointer; font-weight:600;">
                            Apparaître publiquement dans le classement
                        </label>
                    </div>
                    
                    <div style="display:flex; flex-direction:column; gap:8px; margin-top: 0.5rem;">
                        <button id="save-profile" class="btn-primary" style="justify-content:center; width:100%;">
                            <i class="fa-solid fa-floppy-disk"></i> Sauvegarder les modifications
                        </button>
                    </div>

                    <div class="divider" style="margin: 1.5rem 0 0.75rem;">Actions</div>
                    <div style="display:flex; flex-direction:column; gap:8px;">
                        <button id="reset-pwd-profile" class="btn-accent" style="justify-content:center; width:100%;">
                            <i class="fa-solid fa-key"></i> Réinitialiser le mot de passe
                        </button>
                        <button id="logout-btn" class="btn-accent" style="width:100%; background:#4b5563; color:white; justify-content:center; box-shadow: 0 4px 12px rgba(75, 85, 99, 0.2); border:none;">
                            <i class="fa-solid fa-right-from-bracket"></i> Déconnexion
                        </button>
                    </div>
                </div>

                <div class="divider" style="margin: 1.5rem 0 0.75rem; color: var(--danger);">Zone de danger</div>
                
                <div style="display:flex; flex-direction:column; gap:8px; padding-bottom: 2rem;">
                    <button id="delete-account-btn" class="btn-accent" style="width:100%; background:var(--danger); justify-content:center; box-shadow: 0 4px 12px rgba(231, 76, 60, 0.2);">
                        <i class="fa-solid fa-trash-can"></i> Supprimer le compte
                    </button>
                </div>
            </div>

            <!-- PANNEAU HISTORIQUE (DROITE) -->
            <div id="profile-history-view" style="width: 100%; min-width: 320px; max-width:350px; flex: 0 0 100%; border-left: 1px solid #eee; background: #f9fafb; display: flex; flex-direction: column;">
                <div style="padding:1.5rem; border-bottom:1px solid #eee; display:flex; align-items:center; gap: 15px; background: white;">
                    <button id="back-to-profile" style="background:var(--primary); color:white; border:none; width:32px; height:32px; border-radius:50%; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:transform 0.2s;">
                        <i class="fa-solid fa-arrow-left"></i>
                    </button>
                    <h3 style="margin:0; font-size:1.1rem;"><i class="fa-solid fa-history" style="color:var(--accent); margin-right:8px;"></i> Historique</h3>
                </div>
                <div id="history-list-content" style="flex:1; overflow-y:auto; padding:0;">
                    <!-- Injecté via JS -->
                </div>
                <div id="history-footer" style="padding:1rem; text-align:center; border-top:1px solid #eee; background: white;">
                    <!-- Injecté via JS -->
                </div>
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

    const root = document.getElementById('profile-modal-root');
    const historyBtn = document.getElementById('view-daily-history');
    const backBtn = document.getElementById('back-to-profile');

    if (historyBtn) {
        historyBtn.onclick = () => {
            _renderHistoryList(userData.dailyHistory || []);
            root.style.maxWidth = '800px';
            // Sur mobile, on fait défiler vers le panneau d'historique
            setTimeout(() => {
                root.scrollTo({ left: root.scrollWidth, behavior: 'smooth' });
            }, 50);
        };
    }

    if (backBtn) {
        backBtn.onclick = () => {
            root.scrollTo({ left: 0, behavior: 'smooth' });
            setTimeout(() => {
                root.style.maxWidth = '450px';
            }, 300);
        };
    }

    resetBtn.onclick = async () => {
        try {
            await sendPasswordResetEmail(auth, user.email);
            msgEl.textContent = "Email de réinitialisation envoyé !";
            msgEl.style.display = 'block';
            msgEl.style.color = "var(--primary)";
        } catch (e) {
            msgEl.textContent = "Erreur : " + e.message;
            msgEl.style.color = "var(--danger)";
            msgEl.style.display = 'block';
        }
    };

    saveBtn.onclick = async () => {
        const pseudo = document.getElementById('profile-pseudo').value;
        const bio = document.getElementById('profile-bio').value;
        const isPublic = document.getElementById('profile-public').checked;
        saveBtn.disabled = true;
        saveBtn.textContent = "Enregistrement...";

        try {
            await updateProfile(user, { displayName: pseudo });
            await setDoc(doc(db, "users", user.uid), { pseudo, bio, isPublic, updatedAt: Date.now() }, { merge: true });
            msgEl.textContent = "Profil mis à jour !";
            msgEl.style.display = 'block';
            msgEl.style.color = "var(--primary)";
            setTimeout(() => msgEl.style.display = 'none', 3000);
        } catch (e) {
            msgEl.textContent = "Erreur lors de la sauvegarde.";
            msgEl.style.color = "var(--danger)";
            msgEl.style.display = 'block';
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = "Sauvegarder les modifications";
        }
    };

    logoutBtn.onclick = async () => {
        await signOut(auth);
        // Redirection vers l'accueil (nettoyage URL) et rechargement
        window.location.href = window.location.origin + window.location.pathname;
    };

    deleteBtn.onclick = () => {
        showConfirmModal(
            "Supprimer le compte ?", 
            "Toutes vos statistiques et votre progression seront définitivement supprimées.",
            "Continuer",
            () => {
                showConfirmModal(
                    "Dernière confirmation",
                    "Cette action est irréversible. Êtes-vous certain de vouloir tout effacer ?",
                    "Supprimer définitivement",
                    async () => {
                        try {
                            await deleteUser(user);
                            window.location.reload();
                        } catch (e) {
                            msgEl.textContent = "Action récente requise. Reconnectez-vous.";
                            msgEl.style.color = "var(--danger)";
                            msgEl.style.display = 'block';
                        }
                    }
                );
            }
        );
    };
}

export function showConfirmModal(title, text, confirmBtnText = "Confirmer") {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.zIndex = "2000";
        overlay.innerHTML = `
            <div class="auth-modal glass" style="max-width: 400px; text-align: center; padding: 2.5rem; background: white;">
                <i class="fa-solid fa-circle-exclamation" style="font-size: 3.5rem; color: var(--danger); margin-bottom: 1.5rem;"></i>
                <h2 style="margin-bottom: 1rem; color: var(--text-main)!important;">${title}</h2>
                <p style="margin-bottom: 2rem; color: var(--text-muted)!important; line-height: 1.5; font-size: 0.95rem;">${text}</p>
                <div style="display: flex; gap: 12px; width: 100%;">
                    <button class="btn-primary" style="flex:1; background: #f3f4f6; color: var(--text-main); border: 1px solid #ddd; justify-content:center;" id="cancel-confirm">Annuler</button>
                    <button class="btn-primary" style="flex:1; background: var(--danger); color:white; border:none; justify-content:center;" id="exec-confirm">${confirmBtnText}</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        
        overlay.querySelector('#cancel-confirm').onclick = () => { overlay.remove(); resolve(false); };
        overlay.querySelector('#exec-confirm').onclick = () => { overlay.remove(); resolve(true); };
        overlay.onclick = (e) => { if (e.target === overlay) { overlay.remove(); resolve(false); } };
    });
}

/**
 * Affiche une modale d'information stylisée (remplace alert)
 */
export function showInfoModal(title, text, type = 'info') {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.zIndex = "2000";
    
    let icon = 'fa-circle-info';
    let color = 'var(--accent)';
    if (type === 'error') { icon = 'fa-circle-exclamation'; color = 'var(--danger)'; }
    if (type === 'success') { icon = 'fa-circle-check'; color = 'var(--primary)'; }

    overlay.innerHTML = `
        <div class="auth-modal" style="max-width: 400px; text-align: center; padding: 2.5rem;">
            <i class="fa-solid ${icon}" style="font-size: 3.5rem; color: ${color}; margin-bottom: 1.5rem;"></i>
            <h2 style="margin-bottom: 1rem; color: var(--text-main)!important;">${title}</h2>
            <p style="margin-bottom: 2rem; color: var(--text-muted)!important; line-height: 1.5; font-size: 0.95rem;">${text}</p>
            <button class="btn-primary" style="width: 100%; justify-content: center; padding: 0.8rem;" id="info-ok">Compris</button>
        </div>
    `;
    document.body.appendChild(overlay);
    
    // Fermer au clic sur le bouton ou sur l'overlay
    overlay.querySelector('#info-ok').onclick = () => overlay.remove();
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
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
            window.location.reload();
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
            window.location.reload();
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

function _renderHistoryList(history) {
    const listContainer = document.getElementById('history-list-content');
    const footerContainer = document.getElementById('history-footer');
    if (!listContainer || !footerContainer) return;

    // Trier par date décroissante
    const sorted = [...history].sort((a, b) => b.solvedAt - a.solvedAt);

    let listHtml = "";
    if (sorted.length === 0) {
        listHtml = `
            <div style="text-align:center; color:var(--text-muted); padding:3rem 2rem;">
                <i class="fa-solid fa-ghost" style="font-size:3rem; opacity:0.1; margin-bottom:1rem;"></i>
                <p style="font-size:0.9rem;">Aucun historique disponible pour le moment.</p>
                <p style="font-size:0.75rem; margin-top:0.5rem; opacity:0.7;">(Seuls les défis résolus à partir d'aujourd'hui sont enregistrés)</p>
            </div>`;
    } else {
        listHtml = sorted.map(item => {
            const dateStr = new Date(item.solvedAt).toLocaleDateString('fr-FR', {
                day: '2-digit', month: 'long', year: 'numeric'
            });
            return `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:15px 20px; border-bottom:1px solid #f3f4f6; gap:15px; background:white; transition:background 0.2s;" onmouseover="this.style.background='#fcfcfc';" onmouseout="this.style.background='white';">
                    <div style="flex:1;">
                        <div style="font-size:0.85rem; font-weight:700; color:var(--text-main); line-height:1.3;">${item.title}</div>
                        <div style="font-size:0.7rem; color:var(--text-muted); margin-top:2px;">${dateStr}</div>
                    </div>
                    <div style="color:#10b981; font-size:1.1rem;"><i class="fa-solid fa-check-circle"></i></div>
                </div>
            `;
        }).join('');
    }

    listContainer.innerHTML = listHtml;
    footerContainer.innerHTML = `
        <p style="font-size:0.8rem; color:var(--text-muted); font-weight:600; margin:0;">
            ${sorted.length} défi${sorted.length > 1 ? 's' : ''} relevé${sorted.length > 1 ? 's' : ''} au total
        </p>
    `;
}
