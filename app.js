/**
 * Global Application State Variables
 */
let session = null;             // Holds the ONNX Runtime Web inference session
let classMapping = {};          // Maps output model indices to internal species codes
let birdDictionary = {};        // Maps species codes to scientific, English, and Swedish names
let currentLanguage = 'sv';     // Active UI language ('sv' or 'en')
let chartInstance = null;       // Reference to the Chart.js instance for rendering probabilities
let lastTop5Results = null;     // Stores the last computed top 5 classification results
let currentStatusKey = 'loadingModel'; // Key reflecting the current operational status
let currentObjectUrl = null;    // Stores object URL for proper memory cleanup

/**
 * UI Translation Dictionary
 * Contains all static UI texts in Swedish (sv) and English (en).
 */
const uiTranslations = {
    sv: {
        siteSubtitle: "ljudbaserad artidentifiering",
        appTitle: "Fågelartklassificerare",
        appSubtitle: "Ladda upp en ljudfil (.wav eller .mp3) för att identifiera fågelarten direkt i din webbläsare. OBS: Ljudfilen bör vara minst 5 sekunder lång och modellen lyssnar efter de mest ljudintensiva sekunderna i hela ljudfilen.",
        lblTopMatch: "Bästa matchning:",
        lblConfidence: "Sannolikhet:",
        chartLabel: "Sannolikhet (%)",
        sidebarTitle: "Exempelljud",
        sidebarDesc: "Ladda ner eller testa ett exempelljud direkt för att utvärdera modellen utan att behöva ladda upp egna filer.",
        btnTest: "Testa",
        artfaktaText: 'Testa att ladda upp ett eget inspelat svenskt fågelljud eller ladda ner ljud från <a href="https://artfakta.se/sok" target="_blank" rel="noopener noreferrer" style="color: #3498db; text-decoration: underline;">SLU Artbanken</a>. för att testa den ljudbaserade AI modellen ',
        loadingModel: "Laddar AI-modell...",
        loadingMapping: "Laddar artmappning...",
        loadingDict: "Laddar fågelordbok...",
        ready: "Klar! Ladda upp en ljudfil för att klassificera.",
        extracting: "Extraherar Mel-spektrogram...",
        runningInference: "Kör AI-modell...",
        complete: "Klassificering klar!",
        infoTitle: "Om projektet",
        infoDesc: "Denna app är en webbläsarbaserad AI-klassificerare för fågelläten som körs helt lokalt via ONNX Runtime Web och EfficientNet.",
        infoLinkText: "📖 Läs bygguiden & arkitekturen",
        infoBtnTitle: "Information om projektet",
        modelWarning: "⚠️ Observera: Bilar, andra höga bakgrundsljud eller fågelsång från andra arter i ljudfilen kan påverka analysen och leda till att modellen lyssnar efter fel ljud."
    },
    en: {
        siteSubtitle: "audio-based species identification",
        appTitle: "Bird Species Classifier",
        appSubtitle: "Upload an audio file (.wav or .mp3) to identify the bird species directly in your browser. Note: The audio file should be at least 5 seconds long, and the model will analyze the most sound-intensive seconds of the entire audio file.",
        lblTopMatch: "Top Match:",
        lblConfidence: "Confidence:",
        chartLabel: "Confidence (%)",
        sidebarTitle: "Sample Sounds",
        sidebarDesc: "Download or test a sample sound directly to evaluate the model without needing to upload your own files.",
        btnTest: "Test",
        artfaktaText: 'Try uploading your own recorded Swedish bird sound or download audio from <a href="https://artfakta.se/sok" target="_blank" rel="noopener noreferrer" style="color: #3498db; text-decoration: underline;">SLU Species Database</a>. to test the audio-based AI model',
        loadingModel: "Loading AI model...",
        loadingMapping: "Loading species class mapping...",
        loadingDict: "Loading bird names dictionary...",
        ready: "Ready! Upload an audio file to classify.",
        extracting: "Extracting Mel-Spectrogram...",
        runningInference: "Running AI model...",
        complete: "Classification complete!",
        infoTitle: "About the Project",
        infoDesc: "This app is a browser-based AI classifier for bird calls running entirely locally via ONNX Runtime Web and EfficientNet.",
        infoLinkText: "📖 Read the build guide & architecture",
        infoBtnTitle: "Information about the project",
        modelWarning: "⚠️ Note: Cars, other loud background noises, or bird songs from other species in the audio file may affect the analysis and cause the model to listen for the wrong sounds."
    }
};

