export const AVATARS = [
    { id: 0, tier: 0, icon: "fa-user", color: "#9ca3af", label: "Débutant" },
    { id: 1, tier: 1, icon: "fa-seedling", color: "#854d0e", label: "Wiki de Bois" },
    { id: 2, tier: 2, icon: "fa-mountain", color: "#6b7280", label: "Wiki de Pierre" },
    { id: 3, tier: 3, icon: "fa-shield-halved", color: "#b45309", label: "Wiki de Bronze" },
    { id: 4, tier: 4, icon: "fa-hammer", color: "#475569", label: "Wiki de Fer" },
    { id: 5, tier: 5, icon: "fa-medal", color: "#94a3b8", label: "Wiki d'Argent" },
    { id: 6, tier: 6, icon: "fa-crown", color: "#d97706", label: "Wiki d'Or" },
    { id: 7, tier: 7, icon: "fa-gem", color: "#cbd5e1", label: "Wiki de Platine" },
    { id: 8, tier: 8, icon: "fa-wand-magic-sparkles", color: "#0ea5e9", label: "Wiki de Diamant" },
    { id: 9, tier: 9, icon: "fa-fire-flame-curved", color: "#10b981", label: "Wiki d'Émeraude" }
];

/**
 * Calcule le palier (tier) débloqué par l'utilisateur
 * @param {Object} userData 
 * @returns {number} Le palier maximum atteint (1 à 9)
 */
export function getUserTier(userData) {
    if (!userData) return 0;
    
    // Stats de l'utilisateur
    const stats = {
        xp: userData.xp || 0,
        totalGamesPlayed: userData.totalGamesPlayed || 0,
        totalWins: userData.totalWins || (userData.dailyHistory ? userData.dailyHistory.length : 0),
        dailySolvedCount: userData.dailyHistory ? userData.dailyHistory.length : 0,
        mpGamesPlayed: userData.mpGamesPlayed || 0,
        mpWins: userData.mpWins || 0,
        totalWordsRevealed: userData.totalWordsRevealed || 0,
        maxAttemptsInOneGame: userData.maxAttemptsInOneGame || 0,
        daysPlayed: userData.daysPlayed || 1,
        streak: userData.streak || 0,
        fastWins: userData.fastWins || 0,
        ultraFastWins: userData.ultraFastWins || 0,
        godSpeedWins: userData.godSpeedWins || 0,
        efficientWins: userData.efficientWins || 0,
        oneShotWins: userData.oneShotWins || 0,
        lowErrorWins: userData.lowErrorWins || 0
    };

    // On utilise la même logique que dans main.js pour les paliers
    // Pour simplifier, on redéfinit les MISSIONS_DATA essentiels ici ou on utilise une règle simplifiée
    // Mais le plus précis est de vérifier les paliers débloqués.
    
    // Si on veut être strict comme dans main.js :
    // Un palier se débloque si le précédent a 9 missions sur 10 complétées.
    // Pour l'avatar, on va faire plus simple : palier atteint = tier de la mission la plus haute
    // OU on suit exactement la logique de main.js si possible.
    
    // Logique basée sur l'XP pour les avatars, calée sur les missions "Maître" de chaque palier
    if (stats.xp >= 5000000) return 9; // Émeraude
    if (stats.xp >= 250000)  return 8; // Diamant
    if (stats.xp >= 50000)   return 7; // Platine
    if (stats.xp >= 10000)   return 6; // Or
    if (stats.xp >= 1500)    return 5; // Argent
    if (stats.xp >= 750)     return 4; // Fer
    if (stats.xp >= 300)     return 3; // Bronze
    if (stats.xp >= 100)     return 2; // Pierre
    if (stats.xp >= 30)      return 1; // Bois
    
    return 0;
}


export function getAvatarHtml(avatarId, size = "40px", fontSize = "1.2rem") {
    const avatar = AVATARS.find(a => a.id === parseInt(avatarId)) || AVATARS[0];
    return `
        <div class="avatar-placeholder" style="width:${size}; height:${size}; background:${avatar.color}; color:white; font-size:${fontSize}; display:flex; align-items:center; justify-content:center; border-radius:50%; box-shadow:0 2px 8px rgba(0,0,0,0.2);">
            <i class="fa-solid ${avatar.icon}"></i>
        </div>
    `;
}
