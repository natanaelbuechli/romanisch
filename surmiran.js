const STORAGE_KEY = "surmiran-vocabulary-progress";

const vocabulary = [
  { id: "1", de: "Haus", surmiran: "tgesa", category: "Alltag" },
  { id: "2", de: "Wasser", surmiran: "ava", category: "Alltag" },
  { id: "3", de: "Brot", surmiran: "paung", category: "Essen" },
  { id: "4", de: "Milch", surmiran: "latg", category: "Essen" },
  { id: "5", de: "Apfel", surmiran: "meil", category: "Essen" },
  { id: "6", de: "Hund", surmiran: "tgang", category: "Tiere" },
  { id: "7", de: "Katze", surmiran: "giat", category: "Tiere" },
  { id: "8", de: "Mutter", surmiran: "mamma", category: "Familie" },
  { id: "9", de: "Vater", surmiran: "bap", category: "Familie" },
  { id: "10", de: "Kind", surmiran: "uffant", category: "Familie" },
  { id: "11", de: "Schule", surmiran: "scola", category: "Orte" },
  { id: "12", de: "Straße", surmiran: "veia", category: "Orte" },
  { id: "13", de: "Auto", surmiran: "auto", category: "Transport" },
  { id: "14", de: "Fahrrad", surmiran: "velo", category: "Transport" },
  { id: "15", de: "Tag", surmiran: "de", category: "Zeit" },
  { id: "16", de: "Nacht", surmiran: "notg", category: "Zeit" },
  { id: "17", de: "essen", surmiran: "mangier", category: "Verben" },
  { id: "18", de: "trinken", surmiran: "baiver", category: "Verben" },
  { id: "19", de: "gehen", surmiran: "eir", category: "Verben" },
  { id: "20", de: "kommen", surmiran: "neir", category: "Verben" },
  { id: "21", de: "gut", surmiran: "bung", category: "Adjektive" },
  { id: "22", de: "klein", surmiran: "pitschen", category: "Adjektive" },
  { id: "23", de: "groß", surmiran: "grond", category: "Adjektive" },
  { id: "24", de: "danke", surmiran: "grazia fitg", category: "Alltag" },
  { id: "25", de: "bitte", surmiran: "per plascheir", category: "Alltag" }
];

const defaultProgress = () => ({
  correctCount: 0,
  wrongCount: 0,
  shownCount: 0,
  lastSeen: null,
  difficultyScore: 1
});

const state = {
  progress: loadProgress(),
  currentWordId: null,
  solutionVisible: false,
  hasAnsweredCurrent: false
};

const elements = {
  tabButtons: document.querySelectorAll(".tab-button"),
  learnView: document.getElementById("learn-view"),
  statsView: document.getElementById("stats-view"),
  wordDe: document.getElementById("word-de"),
  wordRm: document.getElementById("word-rm"),
  cardMeta: document.getElementById("card-meta"),
  showSolutionButton: document.getElementById("show-solution-button"),
  correctButton: document.getElementById("correct-button"),
  wrongButton: document.getElementById("wrong-button"),
  nextButton: document.getElementById("next-button"),
  statTotal: document.getElementById("stat-total"),
  statPractised: document.getElementById("stat-practised"),
  statWrong: document.getElementById("stat-wrong"),
  statMostlyCorrect: document.getElementById("stat-mostly-correct"),
  hardestList: document.getElementById("hardest-list"),
  easiestList: document.getElementById("easiest-list"),
  resetProgressButton: document.getElementById("reset-progress-button")
};

function loadProgress() {
  const saved = localStorage.getItem(STORAGE_KEY);

  if (!saved) {
    return createInitialProgress();
  }

  try {
    const parsed = JSON.parse(saved);
    return mergeWithDefaults(parsed);
  } catch (error) {
    console.warn("Gespeicherter Fortschritt konnte nicht gelesen werden. Die App startet neu.", error);
    return createInitialProgress();
  }
}

function createInitialProgress() {
  const progress = {};

  vocabulary.forEach((word) => {
    progress[word.id] = defaultProgress();
  });

  return progress;
}

function mergeWithDefaults(savedProgress) {
  const merged = createInitialProgress();

  vocabulary.forEach((word) => {
    if (savedProgress[word.id]) {
      merged[word.id] = {
        ...defaultProgress(),
        ...savedProgress[word.id]
      };
    }
  });

  return merged;
}

function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress));
}

function getWordById(wordId) {
  return vocabulary.find((word) => word.id === wordId);
}

function calculateDifficulty(progressEntry) {
  const baseWeight = 1;
  const wrongBoost = progressEntry.wrongCount * 2;
  const correctReduction = progressEntry.correctCount * 0.35;
  const unseenBoost = progressEntry.shownCount === 0 ? 1.5 : 0;
  const score = baseWeight + wrongBoost + unseenBoost - correctReduction;

  return Math.max(0.5, Number(score.toFixed(2)));
}

function updateDifficultyForWord(wordId) {
  const entry = state.progress[wordId];
  entry.difficultyScore = calculateDifficulty(entry);
}

function getWeightedWordPool() {
  return vocabulary.map((word) => {
    const progressEntry = state.progress[word.id];
    updateDifficultyForWord(word.id);

    let adjustedWeight = progressEntry.difficultyScore;

    if (word.id === state.currentWordId && vocabulary.length > 2) {
      adjustedWeight *= 0.15;
    }

    return {
      word,
      weight: Math.max(0.1, adjustedWeight)
    };
  });
}

