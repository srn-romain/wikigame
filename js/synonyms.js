export const SYNONYM_GROUPS = [
    ["le", "la", "les", "l"],
    ["un", "une", "des"],
    ["ce", "cet", "cette", "ces", "c"],
    ["mon", "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses"],
    ["notre", "nos", "votre", "vos", "leur", "leurs"],
    ["laquelle", "lequel", "lesquels", "lesquelles", "auquel", "auxquels", "auxquelles", "duquel", "desquels", "desquelles", "unquelq"],
    ["quel", "quels", "quelle", "quelles"],
    ["celui", "celle", "ceux", "celles", "celuici", "celleci", "ceuxci", "cellesci", "celuila", "cellela", "ceuxla", "cellesla"],
    ["quelqu", "quelque", "quelques", "quelquun", "quelquune", "quelquesuns", "quelquesunes", "unquelq"],
    ["tout", "tous", "toute", "toutes"],
    ["il", "ils", "elle", "elles"],
    ["qui", "que", "quoi", "dont", "ou", "qu"],
    ["au", "aux", "a", "al"],
    ["du", "des", "de", "d"],
    ["je", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles", "j"],
    ["se", "s", "me", "m", "te", "t"],
    ["ne", "n"],
    ["aucun", "aucune", "aucuns", "aucunes", "nul", "nulle"],
    ["certain", "certaine", "certains", "certaines"],
    ["autre", "autres"],
    ["chaque", "chacun", "chacune"],
    ["plusieurs", "certains", "certaines", "quelques"],
    ["meme", "memes"],
    ["tel", "tels", "telle", "telles"]
];

export async function checkWord(guess, target) {
    if (!guess || !target) return false;
    
    for (const group of SYNONYM_GROUPS) {
        if (group.includes(guess) && group.includes(target)) {
            return 'synonym';
        }
    }
    
    return false;
}

export function checkSynonymMatch(target, guesses) {
    for (const group of SYNONYM_GROUPS) {
        if (group.includes(target)) {
            // Cherche si l'utilisateur a tapé un mot de ce groupe
            for (const guess of guesses) {
                if (group.includes(guess)) {
                    return guess; // On retourne le mot tapé par l'utilisateur
                }
            }
        }
    }
    return null;
}

export function renderSynonymHint(span, guess) {
    if (span.classList.contains('revealed') || span.classList.contains('found')) return;
    
    // On retire close-match s'il y est, car synonym-hint est prioritaire
    span.classList.remove('close-match');
    span.classList.add('synonym-hint');
    span.setAttribute('data-hint', guess);
}

export function getSynonyms(word) {
    let syns = [];
    for (const group of SYNONYM_GROUPS) {
        if (group.includes(word)) {
            syns = syns.concat(group.filter(w => w !== word));
        }
    }
    return syns;
}
