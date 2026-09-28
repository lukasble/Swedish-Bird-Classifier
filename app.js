let session = null;
let classMapping = {};
let birdDictionary = {}; // Stores translations parsed from CSV
let currentLanguage = 'sv'; // Default language: 'sv' or 'en'
let chartInstance = null;
let lastTop5Results = null;
let currentStatusKey = 'loadingModel'; // Tracks current status text for language toggle

// UI Translations dictionary for static interface elements
const uiTranslations = {
    sv: {
        langBtn: "Språk: Svenska",
        appTitle: "🦅 Fågelartklassificerare",
        appSubtitle: "Ladda upp en ljudfil (.wav eller .mp3) för att identifiera fågelarten direkt i din webbläsare.",
        lblTopMatch: "Bästa matchning:",
        lblConfidence: "Sannolikhet:",
        chartLabel: "Sannolikhet (%)",
        // Dynamic status messages
        loadingModel: "Laddar AI-modell...",
        loadingMapping: "Laddar artmappning...",
        loadingDict: "Laddar fågelordbok...",
        ready: "Klar! Ladda upp en ljudfil för att klassificera.",
        extracting: "Extraherar Mel-spektrogram...",
        runningInference: "Kör AI-modell...",
        complete: "Klassificering klar!"
    },
    en: {
        langBtn: "Language: English",
        appTitle: "🦅 Bird Species Classifier",
        appSubtitle: "Upload an audio file (.wav or .mp3) to identify the bird species directly in your browser.",
        lblTopMatch: "Top Match:",
        lblConfidence: "Confidence:",
        chartLabel: "Confidence (%)",
        // Dynamic status messages
        loadingModel: "Loading AI model...",
        loadingMapping: "Loading species class mapping...",
        loadingDict: "Loading bird names dictionary...",
        ready: "Ready! Upload an audio file to classify.",
        extracting: "Extracting Mel-Spectrogram...",
        runningInference: "Running ONNX model inference...",
        complete: "Classification complete!"
    }
};

// DOM Elements
const statusEl = document.getElementById('status');
const audioInput = document.getElementById('audio-input');
const audioPlayer = document.getElementById('audio-player');
const resultsSection = document.getElementById('results');
const topSpeciesEl = document.getElementById('top-species');
const topConfidenceEl = document.getElementById('top-confidence');
const langToggleBtn = document.getElementById('lang-toggle-btn');
const appTitleEl = document.getElementById('app-title');
const appSubtitleEl = document.getElementById('app-subtitle');
const lblTopMatchEl = document.getElementById('lbl-top-match');
const lblConfidenceEl = document.getElementById('lbl-confidence');

// Helper function to update status text with language support
function setStatus(statusKey) {
    currentStatusKey = statusKey;
    if (statusEl) {
        statusEl.innerText = uiTranslations[currentLanguage][statusKey] || statusKey;
    }
}

// Language toggle button listener
if (langToggleBtn) {
    langToggleBtn.addEventListener('click', () => {
        currentLanguage = currentLanguage === 'sv' ? 'en' : 'sv';
        updateStaticText();
        
        if (lastTop5Results) {
            updateUIWithResults(lastTop5Results);
        }
    });
}

// Updates all static text elements on the page based on the current language
function updateStaticText() {
    const t = uiTranslations[currentLanguage];
    
    if (langToggleBtn) langToggleBtn.innerText = t.langBtn;
    if (appTitleEl) appTitleEl.innerText = t.appTitle;
    if (appSubtitleEl) appSubtitleEl.innerText = t.appSubtitle;
    if (lblTopMatchEl) lblTopMatchEl.innerText = t.lblTopMatch;
    if (lblConfidenceEl) lblConfidenceEl.innerText = t.lblConfidence;
    
    // Refresh status element if it holds a recognized key
    if (statusEl && uiTranslations[currentLanguage][currentStatusKey]) {
        statusEl.innerText = uiTranslations[currentLanguage][currentStatusKey];
    }

    // Update html lang attribute
    document.documentElement.lang = currentLanguage;
}

