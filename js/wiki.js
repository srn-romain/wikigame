/**
 * Wiki API Interaction Module
 * Single API call: generator=random + prop=extracts to avoid rate limiting (429).
 */

const API_BASE = 'https://fr.wikipedia.org/w/api.php';

function updateLoadingStatus(msg) {
    const el = document.getElementById('loading-status-text');
    if (el) {
        el.textContent = msg;
    }
}

const FRIENDLY_MESSAGES = [
    "Ouverture de l'encyclopédie...",
    "Recherche d'un sujet intéressant...",
    "Lecture des premières lignes...",
    "Vérification de la longueur...",
    "Sujet trop court, on cherche encore...",
    "Exploration des archives...",
    "Presque prêt...",
    "Finalisation du texte..."
];
let messageIndex = 0;


/**
 * Fetch a random Wikipedia article with its extract in ONE request.
 */
export async function fetchRandomArticle() {
    updateLoadingStatus(FRIENDLY_MESSAGES[messageIndex % FRIENDLY_MESSAGES.length]);
    messageIndex++;

    if (!window._topArticlesCache) {
        try {
            updateLoadingStatus("Recherche des sujets les plus populaires...");
            const d = new Date();
            d.setDate(d.getDate() - 2); // 2 jours pour éviter les problèmes de fuseau horaire
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            
            const res = await fetch(`https://wikimedia.org/api/rest_v1/metrics/pageviews/top/fr.wikipedia.org/all-access/${year}/${month}/${day}`);
            if (res.ok) {
                const data = await res.json();
                if (data && data.items && data.items[0] && data.items[0].articles) {
                    window._topArticlesCache = data.items[0].articles
                        .map(a => a.article)
                        .filter(title => {
                            const t = title.toLowerCase();
                            return !t.startsWith('spécial:') && 
                                   !t.startsWith('wikipédia:') && 
                                   !t.startsWith('fichier:') && 
                                   !t.startsWith('aide:') && 
                                   !t.startsWith('portail:') && 
                                   !t.startsWith('modèle:') &&
                                   !t.startsWith('utilisateur:') &&
                                   !t.startsWith('discussion') &&
                                   t !== 'accueil' &&
                                   t !== 'cleopatre' &&
                                   !t.includes('liste_des_');
                        })
                        .slice(0, 500); // Limiter aux 500 articles les plus consultés
                }
            }
        } catch(e) {
            console.error("WikiAPI: Failed to fetch top articles", e);
        }
    }

    const params = new URLSearchParams({
        action: 'query',
        format: 'json',
        prop: 'extracts|categories',
        clshow: '!hidden',
        cllimit: 'max',
        exintro: '0',
        explaintext: '1',
        origin: '*'
    });

    if (window._topArticlesCache && window._topArticlesCache.length > 0) {
        // Prendre un article parmi les 500 plus populaires
        const rIndex = Math.floor(Math.random() * window._topArticlesCache.length);
        const randomTitle = window._topArticlesCache[rIndex];
        window._topArticlesCache.splice(rIndex, 1); // Eviter les doublons
        
        params.append('titles', randomTitle);
        console.log("WikiAPI: Fetching popular article:", randomTitle);
    } else {
        params.append('generator', 'random');
        params.append('grnnamespace', '0');
        params.append('grnlimit', '1');
    }

    try {
        const response = await fetch(`${API_BASE}?${params.toString()}`);

        if (response.status === 429) {
            updateLoadingStatus("Trop de requêtes, on patiente un peu...");
            await sleep(3000);
            return fetchRandomArticle();
        }

        if (!response.ok) {
            updateLoadingStatus("Petit souci de connexion, on réessaie...");
            await sleep(2000);
            return fetchRandomArticle();
        }


        const data = await response.json();
        const pages = data?.query?.pages;

        if (!pages) {
            console.warn("WikiAPI: No pages in response. Retrying...");
            await sleep(1000);
            return fetchRandomArticle();
        }

        const pageId = Object.keys(pages)[0];
        const page = pages[pageId];

        if (!page || pageId === '-1' || !page.extract) {
            updateLoadingStatus("Sujet vide, on en cherche un autre...");
            await sleep(1000);
            return fetchRandomArticle();
        }

        updateLoadingStatus("Sujet trouvé ! Analyse en cours...");


        console.log("WikiAPI: Found article:", page.title);

        // Process plain text into paragraphs
        const paragraphs = processPlainText(page.extract, 6); // On prend jusqu'à 8 paragraphes pour atteindre la longueur

        const totalCharCount = paragraphs.join('\n\n').length;
        console.log(`WikiAPI: Extracted ${paragraphs.length} paragraphs (Total: ${totalCharCount} chars).`);

        // MINNIMUM DE CARACTERE SUR LA PAGE POUR ÊTRE ACCEPTÉE
        if (totalCharCount < 250) {
            updateLoadingStatus("Sujet trop court, on en cherche un autre...");
            await sleep(500);
            return fetchRandomArticle();
        }



        const categories = (page.categories || [])
            .map(c => c.title.replace(/^Catégorie:/, ''))
            .filter(c => !c.toLowerCase().includes('wikipédia') && !c.toLowerCase().includes('article') && !c.toLowerCase().includes('portail') && !c.toLowerCase().includes('homonymie'));

        return {
            id: String(pageId),
            title: page.title,
            paragraphs,
            categories,
            url: `https://fr.wikipedia.org/?curid=${pageId}`
        };

    } catch (error) {
        console.error('WikiAPI: Fetch error:', error);
        await sleep(2000);
        return fetchRandomArticle();
    }
}

