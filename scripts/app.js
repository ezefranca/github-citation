const output = document.getElementById('output');
const htmlEscapeMap = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

async function generateCitation() {
  const input = document.getElementById('repoUrl').value.trim();
  setOutputMessage('Processing...');

  // Validate the GitHub URL
  const match = input.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) {
    setOutputMessage('Invalid GitHub URL format.');
    return;
  }

  const [_, owner, repo] = match;
  const bibUrl = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/CITATION.bib`;
  const cffUrl = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/CITATION.cff`;

  try {
    // Check for CITATION.bib file
    const bibResponse = await fetch(bibUrl);
    if (bibResponse.ok) {
      const bibText = await bibResponse.text();
      renderBibtex(bibText);
      return;
    }
  } catch (err) {
    console.warn('CITATION.bib fetch failed:', err);
  }

  try {
    // Check for CITATION.cff file
    const cffResponse = await fetch(cffUrl);
    if (cffResponse.ok) {
      const yamlText = await cffResponse.text();
      const yamlModule = await import('https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/+esm');
      const data = yamlModule.load(yamlText);
      const bibtex = generateBibtexFromCFF(data);
      renderBibtex(bibtex);
      return;
    }
  } catch (err) {
    console.warn('CITATION.cff fetch failed:', err);
  }

  try {
    // Fallback to GitHub metadata
    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
    const userRes = await fetch(`https://api.github.com/users/${owner}`);
    if (!repoRes.ok || !userRes.ok) throw new Error("GitHub API failed");

    const repoJson = await repoRes.json();
    const userJson = await userRes.json();

    const fullName = userJson.name || owner;
    const formattedAuthor = formatNameToBibtex(fullName);

    const bibtex = `@misc{${repo},
  title = {${repoJson.name}},
  author = {${formattedAuthor}},
  year = {${new Date(repoJson.created_at).getFullYear()}},
  url = {${repoJson.html_url}},
  note = {Accessed ${new Date().toISOString().split('T')[0]}}
}`;
    renderBibtex(bibtex);
  } catch (err) {
    console.error('Fallback GitHub fetch failed:', err);
    setOutputMessage('Failed to generate BibTeX citation. Please check the repository URL and try again.');
  }
}

// Helper function to generate BibTeX from CITATION.cff data
function generateBibtexFromCFF(data) {
  const authors = (data.authors || [])
    .map(author => {
      if (author.family_names && author.given_names) {
        return `${author.given_names} ${author.family_names}`;
      }
      return author.name || '';
    })
    .join(' and ');

  return `@misc{${data.title.replace(/\s+/g, '_')},
  title = {${data.title}},
  author = {${authors}},
  year = {${data.date_released ? new Date(data.date_released).getFullYear() : 'n.d.'}},
  doi = {${data.identifiers?.find(id => id.type === 'doi')?.value || ''}},
  url = {${data.url || ''}}
}`;
}

// Helper function to format author names for BibTeX
function formatNameToBibtex(name) {
  const [firstName, ...lastName] = name.split(' ');
  return `${lastName.join(' ')}, ${firstName}`;
}

function setOutputMessage(message) {
  output.textContent = message;
}

function renderBibtex(bibtex) {
  output.innerHTML = highlightBibtex(bibtex);
}

function highlightBibtex(bibtex) {
  return bibtex
    .split('\n')
    .map((line) => highlightBibtexLine(line))
    .join('\n');
}

function highlightBibtexLine(line) {
  const entryMatch = line.match(/^(@)([A-Za-z]+)(\s*[{(]\s*)([^,\s]+)?/);
  if (entryMatch) {
    const [fullMatch, atSymbol, type, brace, key] = entryMatch;
    const keyMarkup = key ? `<span class="bibtex-key">${escapeHtml(key)}</span>` : '';
    const prefix = `<span class="bibtex-symbol">${escapeHtml(atSymbol)}</span><span class="bibtex-type">${escapeHtml(type)}</span>${escapeHtml(brace)}${keyMarkup}`;
    return `${prefix}${escapeHtml(line.slice(fullMatch.length))}`;
  }

  const fieldMatch = line.match(/^(\s*)([A-Za-z][A-Za-z0-9_-]*)(\s*=\s*)(.*)$/);
  if (fieldMatch) {
    const [, space, field, eq, rest] = fieldMatch;
    return `${escapeHtml(space)}<span class="bibtex-field">${escapeHtml(field)}</span>${escapeHtml(eq)}${highlightBibtexValues(rest)}`;
  }

  return escapeHtml(line);
}

function highlightBibtexValues(text) {
  const valueRegex = /(\{[^}]*\}|"[^"]*"|\d{4}|\d+(\.\d+)?)/g;
  let result = '';
  let lastIndex = 0;
  let match;

  while ((match = valueRegex.exec(text)) !== null) {
    result += escapeHtml(text.slice(lastIndex, match.index));
    result += `<span class="bibtex-value">${escapeHtml(match[0])}</span>`;
    lastIndex = match.index + match[0].length;
  }

  result += escapeHtml(text.slice(lastIndex));
  return result;
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (char) => htmlEscapeMap[char]);
}

// Attach event listener to the button
document.getElementById('generateButton').addEventListener('click', generateCitation);
