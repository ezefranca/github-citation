async function generateCitation() {
  const input = document.getElementById('repoUrl').value.trim();
  const output = document.getElementById('output');
  output.textContent = 'Processing...';

  // Validate the GitHub URL
  const match = input.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) {
    output.textContent = 'Invalid GitHub URL format.';
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
      output.textContent = bibText;
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
      output.textContent = bibtex;
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
    output.textContent = bibtex;
  } catch (err) {
    console.error('Fallback GitHub fetch failed:', err);
    output.textContent = 'Failed to generate BibTeX citation. Please check the repository URL and try again.';
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

// Attach event listener to the button
document.getElementById('generateButton').addEventListener('click', generateCitation);