/**
 * Fetch a specific article by page ID.
 */
export async function fetchArticleById(pageId) {
    const params = new URLSearchParams({
        action: 'query',
        format: 'json',
        prop: 'extracts|categories',
        clshow: '!hidden',
        cllimit: 'max',
        exintro: '0',
        explaintext: '1',
        pageids: pageId,
        origin: '*'
    });

    try {
        const response = await fetch(`${API_BASE}?${params.toString()}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        const page = data?.query?.pages?.[pageId];

        if (!page || !page.extract) throw new Error('Page content missing');

        const paragraphs = processPlainText(page.extract, 8);

        const categories = (page.categories || [])
            .map(c => c.title.replace(/^Catégorie:/, ''))
            .filter(c => !c.toLowerCase().includes('wikipédia') && !c.toLowerCase().includes('article') && !c.toLowerCase().includes('portail') && !c.toLowerCase().includes('homonymie'));

        return {
            id: String(pageId),
            title: page.title,
            paragraphs,
            categories,
            url: `https://fr.wikipedia.org/?curid=${pageId}`
        };
    } catch (error) {
        console.error('WikiAPI Error (ByID):', error);
        return null;
    }
}

/**
 * Split plain text into paragraphs and filter them.
 */
function processPlainText(text, maxP) {
    if (!text) return [];

    // 1. Remove references [1], [citation needed]
    const cleanText = text.replace(/\[\d+\]|\[citation needed\]/g, '');

    // 2. Split by newlines (Wikipedia extracts use \n for paragraphs)
    const rawParagraphs = cleanText.split(/\n+/);

    const filtered = rawParagraphs
        .map(p => p.trim())
        .filter(p => p.length > 40) // Lower threshold to 40 characters
        .filter(p => !p.startsWith('==') && !p.endsWith('==')) // Skip headers
        .filter(p => !p.includes('may refer to:') && !p.includes('peut désigner :'));

    console.log(`WikiAPI: Filtered down to ${filtered.length} usable segments.`);

    // Fallback: If we only have ONE very long paragraph, split it into two
    if (filtered.length === 1 && filtered[0].length > 600) {
        const sentences = filtered[0].match(/[^.!?]+[.!?]+(?:\s|$)/g) || [];
        if (sentences.length >= 4) {
            const mid = Math.ceil(sentences.length / 2);
            return [
                sentences.slice(0, mid).join('').trim(),
                sentences.slice(mid).join('').trim()
            ];
        }
    }

    return filtered.slice(0, maxP);
}



function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
