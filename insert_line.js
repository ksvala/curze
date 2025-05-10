const fs = require('fs'); const content = fs.readFileSync('src/extension.ts', 'utf8'); const lines = content.split('
'); const lineIndex = 1056; const newLine = '											// 新增：为聊天记录面板注册消息监听'; lines.splice(lineIndex, 0, newLine); fs.writeFileSync('src/extension.ts', lines.join('
')); console.log('Line inserted at', lineIndex);
