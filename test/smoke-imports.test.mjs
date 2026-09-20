// 模块加载冒烟：改动引入的 import 边是否造成环或加载错误，导出面是否齐全
import { mod, requireAtlasData, installFrameworkStubs } from './_helper.mjs'

installFrameworkStubs()
requireAtlasData()

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++
  console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? `  ${extra}` : ''}`)
}

const targets = [
  ['model/AtlasService.js', null],
  ['model/AtlasUpdater.js', null],
  ['model/LinkResolver.js', null],
  ['model/MiaoParams.js', null],
  ['model/itemIndex/mapLoader.js', null],
  ['model/itemIndex/gi.js', null],
  ['model/itemIndex/hsr.js', null],
  ['model/itemIndex/zzz.js', null],
  ['model/monsterIndex/index.js', null],
  ['model/monsterIndex/levelTable.js', null],
  ['model/codexIndex/index.js', null],
  ['model/codexIndex/icons.js', null],
  ['modules/atlasQuery.js', 'handleQuery'],
  ['modules/codexQuery.js', 'handleCodexQuery'],
  ['apps/atlas.js', 'atlas'],
  ['apps/admin.js', 'AtlasAdmin'],
  ['apps/atlasShortcut.js', 'atlasShortcut'],
  ['apps/status.js', 'AtlasStatus'],
  ['components/status.js', 'renderStatusImage'],
  ['index.js', 'apps']
]

for (const [file, expectExport] of targets) {
  try {
    const target = await import(mod(file))
    const keys = Object.keys(target)
    const ok = !expectExport || keys.includes(expectExport)
    check(file, ok, ok ? '' : `导出 ${JSON.stringify(keys)} 缺少 ${expectExport}`)
  } catch (err) {
    check(file, false, `加载失败：${err.message}`)
  }
}

console.log(`\n结果：通过 ${pass} / 失败 ${fail}`)
process.exit(fail === 0 ? 0 : 1)
