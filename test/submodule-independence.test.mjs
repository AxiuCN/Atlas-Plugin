/**
 * 模块加载不依赖子模块的回归
 *
 * 背景：`model/AtlasUpdater.js` 曾在顶层静态 import 子模块的 `registry.mjs`。
 * 全新安装（子模块还没 init）时，整个插件加载直接失败 —— 而「同步子模块」的代码就在那个文件里，
 * 用户连 `#图鉴初始化` 都发不出去（死锁）。这里锁住两条：
 *   ① 生产代码里**不得有**对 `tool/Hesperides` 的静态 import（只允许动态 `import()`）
 *   ② 读子模块的模块本身能在「子模块不可用」时不抛
 */
import fs from 'node:fs'
import path from 'node:path'
import { mod, pluginRoot, checker, installFrameworkStubs } from './_helper.mjs'

installFrameworkStubs()

const { check, finish } = checker()

/** 生产代码目录（不含 test / resources / tool） */
const DIRS = ['', 'apps', 'components', 'model', 'modules']

console.log('=== ① 不得静态 import 子模块 ===')
const offenders = []
for (const dir of DIRS) {
  const full = path.join(pluginRoot, dir)
  if (!fs.existsSync(full)) continue
  for (const file of fs.readdirSync(full)) {
    if (!file.endsWith('.js')) continue
    const text = fs.readFileSync(path.join(full, file), 'utf8')
    // 静态 import / export from 才致命；动态 import('...') 在函数体内是允许的
    const staticImport = /^\s*(import|export)\s[^\n]*from\s*['"][^'"]*tool\/Hesperides/m.test(text)
    if (staticImport) offenders.push(`${dir ? dir + '/' : ''}${file}`)
  }
}
check('生产代码没有对子模块的静态 import', offenders.length === 0,
  offenders.length ? `违规：${offenders.join(', ')}` : '')
check('AtlasUpdater 用动态 import 读 registry',
  /await import\(\s*['"][^'"]*sources\/registry\.mjs['"]\s*\)/.test(
    fs.readFileSync(path.join(pluginRoot, 'model', 'AtlasUpdater.js'), 'utf8')))

console.log('\n=== ② 子模块不可用时也不抛 ===')
// 直接加载读子模块的模块：即便子模块缺失，import 本身也不该失败
for (const file of ['model/AtlasUpdater.js', 'model/startup.js', 'model/Submodules.js', 'model/LegacyCleanup.js']) {
  let ok = true
  let message = ''
  try {
    await import(mod(file) + '?probe=' + Date.now())
  } catch (err) {
    ok = false
    message = err.message
  }
  check(`${file} 可加载`, ok, message)
}

console.log('\n=== ③ 频道表可用时按运行时口径 ===')
const updater = await import(mod('model/AtlasUpdater.js'))
if (fs.existsSync(path.join(pluginRoot, 'tool/Hesperides/Hesperides/src/sources/registry.mjs'))) {
  const ids = await updater.runtimeChannelIds()
  check('运行时频道非空', ids.length > 0, `${ids.length} 个`)
  check('只含 nanoka 与玉璃终局（不含玉璃非终局页）',
    ids.every((id) => id.startsWith('nanoka:') || ['alioth:gi:abyss', 'alioth:gi:theater', 'alioth:gi:stygian',
      'alioth:hsr:chaos', 'alioth:hsr:fiction', 'alioth:hsr:as', 'alioth:hsr:arbitration'].includes(id)))
  const gi = await updater.runtimeChannelIds(['gi'])
  check('按游戏过滤生效', gi.length > 0 && gi.every((id) => id.includes(':gi:')), `${gi.length} 个 gi 频道`)
  const diff = await updater.diffChannelIds()
  check('diff 频道只取 page=diff', diff.every((id) => id.endsWith(':diff')), diff.join(', '))
} else {
  console.log('  ⏭ 子模块未初始化，跳过频道表断言')
}

finish()