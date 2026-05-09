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
    const params = new URLSearchParams({
        action: 'query',
        format: 'json',
        prop: 'extracts',
        exintro: '0',
        explaintext: '1',
        generator: 'random',
        grnnamespace: '0',
        grnlimit: '1',
        origin: '*'
    });

    updateLoadingStatus(FRIENDLY_MESSAGES[messageIndex % FRIENDLY_MESSAGES.length]);
    messageIndex++;


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

        // Minimum 500 caractères
        if (totalCharCount < 500) {
            updateLoadingStatus("Sujet trop court, on en cherche un autre...");
            await sleep(500);
            return fetchRandomArticle();
        }



        return {
            id: String(pageId),
            title: page.title,
            paragraphs,
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
        prop: 'extracts',
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

        return {
            id: String(pageId),
            title: page.title,
            paragraphs,
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
