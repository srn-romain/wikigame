/**
 * daily.js
 * Gestion du défi quotidien.
 *
 * Collections Firestore utilisées :
 *   - dailies/{dateId}  → article du jour + compteur de résolveurs
 *   - users/{uid}       → champs lastDailyDate + dailyFoundToday + dailySolvedTotal
 */
import {
    db, doc, getDoc, setDoc, updateDoc,
    waitForAuth, increment, runTransaction, serverTimestamp, arrayUnion
} from './firebase-app.js';
import { fetchRandomArticle } from './wiki.js';

// ─────────────────────────────────────────────
// Helpers date
// ─────────────────────────────────────────────

/** Retourne la date UTC "YYYY-MM-DD" correspondant au dernier reset (12h00 UTC). */
function getTodayDateId() {
    const now   = new Date();
    const reset = new Date();
    reset.setUTCHours(12, 0, 0, 0);
    if (now < reset) reset.setUTCDate(reset.getUTCDate() - 1);
    return reset.toISOString().split('T')[0]; // ex. "2024-05-09"
}

// ─────────────────────────────────────────────
// Article du jour
// ─────────────────────────────────────────────

/**
 * Récupère l'ID de l'article du jour (collection dailies/{dateId}).
 * Si le document n'existe pas encore, crée-le via une transaction.
 */
export async function getDailyArticleId() {
    const dateId   = getTodayDateId();
    const dailyRef = doc(db, "dailies", dateId);

    try {
        const snap = await getDoc(dailyRef);
        if (snap.exists()) return snap.data().articleId;

        // Premier accès de la journée : rotation
        return await rotateDailyArticle(dateId);
    } catch (e) {
        console.error("Daily: getDailyArticleId error:", e);
        return null;
    }
}

async function rotateDailyArticle(dateId) {
    const article = await fetchRandomArticle();
    if (!article) return null;

    try {
        return await runTransaction(db, async (tx) => {
            const dailyRef = doc(db, "dailies", dateId);
            const snap     = await tx.get(dailyRef);

            // Quelqu'un d'autre a déjà créé le doc en parallèle → utiliser le sien
            if (snap.exists()) return snap.data().articleId;

            tx.set(dailyRef, {
                articleId:    article.id,
                title:        article.title,
                dateId:       dateId,
                createdAt:    serverTimestamp(),
                solversCount: 0
            });

            return article.id;
        });
    } catch (e) {
        console.error("Daily: Rotation transaction failed:", e);
        return article.id; // fallback
    }
}

// ─────────────────────────────────────────────
// Statut résolu (utilisateur)
// ─────────────────────────────────────────────

/**
 * Vérifie si l'utilisateur a déjà résolu le défi du jour.
 * Utilise les champs lastDailyDate / dailyFoundToday dans users/{uid}.
 */
export async function checkDailySolved(user) {
    if (!user || user.isAnonymous) return false;

    try {
        const userRef = doc(db, "users", user.uid);
        const snap    = await getDoc(userRef);
        if (!snap.exists()) return false;

        const data       = snap.data();
        const dateId     = getTodayDateId();
        const lastDate   = data.lastDailyDate || null;
        const foundToday = data.dailyFoundToday || false;

        return lastDate === dateId && foundToday;
    } catch (e) {
        console.error("Daily: checkDailySolved error:", e);
        return false;
    }
}

/**
 * Marque le défi du jour comme résolu pour l'utilisateur.
 * Met à jour : users/{uid}.lastDailyDate, .dailyFoundToday, .dailySolvedTotal
 * Et incrémente dailies/{dateId}.solversCount.
 */
export async function markDailyAsSolved(user, articleTitle) {
    if (!user || user.isAnonymous) return;

    const dateId = getTodayDateId();

    try {
        // Éviter double-comptage si déjà marqué
        const alreadySolved = await checkDailySolved(user);
        if (alreadySolved) return;

        // Mettre à jour le document user
        const userRef = doc(db, "users", user.uid);
        await updateDoc(userRef, {
            lastDailyDate:    dateId,
            dailyFoundToday:  true,
            dailyHistory: arrayUnion({
                dateId,
                title: articleTitle || "Article inconnu",
                solvedAt: Date.now()
            })
        });

        // Incrémenter le compteur global du défi
        const dailyRef = doc(db, "dailies", dateId);
        await updateDoc(dailyRef, { solversCount: increment(1) });
    } catch (e) {
        console.error("Daily: markDailyAsSolved error:", e);
    }
}

// ─────────────────────────────────────────────
// Compteurs
// ─────────────────────────────────────────────

export async function getDailySolversCount() {
    const dateId = getTodayDateId();
    try {
        const snap = await getDoc(doc(db, "dailies", dateId));
        return snap.exists() ? (snap.data().solversCount || 0) : 0;
    } catch (e) {
        console.error("Daily: getDailySolversCount error:", e);
        return 0;
    }
}

// ─────────────────────────────────────────────
// Countdown
// ─────────────────────────────────────────────

export function getNextResetTime() {
    const now      = new Date();
    const nextNoon = new Date();
    nextNoon.setUTCHours(12, 0, 0, 0);
    if (now >= nextNoon) nextNoon.setUTCDate(nextNoon.getUTCDate() + 1);
    return nextNoon;
}

export function getCountdown() {
    const diff = getNextResetTime() - new Date();
    if (diff <= 0) return "00:00:00";

    const h = Math.floor(diff / 3_600_000).toString().padStart(2, '0');
    const m = Math.floor((diff % 3_600_000) / 60_000).toString().padStart(2, '0');
    const s = Math.floor((diff % 60_000) / 1000).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
}
