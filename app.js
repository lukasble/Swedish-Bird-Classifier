// Hjälpfunktion för att hitta rätt bild baserat på klasskod eller namn
function getBirdImageSrc(classCode, formattedName) {
    const searchString = `${classCode} ${formattedName}`.toLowerCase();

    if (searchString.includes('skat') || searchString.includes('magpie')) {
        return 'images/skata.jpg';
    }
    if (searchString.includes('gråsparv') || searchString.includes('graspa') || searchString.includes('sparrow')) {
        return 'images/gråsparv.jpg';
    }
    if (searchString.includes('domher') || searchString.includes('bullfinch')) {
        return 'images/domherre.jpg';
    }

    return 'images/fågel.png';
}

function updateUIWithResults(top5) {
    const topMatch = top5[0];
    const classCode = classMapping[topMatch.idx];
    const formattedName = getFormattedBirdName(classCode);
    
    if (topSpeciesEl) topSpeciesEl.innerText = formattedName;
    if (topConfidenceEl) topConfidenceEl.innerText = `${(topMatch.prob * 100).toFixed(2)}%`;

    // Sätt bildkälla med den smarta sökningen
    if (birdImageEl) {
        birdImageEl.src = getBirdImageSrc(classCode, formattedName);
        birdImageEl.alt = formattedName;
    }

    renderChart(top5);
    if (resultsSection) resultsSection.style.display = 'block';
}