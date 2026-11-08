// 模块加载冒烟：改动引入的 import 边是否造成环或加载错误，导出面是否齐全
// 数据无关：只 import 模块、不查数据（ensureIndex 由查询触发，import 不触发）
import { mod, installFrameworkStubs } from './_helper.mjs'

installFrameworkStubs()

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++
  console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? `  ${extra}` : ''}`)
}

const targets = [
  ['model/AtlasService.js', null],
  ['model/AtlasRepository.js', 'loadRecord'],
  ['model/Hesperides.js', 'getHesperidesPeriods'],
  ['model/HesperidesIndex.js', 'getHesperidesMap'],
  ['model/HesperidesRepository.js', 'loadLegacyRecord'],
  ['model/AtlasUpdater.js', null],
  ['model/ChallengePeriod.js', 'getCurrentPeriod'],
  ['model/ChallengeVersion.js', 'getVersionAt'],
  ['model/LinkResolver.js', null],
  ['model/MiaoParams.js', null],
  ['model/ItemAssets.js', 'getItemName'],
  ['model/NewContent.js', 'buildNewContentModel'],
  ['model/Submodules.js', 'syncSubmodules'],
  ['model/LegacyCleanup.js', 'runLegacyCleanup'],
  ['model/itemIndex/gi.js', null],
  ['model/itemIndex/hsr.js', null],
  ['model/itemIndex/zzz.js', null],
  ['model/monsterIndex/index.js', null],
  ['model/monsterIndex/levelTable.js', null],
  ['modules/atlasQuery.js', 'handleQuery'],
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