// DOM Element references
let statusEl, audioInput, audioPlayer, resultsSection, topSpeciesEl, topConfidenceEl, langToggleBtn, appTitleEl, appSubtitleEl, siteSubtitleEl, lblTopMatchEl, lblConfidenceEl, birdImageEl, artfaktaEl, modelWarningEl;

/**
 * Initializes DOM element references and attaches event listeners.
 */
function initDOM() {
    statusEl = document.getElementById('status');
    audioInput = document.getElementById('audio-input');
    audioPlayer = document.getElementById('audio-player');
    resultsSection = document.getElementById('results');
    topSpeciesEl = document.getElementById('top-species');
    topConfidenceEl = document.getElementById('top-confidence');
    langToggleBtn = document.getElementById('lang-toggle-btn');
    appTitleEl = document.getElementById('app-title');
    appSubtitleEl = document.getElementById('app-subtitle');
    siteSubtitleEl = document.getElementById('site-subtitle');
    lblTopMatchEl = document.getElementById('lbl-top-match');
    lblConfidenceEl = document.getElementById('lbl-confidence');
    birdImageEl = document.getElementById('bird-image');
    artfaktaEl = document.getElementById('artfakta-text');
    modelWarningEl = document.getElementById('model-warning');

    // Language switch button handler
    if (langToggleBtn) {
        langToggleBtn.addEventListener('click', () => {
            currentLanguage = currentLanguage === 'sv' ? 'en' : 'sv';
            updateStaticText();
            if (lastTop5Results) {
                updateUIWithResults(lastTop5Results);
            }
        });
    }

    // Info popup toggle handler
    const infoBtn = document.getElementById('info-btn');
    const infoPopup = document.getElementById('info-popup');

    if (infoBtn && infoPopup) {
        infoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            infoPopup.classList.toggle('show');
        });

        document.addEventListener('click', (e) => {
            if (!infoPopup.contains(e.target) && e.target !== infoBtn) {
                infoPopup.classList.remove('show');
            }
        });
    }

    // Audio file upload input listener
    if (audioInput) {
        audioInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            if (currentObjectUrl) {
                URL.revokeObjectURL(currentObjectUrl);
            }
            currentObjectUrl = URL.createObjectURL(file);
            audioPlayer.src = currentObjectUrl;
            audioPlayer.style.display = 'block';

            setStatus('extracting');

            try {
                const audioBuffer = await decodeAudioFile(file);
                const spectrogramTensor = extractMelSpectrogramTensor(audioBuffer);
                
                setStatus('runningInference');
                await runInference(spectrogramTensor);
                
                setStatus('complete');
            } catch (err) {
                console.error("Processing failed:", err);
                if (statusEl) {
                    statusEl.textContent = `Fel vid ljudbearbetning: ${err.message}`;
                }
            }
        });
    }

    updateStaticText();
}

/**
 * Updates status text safely based on internationalization keys.
 * @param {string} statusKey - Key corresponding to uiTranslations.
 */
function setStatus(statusKey) {
    currentStatusKey = statusKey;
    if (statusEl) {
        statusEl.textContent = uiTranslations[currentLanguage][statusKey] || statusKey;
    }
}

/**
 * Updates all static UI texts when switching languages or initializing.
 */