function chooseNextWord() {
  const weightedPool = getWeightedWordPool();
  const totalWeight = weightedPool.reduce((sum, item) => sum + item.weight, 0);
  let randomPoint = Math.random() * totalWeight;

  for (const item of weightedPool) {
    randomPoint -= item.weight;
    if (randomPoint <= 0) {
      return item.word;
    }
  }

  return weightedPool[weightedPool.length - 1].word;
}

function showCurrentWord() {
  const currentWord = getWordById(state.currentWordId);
  const progressEntry = state.progress[state.currentWordId];

  elements.wordDe.textContent = currentWord.de;
  elements.wordRm.textContent = state.solutionVisible ? currentWord.surmiran : 'Tippe auf „Lösung anzeigen“';
  elements.wordRm.classList.toggle("hidden-answer", !state.solutionVisible);
  elements.cardMeta.textContent = `Kategorie: ${currentWord.category} | Gezeigt: ${progressEntry.shownCount} | Richtig: ${progressEntry.correctCount} | Falsch: ${progressEntry.wrongCount}`;

  elements.showSolutionButton.disabled = state.solutionVisible;
  elements.correctButton.disabled = !state.solutionVisible || state.hasAnsweredCurrent;
  elements.wrongButton.disabled = !state.solutionVisible || state.hasAnsweredCurrent;
}

function loadNextWord() {
  const nextWord = chooseNextWord();
  state.currentWordId = nextWord.id;
  state.solutionVisible = false;
  state.hasAnsweredCurrent = false;

  const entry = state.progress[nextWord.id];
  entry.shownCount += 1;
  entry.lastSeen = new Date().toISOString();
  updateDifficultyForWord(nextWord.id);
  saveProgress();

  showCurrentWord();
  renderStats();
}

function revealSolution() {
  state.solutionVisible = true;
  showCurrentWord();
}

function recordAnswer(isCorrect) {
  if (!state.solutionVisible || state.hasAnsweredCurrent) {
    return;
  }

  const entry = state.progress[state.currentWordId];

  if (isCorrect) {
    entry.correctCount += 1;
  } else {
    entry.wrongCount += 1;
  }

  updateDifficultyForWord(state.currentWordId);
  saveProgress();
  state.hasAnsweredCurrent = true;
  showCurrentWord();

  window.setTimeout(loadNextWord, 250);
}

function switchView(viewName) {
  const showLearn = viewName === "learn";

  elements.learnView.classList.toggle("active", showLearn);
  elements.statsView.classList.toggle("active", !showLearn);

  elements.tabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewName);
  });

  if (!showLearn) {
    renderStats();
  }
}

function getRankedWords(compareFn) {
  return vocabulary
    .map((word) => ({
      ...word,
      progress: state.progress[word.id]
    }))
    .sort(compareFn)
    .slice(0, 5);
}

function renderWordList(listElement, words, emptyMessage) {
  listElement.innerHTML = "";

  if (words.length === 0) {
    const item = document.createElement("li");
    item.textContent = emptyMessage;
    listElement.appendChild(item);
    return;
  }

  words.forEach((word) => {
    const item = document.createElement("li");
    item.textContent = `${word.de} - ${word.surmiran} (${word.progress.difficultyScore})`;
    listElement.appendChild(item);
  });
}

function renderStats() {
  const progressEntries = Object.values(state.progress);
  const practisedCount = progressEntries.filter((entry) => entry.shownCount > 0).length;
  const wrongCount = progressEntries.filter((entry) => entry.wrongCount > 0).length;
  const mostlyCorrectCount = progressEntries.filter(
    (entry) => entry.correctCount >= 2 && entry.correctCount > entry.wrongCount
  ).length;

  vocabulary.forEach((word) => updateDifficultyForWord(word.id));

  const hardestWords = getRankedWords(
    (a, b) => b.progress.difficultyScore - a.progress.difficultyScore || b.progress.wrongCount - a.progress.wrongCount
  );

  const easiestWords = getRankedWords(
    (a, b) => a.progress.difficultyScore - b.progress.difficultyScore || b.progress.correctCount - a.progress.correctCount
  ).filter((word) => word.progress.shownCount > 0);

  elements.statTotal.textContent = String(vocabulary.length);
  elements.statPractised.textContent = String(practisedCount);
  elements.statWrong.textContent = String(wrongCount);
  elements.statMostlyCorrect.textContent = String(mostlyCorrectCount);

  renderWordList(elements.hardestList, hardestWords, "Noch keine Daten");
  renderWordList(elements.easiestList, easiestWords, "Übe zuerst ein paar Wörter");
}

function resetProgress() {
  const confirmed = window.confirm("Gesamten gespeicherten Lernfortschritt zurücksetzen?");

  if (!confirmed) {
    return;
  }

  state.progress = createInitialProgress();
  saveProgress();
  renderStats();
  loadNextWord();
}

function bindEvents() {
  elements.showSolutionButton.addEventListener("click", revealSolution);
  elements.correctButton.addEventListener("click", () => recordAnswer(true));
  elements.wrongButton.addEventListener("click", () => recordAnswer(false));
  elements.nextButton.addEventListener("click", loadNextWord);
  elements.resetProgressButton.addEventListener("click", resetProgress);

  elements.tabButtons.forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });
}

function init() {
  bindEvents();
  renderStats();
  loadNextWord();
}

init();
