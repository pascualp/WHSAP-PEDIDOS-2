import fs from 'fs';
import path from 'path';

async function fetchRepo() {
  const repo = 'pascualp/pedidos-whatsapp';
  
  let defaultBranch = 'main';
  try {
    const repoInfoRes = await fetch(`https://api.github.com/repos/${repo}`);
    if (repoInfoRes.ok) {
      const repoInfo = await repoInfoRes.json();
      defaultBranch = repoInfo.default_branch;
    }
  } catch (e) {}

  const treeUrl = `https://api.github.com/repos/${repo}/git/trees/${defaultBranch}?recursive=1`;
  const res = await fetch(treeUrl);
  const data = await res.json();
  
  if (!data.tree) {
    console.error('No tree found', data);
    return;
  }

  for (const item of data.tree) {
    if (item.type === 'blob') {
      const fileUrl = `https://raw.githubusercontent.com/${repo}/${defaultBranch}/${item.path}`;
      console.log(`Fetching ${item.path}...`);
      const fileRes = await fetch(fileUrl);
      const content = await fileRes.text();
      
      const fullPath = path.join(process.cwd(), 'repo_download', item.path);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
    }
  }
  console.log('Done fetching repo.');
}

fetchRepo();
