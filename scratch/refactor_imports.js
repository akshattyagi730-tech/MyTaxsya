import fs from 'fs';
import path from 'path';

const srcDir = '/Users/akshat/MyTaxsya/MyTaxsya-frontend/src';

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    const dirPath = path.join(dir, f);
    const isDirectory = fs.statSync(dirPath).isDirectory();
    if (isDirectory) {
      walkDir(dirPath, callback);
    } else {
      callback(dirPath);
    }
  });
}

const replacements = [
  // 1. Rename import of apiClient to api
  {
    regex: /import\s+apiClient\s+from\s+["']@\/api\/apiClient["'];?/g,
    replace: "import api from '@/services/api';"
  },
  {
    regex: /import\s+apiClient\s+from\s+["']\.\.?\/api\/apiClient["'];?/g,
    replace: "import api from '@/services/api';"
  },
  // 2. Replace apiClient variable uses with api
  {
    regex: /\bapiClient\b/g,
    replace: "api"
  },
  // 3. Rename specific layouts imports
  {
    regex: /@\/Components\/Layout/g,
    replace: "@/layouts/Layout"
  },
  {
    regex: /@\/Components\/AuthLayout/g,
    replace: "@/layouts/AuthLayout"
  },
  // 4. Rename components references from uppercase to lowercase
  {
    regex: /@\/Components\//g,
    replace: "@/components/"
  },
  // 5. Rename AuthContext import
  {
    regex: /@\/lib\/AuthContext/g,
    replace: "@/contexts/AuthContext"
  },
  // 6. Rename general lib utilities to utils
  {
    regex: /@\/lib\//g,
    replace: "@/utils/"
  }
];

let modifiedCount = 0;

walkDir(srcDir, filePath => {
  if (filePath.endsWith('.js') || filePath.endsWith('.jsx')) {
    let content = fs.readFileSync(filePath, 'utf8');
    let original = content;

    for (const r of replacements) {
      content = content.replace(r.regex, r.replace);
    }

    if (content !== original) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`Refactored: ${path.relative(srcDir, filePath)}`);
      modifiedCount++;
    }
  }
});

console.log(`Done! Refactored ${modifiedCount} files.`);
