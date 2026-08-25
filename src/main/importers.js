const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');

async function importPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const title = path.basename(filePath, path.extname(filePath));
  let body;
  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ path: filePath });
    body = result.value;
  } else {
    body = fs.readFileSync(filePath, 'utf8');
  }
  body = body.replace(/\r\n?/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim() + '\n';
  return { title, body };
}

module.exports = { importPath };