function updateStaticText() {
    const t = uiTranslations[currentLanguage];
    
    if (siteSubtitleEl) siteSubtitleEl.textContent = t.siteSubtitle;
    if (appTitleEl) appTitleEl.textContent = t.appTitle;
    if (appSubtitleEl) appSubtitleEl.textContent = t.appSubtitle;
    if (lblTopMatchEl) lblTopMatchEl.textContent = t.lblTopMatch;
    if (lblConfidenceEl) lblConfidenceEl.textContent = t.lblConfidence;
    if (modelWarningEl) modelWarningEl.textContent = t.modelWarning;
    
    if (artfaktaEl) artfaktaEl.innerHTML = t.artfaktaText;
    
    const sidebarTitleEl = document.getElementById('sidebar-title');
    const sidebarDescEl = document.getElementById('sidebar-desc');
    if (sidebarTitleEl) sidebarTitleEl.textContent = t.sidebarTitle;
    if (sidebarDescEl) sidebarDescEl.textContent = t.sidebarDesc;

    const infoTitleEl = document.getElementById('info-title');
    const infoDescEl = document.getElementById('info-desc');
    const infoLinkEl = document.getElementById('info-link');
    const infoBtnEl = document.getElementById('info-btn');

    if (infoTitleEl) infoTitleEl.textContent = t.infoTitle;
    if (infoDescEl) infoDescEl.textContent = t.infoDesc;
    if (infoLinkEl) infoLinkEl.textContent = t.infoLinkText;
    if (infoBtnEl) infoBtnEl.title = t.infoBtnTitle;

    document.querySelectorAll('.btn-test-text').forEach(el => el.textContent = t.btnTest);
    document.querySelectorAll('.example-name').forEach(el => {
        el.textContent = el.getAttribute(`data-${currentLanguage}`);
    });

    const langSv = document.getElementById('lang-sv');
    const langEn = document.getElementById('lang-en');
    if (langSv && langEn) {
        if (currentLanguage === 'sv') {
            langSv.classList.add('active');
            langEn.classList.remove('active');
        } else {
            langEn.classList.add('active');
            langSv.classList.remove('active');
        }
    }

    if (statusEl && uiTranslations[currentLanguage][currentStatusKey]) {
        statusEl.textContent = uiTranslations[currentLanguage][currentStatusKey];
    }

    document.documentElement.lang = currentLanguage;
}

/**
 * Safely loads and processes sample audio files from the audio directory.
 * @param {string} filePath - Relative path to the sample audio file.
 */
async function loadExampleAudio(filePath) {
    const validPrefixes = ['./audio/', 'audio/', './samples/', 'samples/'];
    const isValidPath = validPrefixes.some(prefix => filePath.startsWith(prefix));

    if (!isValidPath) {
        console.error("Invalid file path supplied:", filePath);
        return;
    }

    const player = audioPlayer || document.getElementById('audio-player');
    let audioCtx = null;
    
    try {
        setStatus('extracting');

        if (player) {
            player.src = filePath;
            player.style.display = 'block';
            player.play().catch(e => console.log("Auto-play blocked by browser:", e));
        }

        const response = await fetch(filePath);
        if (!response.ok) {
            throw new Error(`Failed to retrieve file (${response.status} ${response.statusText})`);
        }

        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();

        audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 32000 });
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

        const spectrogramTensor = extractMelSpectrogramTensor(audioBuffer);
        
        setStatus('runningInference');
        await runInference(spectrogramTensor);
        
        setStatus('complete');
    } catch (err) {
        console.error("Error loading sample file:", err);
        if (statusEl) statusEl.textContent = `Fel: ${err.message}`;
    } finally {
        if (audioCtx && audioCtx.state !== 'closed') {
            await audioCtx.close();
        }
    }
}

/**
 * Initializes model session, species mapping, and bird dictionary.
 */
async function init() {
    initDOM();
    try {
        setStatus('loadingModel');
        
        ort.env.wasm.numThreads = 2;
        session = await ort.InferenceSession.create('./models/bird_classifier_efficientnet.onnx', {
            executionProviders: ['webgl', 'wasm']
        });

        setStatus('loadingMapping');
        const response = await fetch('./models/species_class_mapping.json');
        classMapping = await response.json();

        setStatus('loadingDict');
        await loadBirdDictionary();

        setStatus('ready');
        if (audioInput) audioInput.disabled = false;
    } catch (err) {
        console.error("Initialization failed:", err);
        if (statusEl) {
            statusEl.textContent = `Fel vid laddning: ${err.message}`;
            statusEl.style.borderLeftColor = "#e74c3c";
            statusEl.style.backgroundColor = "#fdf2f2";
        }
    }
}

/**
 * Loads CSV dictionary mapping species codes to scientific, English, and Swedish names.
 */
