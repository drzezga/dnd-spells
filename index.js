document.addEventListener('DOMContentLoaded', function () {
  // DOM elements
  const searchInput = document.getElementById('spell-search');
  const levelFilter = document.getElementById('level-filter');
  const schoolFilter = document.getElementById('school-filter');
  const resultsContainer = document.getElementById('spell-results');
  const spellsCountElement = document.getElementById('spells-count');
  const spellTemplate = document.getElementById('spell-template');

  // State variables
  let allSpells = [];
  let spellClasses = new Map();
  let filteredSpells = [];
  let searchTerm = '';
  let selectedLevel = '';
  let selectedSchool = '';
  let selectedClass = '';
  let isPrinting = false;

  // Search configuration
  const FUZZY_SEARCH_THRESHOLD = 0.3;
  const EXACT_MATCH_BOOST = 2.0;
  const WORD_SPLIT_REGEX = /\b\w+\b/g;

  // Initialize the application
  // D&D specific terms to highlight
  const dndTerms = /\b(AC|HP|DC|DM|\d+d\d+(\s\+\s\d+)?|\d+ (feet|foot|hour|hours|mile|miles|day|days|minute|minutes)|\d+-(foot|hour|mile)|Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma|advantage|disadvantage)\b/gi;

  // Pre-process the text to add bold markdown to D&D terms
  function addDndTermFormatting(text) {
    // Replace numbers followed by 'feet' or 'foot'
    // text = text.replace(/\b(\d+) (feet|foot)\b/gi, '**$1 $2**');
    // text = text.replace(/\b(\d+)-(foot)\b/gi, '**$1 $2**');
    // Replace dice rolls
    // text = text.replace(/\b(\d+d\d+)\b/gi, '**$1**');
    // Replace other D&D terms
    text = text.replace(dndTerms, '**$1**');
    return text;
  }

  async function init() {
    showLoading();
    try {
      // Configure marked options
      marked.setOptions({
        gfm: true,
        breaks: true,
        smartLists: true,
        smartypants: true,
      });
      await loadSpells();
      setupEventListeners();
      setupPrintHandlers();
      updateResults();
    } catch (error) {
      console.error('Failed to initialize app:', error);
      showError('Failed to load spell data. Please refresh the page.');
    }
  }

  // Show loading state
  function showLoading() {
    resultsContainer.innerHTML = '<div class="loading"></div>';
  }

  // Show error message
  function showError(message) {
    // Keep search and filters visible by only clearing results div
    document.getElementById('spell-results').innerHTML = `<div class="no-results">${message}</div>`;
  }

  // Load spells and classes data from CSV files
  async function loadSpells() {
    // Load spells
    const spellsResponse = await fetch('spells.csv');
    const spellsData = await spellsResponse.text();
    allSpells = parseCSV(spellsData);

    // Load spell classes
    const classesResponse = await fetch('spells-classes.csv');
    const classesData = await classesResponse.text();
    const classesRows = parseCSV(classesData);

    // Create map of spell name to classes
    classesRows.forEach(row => {
      const classes = row.classes.split(',').map(c => c.trim());
      spellClasses.set(row.name, classes);
    });

    console.log(`Loaded ${allSpells.length} spells`);
  }

  // Parse CSV data
  function parseCSV(text) {
    let pos = 0;
    const data = [];
    let headers = [];
    let firstRow = true;

    while (pos < text.length) {
      const { values, newPos } = parseCSVLine(text, pos);
      if (values.length > 0) {  // Skip empty lines
        if (firstRow) {
          headers = values;
          firstRow = false;
        } else {
          const spell = {};
          headers.forEach((header, index) => {
            spell[header] = values[index] || '';
          });
          data.push(spell);
        }
      }
      pos = newPos;
    }

    return data;
  }

  // Parse a single CSV line, handling quoted values and newlines correctly
  function parseCSVLine(text, startPos) {
    const values = [];
    let pos = startPos;
    let currentValue = '';
    let insideQuotes = false;

    while (pos < text.length) {
      const char = text[pos];

      if (char === '"') {
        if (insideQuotes) {
          // Check for escaped quote
          if (text[pos + 1] === '"') {
            currentValue += '"';
            pos += 2;
            continue;
          }
          // End of quoted section
          insideQuotes = false;
          pos++;
          continue;
        } else {
          // Start of quoted section
          insideQuotes = true;
          pos++;
          continue;
        }
      }

      if (!insideQuotes) {
        if (char === ',') {
          // End of field
          values.push(currentValue);
          currentValue = '';
          pos++;
          continue;
        }
        if (char === '\n' || char === '\r') {
          // End of line
          values.push(currentValue);
          pos++;
          // Skip \r\n if present
          if (char === '\r' && text[pos] === '\n') {
            pos++;
          }
          break;
        }
      }

      currentValue += char;
      pos++;
    }

    // Add the last value if there is one
    if (currentValue || values.length > 0) {
      values.push(currentValue);
    }

    return { values, newPos: pos };
  }

  // Calculate Levenshtein distance between two strings
  function levenshteinDistance(str1, str2) {
    const m = str1.length;
    const n = str2.length;
    const dp = Array(m + 1).fill().map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) {
      dp[i][0] = i;
    }
    for (let j = 0; j <= n; j++) {
      dp[0][j] = j;
    }

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = Math.min(
            dp[i - 1][j - 1] + 1,  // substitution
            dp[i - 1][j] + 1,      // deletion
            dp[i][j - 1] + 1       // insertion
          );
        }
      }
    }

    return dp[m][n];
  }

  // Calculate similarity score between 0 and 1
  function calculateSimilarity(str1, str2) {
    const distance = levenshteinDistance(str1.toLowerCase(), str2.toLowerCase());
    const maxLength = Math.max(str1.length, str2.length);
    return 1 - (distance / maxLength);
  }

  // Setup event listeners
  function setupEventListeners() {
    searchInput.addEventListener('input', handleSearchInput);
    levelFilter.addEventListener('change', handleFilterChange);
    schoolFilter.addEventListener('change', handleFilterChange);
    document.getElementById('class-filter').addEventListener('change', handleFilterChange);

    // Add keyboard shortcut for search
    document.addEventListener('keydown', (e) => {
      // Check if the key is '/' and no input/textarea is focused
      if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        e.preventDefault(); // Prevent the '/' from being typed
        window.scrollTo({ top: 0, behavior: 'smooth' });
        searchInput.focus();
      }
      // Add Escape key to blur search
      if (e.key === 'Escape' && document.activeElement === searchInput) {
        searchInput.blur();
      }
    });
  }

  // Handle search input changes
  function handleSearchInput() {
    searchTerm = searchInput.value.toLowerCase();
    updateResults();
  }

  // Handle filter changes
  function handleFilterChange() {
    selectedLevel = levelFilter.value;
    selectedSchool = schoolFilter.value;
    selectedClass = document.getElementById('class-filter').value;
    updateResults();
  }

  // Filter spells based on current search and filters
  function filterSpells() {
    let matchingSpells = allSpells;

    // Apply search if there's a search term
    if (searchTerm) {
      const searchTermLower = searchTerm.toLowerCase();
      const searchWords = searchTermLower.match(WORD_SPLIT_REGEX) || [];

      matchingSpells = allSpells.map(spell => {
        const nameLower = spell.name.toLowerCase();
        let nameExactMatch = false;
        let wordMatchCount = 0;

        // Check for complete phrase match first
        if (nameLower.includes(searchTermLower)) {
          nameExactMatch = true;
          wordMatchCount = searchWords.length; // Give maximum word match score
        }

        // Calculate exact and fuzzy match scores for name
        let bestNameSimilarity = calculateSimilarity(nameLower, searchTermLower);

        // Then check individual words
        for (const word of searchWords) {
          if (nameLower.includes(word)) {
            nameExactMatch = true;
            wordMatchCount++;
          }
          const wordSimilarity = calculateSimilarity(nameLower, word);
          bestNameSimilarity = Math.max(bestNameSimilarity, wordSimilarity);
        }

        // Calculate final similarity score
        const similarity = bestNameSimilarity * (nameExactMatch ? EXACT_MATCH_BOOST : 1);

        return {
          spell,
          similarity,
          nameExactMatch,
          wordMatchCount
        };
      })
        .filter(item => item.similarity > FUZZY_SEARCH_THRESHOLD)
        .sort((a, b) => {
          // First sort by number of exact word matches in name
          const aWordMatches = a.wordMatchCount || 0;
          const bWordMatches = b.wordMatchCount || 0;
          if (aWordMatches !== bWordMatches) {
            return bWordMatches - aWordMatches;
          }
          // Then by similarity score
          return b.similarity - a.similarity;
        })
        .map(item => item.spell)
    }

    // Apply filters
    return matchingSpells.filter(spell => {
      const matchesLevel = selectedLevel === '' || spell.level === selectedLevel;
      const matchesSchool = selectedSchool === '' || spell.school.toLowerCase() === selectedSchool;
      const matchesClass = selectedClass === '' ||
        (spellClasses.has(spell.name) && spellClasses.get(spell.name).some(c =>
          c.toLowerCase() === selectedClass.toLowerCase()
        ));
      return matchesLevel && matchesSchool && matchesClass;
    });
  }

  // Update the displayed results
  function updateResults() {
    filteredSpells = filterSpells();
    const totalResults = filteredSpells.length;

    // Update search wrapper with count only when searching
    const searchWrapper = document.querySelector('.search-wrapper');
    if (searchTerm) {
      searchWrapper.setAttribute('data-count', `${totalResults} spells`);
    } else {
      searchWrapper.removeAttribute('data-count');
    }

    if (totalResults === 0) {
      document.getElementById('spell-results').innerHTML = '<div class="no-results">No spells match your criteria</div>';
      return;
    }

    resultsContainer.innerHTML = '';

    // Add all results
    const spellsToShow = isPrinting ? filteredSpells : filteredSpells.slice(0, 20);
    spellsToShow.forEach(spell => {
      const spellElement = createSpellElement(spell);
      resultsContainer.appendChild(spellElement);
    });
  }

  // Setup print handlers
  function setupPrintHandlers() {
    window.onbeforeprint = () => {
      isPrinting = true;
      updateResults();
    };

    window.onafterprint = () => {
      isPrinting = false;
      updateResults();
    };
  }



  // Create an element for a single spell
  function createSpellElement(spell) {
    const spellCard = document.importNode(spellTemplate.content, true).querySelector('.spell-card');

    // Set data attribute for styling based on level
    spellCard.dataset.level = spell.level;

    // Set the spell details
    const nameEl = spellCard.querySelector('.spell-name');
    const descEl = spellCard.querySelector('.spell-description');

    // Pre-process D&D terms and convert to HTML
    let preprocessed = addDndTermFormatting(spell.description);
    let description = marked.parse(preprocessed);

    if (searchTerm) {
      nameEl.innerHTML = highlightText(spell.name, searchTerm);
    } else {
      nameEl.textContent = spell.name;
    }
    descEl.innerHTML = description;

    spellCard.querySelector('.spell-level').textContent = formatLevel(spell.level);
    spellCard.querySelector('.spell-school').textContent = capitalizeFirstLetter(spell.school);
    spellCard.querySelector('.spell-casting-time').textContent = spell.casting_time;
    spellCard.querySelector('.spell-range').textContent = spell.range;
    spellCard.querySelector('.spell-components').textContent = formatComponents(spell);
    spellCard.querySelector('.spell-duration').textContent = spell.duration;

    return spellCard;
  }

  // Format the level display
  function formatLevel(level) {
    if (level === 'cantrip') {
      return 'Cantrip';
    } else {
      return level.charAt(0).toUpperCase() + level.slice(1);
    }
  }

  // Format the components display
  function formatComponents(spell) {
    const components = [];

    if (spell.component_verbal === 'V') components.push('V');
    if (spell.component_semantic === 'S') components.push('S');
    if (spell.component_material === 'M') {
      if (spell.component_misc) {
        components.push(`M (${spell.component_misc})`);
      } else {
        components.push('M');
      }
    }

    return components.join(', ');
  }

  // Highlight matching text in a string
  function highlightText(text, searchTerm) {
    if (!searchTerm) return text;

    let result = text;
    const searchTermLower = searchTerm.toLowerCase();

    // First try to highlight the complete phrase
    const phraseRegex = new RegExp(`(${escapeRegExp(searchTermLower)})`, 'gi');
    if (text.toLowerCase().includes(searchTermLower)) {
      result = result.replace(phraseRegex, '<span class="highlight-strong">$1</span>');
      return result;
    }

    // Then try individual words
    const words = searchTermLower.match(WORD_SPLIT_REGEX) || [];
    words.forEach(word => {
      if (!word) return;
      const regex = new RegExp(`(${escapeRegExp(word)})`, 'gi');
      result = result.replace(regex, '<span class="highlight-strong">$1</span>');
    });

    return result;
  }

  // Return full description with markdown
  function highlightTextInDescription(text, searchTerm) {
    return text;
  }

  // Escape special characters for use in regex
  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Helper function to capitalize first letter
  function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
  }

  // Initialize the app
  init();
});
