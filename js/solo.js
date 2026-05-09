import { db, doc, setDoc, getDoc, updateDoc, deleteDoc, collection, query, where, getDocs, orderBy, limit } from './firebase-app.js';
import { fetchRandomArticle } from './wiki.js';

/**
 * solo.js — Gestion des brouillons Solo
 * Collection: solo_drafts/{draftId}
 * {
 *   uid, articleId, articleTitle, guesses, attempts, foundCount, createdAt, expireAt
 * }
 */

export async function getSoloDrafts(uid) {
    const q = query(
        collection(db, "solo_drafts"),
        where("uid", "==", uid),
        orderBy("createdAt", "desc"),
        limit(10)
    );
    const snap = await getDocs(q);
    const drafts = [];
    const now = new Date();

    for (const d of snap.docs) {
        const data = d.data();
        const expireDate = data.expireAt?.toDate ? data.expireAt.toDate() : new Date(data.expireAt || 0);
        
        // Auto-cleanup des expirés
        if (expireDate < now) {
            await deleteDoc(d.ref);
        } else {
            drafts.push({ id: d.id, ...data, expireDate });
        }
    }
    return drafts.slice(0, 5); // Max 5
}

export async function createSoloDraft(uid) {
    const drafts = await getSoloDrafts(uid);
    if (drafts.length >= 5) {
        throw new Error("Vous avez déjà 5 parties en cours. Terminez-en une pour en commencer une nouvelle !");
    }

    const article = await fetchRandomArticle();
    if (!article) throw new Error("Impossible de charger un article Wikipédia.");

    const draftId = `solo_${uid}_${Date.now()}`;
    const draftRef = doc(db, "solo_drafts", draftId);

    const draftData = {
        uid,
        articleId: article.id,
        articleTitle: article.title,
        guesses: [],
        attempts: 0,
        foundCount: 0,
        createdAt: Date.now(),
        expireAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 jours
    };

    await setDoc(draftRef, draftData);
    return { draftId, article };
}

export async function deleteSoloDraft(draftId) {
    await deleteDoc(doc(db, "solo_drafts", draftId));
}

export async function saveSoloProgress(draftId, guesses, attempts, foundCount) {
    const draftRef = doc(db, "solo_drafts", draftId);
    await updateDoc(draftRef, {
        guesses: Array.from(guesses),
        attempts,
        foundCount,
        lastSavedAt: Date.now()
    });
}
