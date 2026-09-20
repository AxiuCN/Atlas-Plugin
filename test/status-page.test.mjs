// #图鉴状态 的「角色攻略」卡回归：真实 buildStatusData() + art-template 渲染两个分支
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
console.log('真实 buildStatusData().codex =', JSON.stringify(real?.codex))

const tpl = fs.readFileSync(path.join(pluginRoot, 'resources/atlas/status.html'), 'utf8')
const render = (codex) => template.render(tpl, {
  ...real,
  codex,
  _res_path: pathToFileURL(path.join(pluginRoot, 'resources')).href
})

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`)
  ok ? pass++ : fail++
}

console.log('\n=== 未拉取分支 ===')
const unready = render({ ready: false, total: 0, summary: '' })
fs.writeFileSync(path.join(tmpDir, 'status-codex-unready.html'), unready)
check('含「角色攻略」卡', unready.includes('<h3>角色攻略</h3>'))
check('显示「未拉取」', unready.includes('未拉取'))
check('给出拉取方式', unready.includes('#图鉴初始化 / #图鉴更新'))

console.log('\n=== 已拉取分支 ===')
const ready = render({ ready: true, total: 12, summary: '原神 5 · 星铁 4 · 通用 3' })
fs.writeFileSync(path.join(tmpDir, 'status-codex-ready.html'), ready)
check('含「角色攻略」卡', ready.includes('<h3>角色攻略</h3>'))
check('显示「已拉取」', ready.includes('已拉取'))
check('显示卡片数', ready.includes('12 张'))
check('显示游戏分布', ready.includes('原神 5 · 星铁 4 · 通用 3'))

console.log(`\n结果：通过 ${pass} / 失败 ${fail}`)
process.exit(fail === 0 ? 0 : 1)
