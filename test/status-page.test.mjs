// #图鉴状态 状态页回归：真实 buildStatusData() + art-template 渲染一次
//
// 攻略（codex）卡已随攻略模块剥离至独立插件，本套件只保证状态页本身还能渲染、
// 且各游戏版本行都在、不再出现已剥离的卡片。
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import template from 'art-template'
import { mod, pluginRoot, tmpDir, ensureTmpDir, requireAtlasData, installFrameworkStubs } from './_helper.mjs'

installFrameworkStubs()
requireAtlasData()
ensureTmpDir()

const { buildStatusData } = await import(mod('components/status.js'))
const real = buildStatusData()

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`)
  ok ? pass++ : fail++
}

if (!real) {
  console.log('⏭ 跳过：图鉴数据未初始化（先执行 #图鉴初始化 / #图鉴更新）')
  process.exit(0)
}
console.log(`真实数据：${real.games.length} 个游戏｜图片 ${real.images.total} 张｜更新于 ${real.fetchedAt || '未知'}`)

const tpl = fs.readFileSync(path.join(pluginRoot, 'resources/atlas/status.html'), 'utf8')
const html = template.render(tpl, {
  ...real,
  _res_path: pathToFileURL(path.join(pluginRoot, 'resources')).href
})
fs.writeFileSync(path.join(tmpDir, 'status-page.html'), html)

console.log('\n=== 状态页渲染 ===')
check('渲染成功且无残留模板标记', html.includes('<html') && !html.includes('{{'))
for (const g of real.games) {
  check(`列出 ${g.name}（版本 ${g.version}）`, html.includes(g.name) && html.includes(g.version))
}
check('不再含已剥离的「角色攻略」卡', !html.includes('角色攻略'))

console.log(`\n结果：通过 ${pass} / 失败 ${fail}`)
process.exit(fail === 0 ? 0 : 1)