async function loadBirdDictionary() {
    try {
        const response = await fetch('./bird_names_dictionary.csv');
        const csvText = await response.text();
        
        const lines = csvText.trim().split(/\r?\n/);
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const columns = line.split(',').map(col => col.replace(/^"|"$/g, '').trim());
            
            if (columns.length >= 4) {
                const label = columns[0];
                const scientificName = columns[1];
                const commonName = columns[2];
                const swedishName = columns[3];

                birdDictionary[label] = {
                    latin: scientificName || '',
                    en: commonName || label,
                    sv: swedishName || commonName || label
                };
            }
        }
    } catch (err) {
        console.warn("Unable to load CSV dictionary:", err);
    }
}

/**
 * Formats bird species name based on selected language and scientific name availability.
 */
function getFormattedBirdName(classCode) {
    const info = birdDictionary[classCode];
    if (info) {
        const primaryName = currentLanguage === 'sv' ? info.sv : info.en;
        return info.latin ? `${primaryName} (${info.latin})` : primaryName;
    }
    return classCode;
}

function hzToMel(hz) { return 2595.0 * Math.log10(1.0 + hz / 700.0); }
function melToHz(mel) { return 700.0 * (Math.pow(10.0, mel / 2595.0) - 1.0); }

function createMelFilterbank(numMels, fftSize, sampleRate, fMin = 0, fMax = null) {
    if (!fMax) fMax = sampleRate / 2;
    const numFftBins = Math.floor(fftSize / 2) + 1;
    const minMel = hzToMel(fMin);
    const maxMel = hzToMel(fMax);
    
    const melPoints = new Float32Array(numMels + 2);
    for (let i = 0; i < numMels + 2; i++) {
        melPoints[i] = minMel + (i / (numMels + 1)) * (maxMel - minMel);
    }
    
    const hzPoints = melPoints.map(melToHz);
    const binPoints = hzPoints.map(hz => Math.floor(((fftSize + 1) * hz) / sampleRate));
    const filterbank = Array.from({ length: numMels }, () => new Float32Array(numFftBins));
    
    for (let m = 1; m <= numMels; m++) {
        const fPrev = binPoints[m - 1];
        const fCurr = binPoints[m];
        const fNext = binPoints[m + 1];
        
        for (let k = fPrev; k < fCurr; k++) {
            if (k < numFftBins) filterbank[m - 1][k] = (k - fPrev) / (fCurr - fPrev || 1);
        }
        for (let k = fCurr; k < fNext; k++) {
            if (k < numFftBins) filterbank[m - 1][k] = (fNext - k) / (fNext - fCurr || 1);
        }
    }
    return filterbank;
}

async function decodeAudioFile(file) {
    const arrayBuffer = await file.arrayBuffer();
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 32000 });
    try {
        return await audioCtx.decodeAudioData(arrayBuffer);
    } finally {
        if (audioCtx.state !== 'closed') {
            await audioCtx.close();
        }
    }
}

function extractMelSpectrogramTensor(audioBuffer) {
    const pcmData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    const windowSamples = sampleRate * 5;
    let startSample = 0;

    if (pcmData.length > windowSamples) {
        let maxEnergy = 0;
        let step = Math.floor(sampleRate / 2);
        for (let i = 0; i <= pcmData.length - windowSamples; i += step) {
            let energy = 0;
            for (let j = i; j < i + windowSamples; j += 100) {
                energy += pcmData[j] * pcmData[j];
            }
            if (energy > maxEnergy) {
                maxEnergy = energy;
                startSample = i;
            }
        }
    }

    const segment = pcmData.slice(startSample, startSample + windowSamples);
    const fftSize = 1024;
    const timeFrames = 313;
    const numMels = 128;
    const hopSize = 512;
    const numFftBins = Math.floor(fftSize / 2) + 1;
    
    const melFilterbank = createMelFilterbank(numMels, fftSize, sampleRate);
    const rawSpectrogram = new Float32Array(numMels * timeFrames);

    Meyda.bufferSize = fftSize;
    Meyda.sampleRate = sampleRate;

    for (let frame = 0; frame < timeFrames; frame++) {
        const frameOffset = frame * hopSize;
        const frameBuffer = segment.slice(frameOffset, frameOffset + fftSize);
        
        if (frameBuffer.length === fftSize) {
            const powerSpec = Meyda.extract('powerSpectrum', frameBuffer);
            if (powerSpec) {
                for (let mel = 0; mel < numMels; mel++) {
                    let melEnergy = 0.0;
                    for (let k = 0; k < numFftBins; k++) {
                        melEnergy += (powerSpec[k] || 0.0) * melFilterbank[mel][k];
                    }
                    const db = 10.0 * Math.log10(Math.max(1e-10, melEnergy));
                    rawSpectrogram[mel * timeFrames + frame] = db;
                }
            }
        }
    }

    let sum = 0;
    for (let i = 0; i < rawSpectrogram.length; i++) sum += rawSpectrogram[i];
    const mean = sum / rawSpectrogram.length;

    let squareSum = 0;
    for (let i = 0; i < rawSpectrogram.length; i++) {
        const diff = rawSpectrogram[i] - mean;
        squareSum += diff * diff;
    }
    const std = Math.sqrt(squareSum / rawSpectrogram.length) + 1e-6;

    const float32Data = new Float32Array(1 * 1 * numMels * timeFrames);
    for (let i = 0; i < rawSpectrogram.length; i++) {
        float32Data[i] = (rawSpectrogram[i] - mean) / std;
    }

    return new ort.Tensor('float32', float32Data, [1, 1, numMels, timeFrames]);
}