// 1. Initialize ONNX Runtime Session, Fetch Class Mappings & CSV Dictionary
async function init() {
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
        audioInput.disabled = false;
    } catch (err) {
        console.error("Initialization failed:", err);
        if (statusEl) {
            statusEl.innerText = `Error loading model/mapping: ${err.message}`;
            statusEl.style.borderLeftColor = "#e74c3c";
            statusEl.style.backgroundColor = "#fdf2f2";
        }
    }
}

// Reads and parses the CSV bird dictionary
async function loadBirdDictionary() {
    try {
        const response = await fetch('./bird_names_dictionary.csv');
        const csvText = await response.text();
        
        const lines = csvText.trim().split(/\r?\n/);
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            // Simple split by comma, cleaning up surrounding quotes
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
        console.log("Bird dictionary loaded:", Object.keys(birdDictionary).length, "species.");
    } catch (err) {
        console.warn("Failed to load CSV dictionary:", err);
    }
}

// Helper function to get bird name according to the selected language
function getFormattedBirdName(classCode) {
    const info = birdDictionary[classCode];
    if (info) {
        const primaryName = currentLanguage === 'sv' ? info.sv : info.en;
        return info.latin ? `${primaryName} (${info.latin})` : primaryName;
    }
    
    return classCode;
}

// 2. Helper Functions for Mel Filterbank Calculation
function hzToMel(hz) {
    return 2595.0 * Math.log10(1.0 + hz / 700.0);
}

function melToHz(mel) {
    return 700.0 * (Math.pow(10.0, mel / 2595.0) - 1.0);
}

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
            if (k < numFftBins) {
                filterbank[m - 1][k] = (k - fPrev) / (fCurr - fPrev || 1);
            }
        }
        for (let k = fCurr; k < fNext; k++) {
            if (k < numFftBins) {
                filterbank[m - 1][k] = (fNext - k) / (fNext - fCurr || 1);
            }
        }
    }
    return filterbank;
}

// 3. Audio File Upload Listener
audioInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    audioPlayer.src = URL.createObjectURL(file);
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
        statusEl.innerText = `Error processing audio: ${err.message}`;
    }
});

async function decodeAudioFile(file) {
    const arrayBuffer = await file.arrayBuffer();
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 32000 });
    return await audioCtx.decodeAudioData(arrayBuffer);
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
    for (let i = 0; i < rawSpectrogram.length; i++) {
        sum += rawSpectrogram[i];
    }
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

// 4. Run Model Inference & Render Results
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

function updateUIWithResults(top5) {
    const topMatch = top5[0];
    const classCode = classMapping[topMatch.idx];
    
    topSpeciesEl.innerText = getFormattedBirdName(classCode);
    topConfidenceEl.innerText = `${(topMatch.prob * 100).toFixed(2)}%`;

    renderChart(top5);
    resultsSection.style.display = 'block';
}

function softmax(logits) {
    const maxLogit = Math.max(...logits);
    const exps = logits.map(l => Math.exp(l - maxLogit));
    const sumExps = exps.reduce((a, b) => a + b, 0);
    return exps.map(e => e / sumExps);
}

function renderChart(top5) {
    const labels = top5.map(item => {
        const classCode = classMapping[item.idx];
        return getFormattedBirdName(classCode);
    });
    
    const data = top5.map(item => (item.prob * 100).toFixed(2));

    const ctx = document.getElementById('confidence-chart').getContext('2d');
    if (chartInstance) chartInstance.destroy();

    chartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: uiTranslations[currentLanguage].chartLabel,
                data: data,
                backgroundColor: ['#3498db', '#2ecc71', '#9b59b6', '#f1c40f', '#e67e22']
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, max: 100 }
            }
        }
    });
}

// Körs när skriptet laddar
updateStaticText();
init();