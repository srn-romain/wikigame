/**
 * Wiki API Interaction Module
 */

const API_BASE = 'https://fr.wikipedia.org/w/api.php';

/**
 * Fetch a random Wikipedia article's intro text.
 */
export async function fetchRandomArticle() {
    const params = new URLSearchParams({
        action: 'query',
        format: 'json',
        prop: 'extracts',
        exintro: '1',     // Only the intro
        explaintext: '1', // Plain text, no HTML
        generator: 'random',
        grnnamespace: '0', // Main namespace only
        origin: '*'       // CORS
    });

    try {
        const response = await fetch(`${API_BASE}?${params.toString()}`);
        const data = await response.json();
        
        const pages = data.query.pages;
        const pageId = Object.keys(pages)[0];
        const pageContent = pages[pageId];

        // Filter out very short articles or disambiguation pages if possible
        if (pageContent.extract.length < 200) {
            return fetchRandomArticle(); // Retry
        }

        return {
            id: pageId,
            title: pageContent.title,
            text: pageContent.extract,
            url: `https://fr.wikipedia.org/?curid=${pageId}`
        };
    } catch (error) {
        console.error("Wiki API Error:", error);
        return null;
    }
}

/**
 * Fetch a specific article by ID (Used for Daily Mode or Sync Multiplayer)
 */
export async function fetchArticleById(pageId) {
    const params = new URLSearchParams({
        action: 'query',
        format: 'json',
        prop: 'extracts',
        exintro: '1',
        explaintext: '1',
        pageids: pageId,
        origin: '*'
    });

    try {
        const response = await fetch(`${API_BASE}?${params.toString()}`);
        const data = await response.json();
        const page = data.query.pages[pageId];

        return {
            id: pageId,
            title: page.title,
            text: page.extract,
            url: `https://fr.wikipedia.org/?curid=${pageId}`
        };
    } catch (error) {
        console.error("Wiki API Error:", error);
        return null;
    }
}