function softmax(arr) {
    const maxLogit = Math.max(...arr);
    const exps = arr.map(value => Math.exp(value - maxLogit));
    const sumExps = exps.reduce((a, b) => a + b, 0);
    return exps.map(value => value / sumExps);
}

async function runInference(inputTensor) {
    const feeds = { input_spectrogram: inputTensor };
    const results = await session.run(feeds);
    const logits = results.species_logits.data;

    const probabilities = softmax(Array.from(logits));
    const indexedProbs = probabilities.map((prob, idx) => ({ prob, idx }));
    indexedProbs.sort((a, b) => b.prob - a.prob);
    
    lastTop5Results = indexedProbs.slice(0, 5);
    updateUIWithResults(lastTop5Results);
}

function getBirdImageSrc(classCode, formattedName) {
    const searchString = `${classCode} ${formattedName}`.toLowerCase();

    if (searchString.includes('skat') || searchString.includes('magpie')) {
        return 'images/skata.jpg';
    }
    if (searchString.includes('gråsparv') || searchString.includes('graspa') || searchString.includes('sparrow')) {
        return 'images/grasparv.jpg';
    }
    if (searchString.includes('domher') || searchString.includes('bullfinch')) {
        return 'images/domherre.jpg';
    }

    return 'images/fagel.png';
}

/**
 * Updates UI elements with top match results and triggers chart rendering.
 */
function updateUIWithResults(top5) {
    const topMatch = top5[0];
    const classCode = classMapping[topMatch.idx];
    const formattedName = getFormattedBirdName(classCode);
    
    if (topSpeciesEl) topSpeciesEl.textContent = formattedName;
    if (topConfidenceEl) topConfidenceEl.textContent = `${(topMatch.prob * 100).toFixed(2)}%`;

    if (birdImageEl) {
        birdImageEl.src = getBirdImageSrc(classCode, formattedName);
        birdImageEl.alt = formattedName;
    }

    if (modelWarningEl) {
        modelWarningEl.textContent = uiTranslations[currentLanguage].modelWarning;
    }

    if (resultsSection) resultsSection.style.display = 'block';

    renderChart(top5);
}

function renderChart(top5) {
    const chartCanvas = document.getElementById('confidence-chart');
    if (!chartCanvas) return;

    const ctx = chartCanvas.getContext('2d');
    const labels = top5.map(item => getFormattedBirdName(classMapping[item.idx]));
    const data = top5.map(item => (item.prob * 100).toFixed(2));

    if (chartInstance) {
        chartInstance.destroy();
    }

    chartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: uiTranslations[currentLanguage].chartLabel,
                data: data,
                backgroundColor: 'rgba(44, 94, 59, 0.7)',
                borderColor: 'rgba(44, 94, 59, 1)',
                borderWidth: 1
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    beginAtZero: true,
                    max: 100
                }
            }
        }
    });
}

window.addEventListener('DOMContentLoaded', init);