'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
if(Number(process.versions.node.split('.')[0])<24)throw new Error('Node.js 24+ kerak.');
try{require.resolve('playwright');}catch{
  const bundled=path.join(os.homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','node','node_modules');
  if(fs.existsSync(path.join(bundled,'playwright','package.json'))){
    process.env.NODE_PATH=[process.env.NODE_PATH,bundled].filter(Boolean).join(path.delimiter);
    require('node:module').Module._initPaths();
  }
  try{require.resolve('playwright');}catch{throw new Error('Playwright topilmadi. Loyiha papkasida npm ci bajaring.');}
}
