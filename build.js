import fs from 'fs';
import path from 'path';

const distDir = path.resolve('dist');

if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const file of fs.readdirSync(src)) {
      copyRecursive(path.join(src, file), path.join(dest, file));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

const filesToCopy = ['index.html', 'sw.js', 'manifest.json'];
for (const file of filesToCopy) {
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, path.join(distDir, file));
  }
}

const dirsToCopy = ['css', 'js', 'lib'];
for (const dir of dirsToCopy) {
  if (fs.existsSync(dir)) {
    copyRecursive(dir, path.join(distDir, dir));
  }
}

console.log('✅ Static build complete: all assets copied to dist/');
