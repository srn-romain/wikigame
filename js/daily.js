import { db, doc, getDoc, setDoc, waitForAuth, increment, runTransaction } from './firebase-app.js';
import { fetchRandomArticle } from './wiki.js';

/**
 * Gets the daily challenge article ID.
 * Rotates every day at 12:00 (Noon).
 */
export async function getDailyArticleId() {
    const now = new Date();
    const resetDate = new Date();
    resetDate.setUTCHours(12, 0, 0, 0);
    if (now < resetDate) {
        resetDate.setUTCDate(resetDate.getUTCDate() - 1);
    }
    
    const dateId = resetDate.toISOString().split('T')[0]; // e.g. "2024-05-09"
    const dailyRef = doc(db, "dailies", dateId);

    try {
        const snap = await getDoc(dailyRef);
        
        if (snap.exists()) {
            return snap.data().articleId;
        } else {
            // No challenge found for this specific date, trigger rotation
            return await rotateDailyArticle(resetDate.getTime(), dateId);
        }
    } catch (e) {
        console.error("Daily: Error fetching article ID:", e);
        return null;
    }
}

async function rotateDailyArticle(timestamp, dateId) {
    console.log(`Daily: Attempting rotation for ${dateId}...`);
    const article = await fetchRandomArticle();
    if (!article) return null;

    try {
        const articleId = await runTransaction(db, async (transaction) => {
            const dailyRef = doc(db, "dailies", dateId);
            const snap = await transaction.get(dailyRef);

            if (snap.exists()) {
                return snap.data().articleId;
            }

            // Apply new article to the specific date document
            transaction.set(dailyRef, {
                articleId: article.id,
                title: article.title,
                timestamp: timestamp,
                solversCount: 0
            });

            // Also update global pointer for convenience
            const globalRef = doc(db, "globals", "dailyChallenge");
            transaction.set(globalRef, {
                currentDateId: dateId,
                articleId: article.id,
                timestamp: timestamp
            }, { merge: true });

            console.log(`Daily: Rotation successful for ${dateId}:`, article.title);
            return article.id;
        });
        return articleId;
    } catch (e) {
        console.error("Daily: Rotation transaction failed:", e);
        return article.id;
    }
}

/**
 * Checks if the current user has already solved the daily challenge.
 * Returns the date string (e.g. "2024-05-09") if solved.
 */
export async function checkDailySolved(user, articleId) {
    if (!user || user.isAnonymous) return false;

    const solvedRef = doc(db, "users", user.uid, "dailySolved", articleId);
    try {
        const snap = await getDoc(solvedRef);
        return snap.exists();
    } catch (e) {
        console.error("Daily: Error checking solved status:", e);
        return false;
    }
}

/**
 * Mark the daily challenge as solved for the current user.
 */
export async function markDailyAsSolved(user, articleId) {
    if (!user || user.isAnonymous) return;

    try {
        const solvedRef = doc(db, "users", user.uid, "dailySolved", articleId);
        const snap = await getDoc(solvedRef);
        if (snap.exists()) return;

        await setDoc(solvedRef, {
            solvedAt: Date.now(),
            articleId: articleId
        });

        // Increment solver count in the specific daily document
        const now = new Date();
        const resetDate = new Date();
        resetDate.setUTCHours(12, 0, 0, 0);
        if (now < resetDate) resetDate.setUTCDate(resetDate.getUTCDate() - 1);
        const dateId = resetDate.toISOString().split('T')[0];

        const dailyRef = doc(db, "dailies", dateId);
        await setDoc(dailyRef, { solversCount: increment(1) }, { merge: true });
    } catch (e) {
        console.error("Daily: Error marking as solved:", e);
    }
}

/**
 * Gets the number of people who solved the current challenge.
 */
export async function getDailySolversCount() {
    const now = new Date();
    const resetDate = new Date();
    resetDate.setUTCHours(12, 0, 0, 0);
    if (now < resetDate) resetDate.setUTCDate(resetDate.getUTCDate() - 1);
    const dateId = resetDate.toISOString().split('T')[0];

    try {
        const dailyRef = doc(db, "dailies", dateId);
        const snap = await getDoc(dailyRef);
        return snap.exists() ? (snap.data().solversCount || 0) : 0;
    } catch (e) {
        console.error("Daily: Error fetching solvers count:", e);
        return 0;
    }
}

/**
 * Calculates the next 12:00 PM (Noon) reset time.
 */
export function getNextResetTime() {
    const now = new Date();
    const nextNoon = new Date();
    nextNoon.setUTCHours(12, 0, 0, 0);
    
    if (now >= nextNoon) {
        nextNoon.setUTCDate(nextNoon.getUTCDate() + 1);
    }
    return nextNoon;
}

/**
 * Returns a formatted string HH:MM:SS until the next reset.
 */
export function getCountdown() {
    const now = new Date();
    const nextReset = getNextResetTime();
    const diff = nextReset - now;

    if (diff <= 0) return "00:00:00";

    const hours = Math.floor(diff / (1000 * 60 * 60)).toString().padStart(2, '0');
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)).toString().padStart(2, '0');
    const seconds = Math.floor((diff % (1000 * 60)) / 1000).toString().padStart(2, '0');

    return `${hours}:${minutes}:${seconds}`;
}
