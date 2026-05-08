import { db, doc, getDoc, setDoc, waitForAuth, increment } from './firebase-app.js';
import { fetchRandomArticle } from './wiki.js';

/**
 * Gets the daily challenge article ID.
 * Rotates every day at 12:00 (Noon).
 */
export async function getDailyArticleId() {
    const now = new Date();
    const dailyRef = doc(db, "globals", "dailyChallenge");
    
    // Calculate the most recent 12:00 PM (Noon)
    const lastNoon = new Date();
    lastNoon.setHours(12, 0, 0, 0);
    if (now < lastNoon) {
        // If it's before Noon today, the reset was Noon yesterday
        lastNoon.setDate(lastNoon.getDate() - 1);
    }

    try {
        const snap = await getDoc(dailyRef);
        
        if (snap.exists()) {
            const data = snap.data();
            const lastUpdate = new Date(data.timestamp);
            
            // If the stored article was generated before the most recent Noon, rotate it
            if (lastUpdate < lastNoon) {
                return await rotateDailyArticle(lastNoon.getTime());
            }
            
            return data.articleId;
        } else {
            // First time setup
            return await rotateDailyArticle(lastNoon.getTime());
        }
    } catch (e) {
        console.error("Daily: Error fetching article ID:", e);
        return null;
    }
}

async function rotateDailyArticle(timestamp) {
    console.log("Daily: Rotating article...");
    const article = await fetchRandomArticle();
    if (!article) return null;

    try {
        await setDoc(doc(db, "globals", "dailyChallenge"), {
            articleId: article.id,
            title: article.title,
            timestamp: timestamp // Use the exact Noon timestamp for consistency
        });
        return article.id;
    } catch (e) {
        console.error("Daily: Error rotating article:", e);
        return article.id; // Return anyway so user can play, even if sync failed
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

    const solvedRef = doc(db, "users", user.uid, "dailySolved", articleId);
    try {
        // Check if already solved to avoid double increment
        const snap = await getDoc(solvedRef);
        if (snap.exists()) return;

        await setDoc(solvedRef, {
            solvedAt: Date.now(),
            articleId: articleId
        });

        // Increment global solver count
        const dailyRef = doc(db, "globals", "dailyChallenge");
        await setDoc(dailyRef, { solversCount: increment(1) }, { merge: true });
    } catch (e) {
        console.error("Daily: Error marking as solved:", e);
    }
}

/**
 * Gets the number of people who solved the current challenge.
 */
export async function getDailySolversCount() {
    try {
        const dailyRef = doc(db, "globals", "dailyChallenge");
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
    nextNoon.setHours(12, 0, 0, 0);
    
    // If it's already past Noon today, the next reset is Noon tomorrow
    if (now >= nextNoon) {
        nextNoon.setDate(nextNoon.getDate() + 1);
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
