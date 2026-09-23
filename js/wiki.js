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

const BLACKLISTED_CAT_KEYWORDS = [
    'wikipedia', 'article', 'portail', 'homonymie', 'ebauche',
    'naissance', 'deces', 'categorie', 'page', 'suivi', 'indexation',
    'redirection', 'admissible', 'wikidata', 'commons', 'lien',
    'infobox', 'notice', 'autorite', 'traduction', 'appel',
    'utilisation', 'utilisant', 'utilise', 'geolocalise', 'structure',
    'projet', 'auteur', 'image', 'illustration', 'fichier', 'media',
    'doc', 'pva', 'stub', 'local'
];


/**
 * Fetch a random Wikipedia article with its extract in ONE request.
 */
async function _fetchTopArticlesFromWiki() {
    if (window._topArticlesCache) return;
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
                window._topArticlesViewsCache = {};
                data.items[0].articles.forEach(a => {
                    window._topArticlesViewsCache[a.article] = a.views;
                });
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

export async function fetchTopArticlesCategories() {
    if (!window._topArticlesCache) {
        await _fetchTopArticlesFromWiki();
    }
    const articles = window._topArticlesCache || [];
    if (articles.length === 0) return [];

    const batchSize = 50;
    const pageCategoriesMap = {}; // { [pageTitle]: [cats] }
    const promises = [];
    
    for (let i = 0; i < articles.length; i += batchSize) {
        const batch = articles.slice(i, i + batchSize);
        const titlesParam = batch.join('|');
        const params = new URLSearchParams({
            action: 'query',
            format: 'json',
            prop: 'categories',
            cllimit: 'max',
            titles: titlesParam,
            origin: '*'
        });
        promises.push(
            fetch(`https://fr.wikipedia.org/w/api.php?${params.toString()}`)
                .then(res => res.json())
                .then(data => {
                    const pages = data?.query?.pages || {};
                    for (const pid of Object.keys(pages)) {
                        const page = pages[pid];
                        if (page.title && page.categories) {
                            pageCategoriesMap[page.title] = page.categories.map(c => 
                                c.title.replace(/^Catégorie:/, '')
                            );
                        }
                    }
                })
                .catch(err => console.warn("WikiAPI: batch fetch failed", err))
        );
    }
    await Promise.all(promises);

    // Définition des thématiques unifiées et larges (Premium)
    const THEMES = [
        {
            id: 'cinema',
            name: '🎬 Cinéma, Séries & Acteurs',
            keywords: ['acteur', 'actrice', 'film', 'realisateur', 'serie', 'cinema', 'television', 'oscar', 'cannes']
        },
        {
            id: 'musique',
            name: '🎵 Musique & Chanteurs',
            keywords: ['chanteur', 'chanteuse', 'musicien', 'groupe', 'album', 'chanson', 'musique', 'opera', 'rock', 'pop', 'rap', 'hymne']
        },
        {
            id: 'sport',
            name: '⚽ Sport & Athlètes',
            keywords: ['sport', 'athlete', 'football', 'tennis', 'cyclisme', 'jeux', 'olympiques', 'coupe', 'champion', 'rugby', 'basketball', 'course', 'pilote', 'club', 'match']
        },
        {
            id: 'politique',
            name: '👑 Politique & Dirigeants',
            keywords: ['politique', 'president', 'roi', 'reine', 'ministre', 'gouvernement', 'empereur', 'souverain', 'chef', 'etat', 'parti', 'maire', 'senateur', 'depute', 'diplomate']
        },
        {
            id: 'histoire',
            name: '📜 Histoire & Événements',
            keywords: ['histoire', 'guerre', 'bataille', 'traite', 'revolution', 'empire', 'siecle', 'dynastie', 'evenement', 'historique', 'archeologie']
        },
        {
            id: 'geographie',
            name: '🌍 Géographie, Pays & Villes',
            keywords: ['ville', 'pays', 'departement', 'region', 'fleuve', 'montagne', 'capital', 'ocean', 'mer', 'commune', 'geographie', 'continent', 'ile']
        },
        {
            id: 'litterature',
            name: '📚 Littérature & Écrivains',
            keywords: ['ecrivain', 'auteur', 'livre', 'roman', 'poete', 'poesie', 'litterature', 'philosophie', 'philosophe', 'theatre', 'dramaturge']
        },
        {
            id: 'sciences',
            name: '🔬 Sciences & Technologies',
            keywords: ['science', 'savant', 'physique', 'chimie', 'biologie', 'astronomie', 'medecine', 'technologie', 'ordinateur', 'internet', 'logiciel', 'mathematiques', 'inventeur', 'ingenieur']
        },
        {
            id: 'arts',
            name: '🎨 Arts & Peinture',
            keywords: ['peintre', 'peinture', 'sculpteur', 'architecture', 'artiste', 'musee', 'art', 'dessin', 'photographe', 'exposition']
        },
        {
            id: 'jeuxvideo',
            name: '🎮 Jeux vidéo & Pop culture',
            keywords: ['jeu', 'video', 'anime', 'manga', 'console', 'nintendo', 'playstation', 'marvel', 'pop', 'comics', 'fiction', 'personnage', 'geek', 'gta', 'zelda']
        },
        {
            id: 'mythologie',
            name: '🏛️ Mythologie & Religions',
            keywords: ['religion', 'dieu', 'deesse', 'mythologie', 'bible', 'eglise', 'pape', 'saint', 'theologie', 'temple', 'jesus', 'croyance', 'croyant', 'bouddha', 'coran', 'torah']
        }
    ];

    // Initialiser les articles par thématique
    const themeArticles = {};
    THEMES.forEach(t => {
        themeArticles[t.id] = new Set();
    });

    // Classer chaque article dans sa thématique dominante
    for (const [title, cats] of Object.entries(pageCategoriesMap)) {
        const themeScores = {};
        THEMES.forEach(t => { themeScores[t.id] = 0; });

        cats.forEach(c => {
            const cNorm = c.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            
            // Ignorer les catégories de maintenance
            if (BLACKLISTED_CAT_KEYWORDS.some(kw => cNorm.includes(kw))) {
                return;
            }

            // Calculer les scores pour chaque thème
            THEMES.forEach(t => {
                const matches = t.keywords.filter(kw => cNorm.includes(kw)).length;
                if (matches > 0) {
                    themeScores[t.id] += matches;
                }
            });
        });

        // Trouver le thème avec le score le plus élevé (strictement supérieur à 0)
        let bestThemeId = null;
        let maxScore = 0;
        for (const [themeId, score] of Object.entries(themeScores)) {
            if (score > maxScore) {
                maxScore = score;
                bestThemeId = themeId;
            }
        }

        if (bestThemeId && maxScore > 0) {
            themeArticles[bestThemeId].add(title);
        }
    }

    // Préparer les thématiques valides qui contiennent au moins 5 articles
    const validCategories = [];
    THEMES.forEach(t => {
        const articleSet = themeArticles[t.id];
        if (articleSet.size >= 5) {
            validCategories.push({
                name: t.name,
                articles: Array.from(articleSet)
            });
        }
    });

    // Trier les catégories par nombre d'articles
    validCategories.sort((a, b) => b.articles.length - a.articles.length);
    return validCategories;
}

export async function fetchRandomArticle(category = null) {
    updateLoadingStatus(FRIENDLY_MESSAGES[messageIndex % FRIENDLY_MESSAGES.length]);
    messageIndex++;

    if (!window._topArticlesCache) {
        await _fetchTopArticlesFromWiki();
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

    let allowedArticles = window._topArticlesCache || [];

    if (category) {
        if (!window._multiplayerCategoriesMap || !window._multiplayerCategoriesMap[category]) {
            updateLoadingStatus("Analyse des catégories...");
            const cats = await fetchTopArticlesCategories();
            window._multiplayerCategoriesMap = {};
            cats.forEach(c => {
                window._multiplayerCategoriesMap[c.name] = c.articles;
            });
        }
        allowedArticles = window._multiplayerCategoriesMap[category] || [];
        if (allowedArticles.length === 0) {
            allowedArticles = window._topArticlesCache || [];
        }
    }

    if (allowedArticles.length > 0) {
        const rIndex = Math.floor(Math.random() * allowedArticles.length);
        const randomTitle = allowedArticles[rIndex];
        
        // Retirer de allowedArticles et de la liste globale
        allowedArticles.splice(rIndex, 1);
        const cacheIndex = window._topArticlesCache.indexOf(randomTitle);
        if (cacheIndex !== -1) {
            window._topArticlesCache.splice(cacheIndex, 1);
        }
        if (window._multiplayerCategoriesMap && window._multiplayerCategoriesMap[category]) {
            const catCacheIndex = window._multiplayerCategoriesMap[category].indexOf(randomTitle);
            if (catCacheIndex !== -1) {
                window._multiplayerCategoriesMap[category].splice(catCacheIndex, 1);
            }
        }
        
        params.append('titles', randomTitle);
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
            return fetchRandomArticle(category);
        }

        if (!response.ok) {
            updateLoadingStatus("Petit souci de connexion, on réessaie...");
            await sleep(2000);
            return fetchRandomArticle(category);
        }

        const data = await response.json();
        const pages = data?.query?.pages;

        if (!pages) {
            await sleep(1000);
            return fetchRandomArticle(category);
        }

        const pageId = Object.keys(pages)[0];
        const page = pages[pageId];

        if (!page || pageId === '-1' || !page.extract) {
            updateLoadingStatus("Sujet vide, on en cherche un autre...");
            await sleep(1000);
            return fetchRandomArticle(category);
        }

        updateLoadingStatus("Sujet trouvé ! Analyse en cours...");

        // Process plain text into paragraphs
        const paragraphs = processPlainText(page.extract, 6); // On prend jusqu'à 8 paragraphes pour atteindre la longueur

        const totalCharCount = paragraphs.join('\n\n').length;

        // MINNIMUM DE CARACTERE SUR LA PAGE POUR ÊTRE ACCEPTÉE
        if (totalCharCount < 250) {
            updateLoadingStatus("Sujet trop court, on en cherche un autre...");
            await sleep(500);
            return fetchRandomArticle(category);
        }

        const titleWords = page.title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[\s,.'-]+/).filter(w => w.length > 2);
        const allCats = (page.categories || [])
            .map(c => c.title.replace(/^Catégorie:/, ''));
        const allCategories = allCats.filter(c => {
            const cNorm = c.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            // Exclure les catégories de maintenance Wikipedia et métadonnées
            if (BLACKLISTED_CAT_KEYWORDS.some(kw => cNorm.includes(kw))) return false;
            return true;
        });
        const categories = allCategories.filter(c => {
            const cNorm = c.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            // Exclure les catégories qui contiennent un mot significatif du titre (évite de révéler la réponse)
            if (titleWords.some(w => w.length > 3 && cNorm.includes(w))) return false;
            return true;
        });

        return {
            id: String(pageId),
            title: page.title,
            paragraphs,
            categories,
            allCategories,
            url: `https://fr.wikipedia.org/?curid=${pageId}`
        };

    } catch (error) {
        console.error('WikiAPI: Fetch error:', error);
        await sleep(2000);
        return fetchRandomArticle(category);
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

        const titleWords2 = page.title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[\s,.'-]+/).filter(w => w.length > 2);
        const allCats = (page.categories || [])
            .map(c => c.title.replace(/^Catégorie:/, ''));
        const allCategories = allCats.filter(c => {
            const cNorm = c.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            // Exclure les catégories de maintenance Wikipedia et métadonnées
            if (BLACKLISTED_CAT_KEYWORDS.some(kw => cNorm.includes(kw))) return false;
            return true;
        });
        const categories = allCategories.filter(c => {
            const cNorm = c.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            // Exclure les catégories qui contiennent un mot significatif du titre (évite de révéler la réponse)
            if (titleWords2.some(w => w.length > 3 && cNorm.includes(w))) return false;
            return true;
        });

        return {
            id: String(pageId),
            title: page.title,
            paragraphs,
            categories,
            allCategories,
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
