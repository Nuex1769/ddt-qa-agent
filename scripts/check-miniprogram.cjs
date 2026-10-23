const { readdirSync, readFileSync, existsSync, mkdtempSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { Script } = require('node:vm')
const { execFileSync } = require('node:child_process')
const root = resolve(__dirname, '../miniprogram')

function check(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const file = join(directory, entry.name)
    if (entry.isDirectory()) check(file)
    else if (entry.name.endsWith('.json')) JSON.parse(readFileSync(file, 'utf8'))
    else if (entry.name.endsWith('.js')) new Script(readFileSync(file, 'utf8'), { filename: file })
  }
}
check(root)
const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8'))
for (const page of app.pages) {
  for (const extension of ['.js', '.wxml', '.wxss']) {
    if (!existsSync(join(root, page + extension))) throw new Error('缺少页面文件：' + page + extension)
  }
}
const compilerRoot = '/Applications/wechatwebdevtools.app/Contents/Resources/app.asar.unpacked/node_modules/wcc-exec'
if (existsSync(join(compilerRoot, 'wcc')) && existsSync(join(compilerRoot, 'wcsc'))) {
  const output = mkdtempSync(join(tmpdir(), 'tavern-compile-'))
  try {
    execFileSync(join(compilerRoot, 'wcc'), ['-o', join(output, 'wxml.js'), ...app.pages.map((p) => p + '.wxml')], { cwd: root, stdio: 'pipe' })
    execFileSync(join(compilerRoot, 'wcsc'), ['-o', join(output, 'wxss.js'), 'app.wxss', ...app.pages.map((p) => p + '.wxss')], { cwd: root, stdio: 'pipe' })
    console.log('小程序 JavaScript / JSON 检查、WXML / WXSS 编译通过。')
  } finally { rmSync(output, { recursive: true, force: true }) }
} else {
  console.log('小程序 JavaScript / JSON 检查通过；未找到微信编译器，未验证 WXML / WXSS 编译。')
}
