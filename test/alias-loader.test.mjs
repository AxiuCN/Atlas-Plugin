// 别名层回归（**数据无关**：不需要图鉴数据，只需要本仓库自带的 resources/alias + 可选的 miao/ZZZ 预设）
//   钉住 model/AliasLoader.js 的对外语义（含版本号 / 过滤缓存 / 归一化补全后的行为）：
//     ① 归一化：normalizeForMatch 去空格/六种间隔号/括号/引号 + 小写；normalizeKeyword 去前缀与「图鉴」
//     ② 表性质：键为归一化形态且不含间隔号、条目带 {value,game,source}、Atlas 预设层生效
//     ③ 按游戏过滤：只留本游戏与通用条目；全量表与过滤表不同引用；同 gameId 命中缓存
//     ④ buildKeywordVariants 双向展开 + game 过滤 + 去重
//     ⑤ 覆盖语义：高来源替换低来源（用临时自定义 YAML，跑完回退）
//     ⑥ reload 契约：重建后 Map 换新；watcher 幂等
//     ⑦ 版本号：reload 后 +1，过滤表随之失效、内容与缓存实例保持一致
import fs from 'node:fs'
import path from 'node:path'
import { mod, pluginRoot, checker, installFrameworkStubs, logs } from './_helper.mjs'

installFrameworkStubs()

const {
  loadAliasMap,
  reloadAliasMap,
  getAliasVersion,
  buildKeywordVariants,
  normalizeForMatch,
  normalizeKeyword,
  initAliasWatcher,
  isSignatureKeyword,
  signatureLabelMarker,
  resolveSignatureWeapons
} = await import(mod('model/AliasLoader.js'))
const aliasApi = await import(mod('modules/aliasApi.js'))

const { check, finish } = checker()

/** 日志里出现某段文字的次数 */
const logCount = (text) => logs.filter(args => String(args?.[0] ?? '').includes(text)).length

/* ============================================================
 *  A. 归一化
 * ============================================================ */
console.log('=== A. 归一化语义 ===')
check('去空格 + 小写', normalizeForMatch('Hu  Tao') === 'hutao', normalizeForMatch('Hu  Tao'))
check('去间隔号 ·', normalizeForMatch('知更鸟·晴歌') === '知更鸟晴歌', normalizeForMatch('知更鸟·晴歌'))
check('去间隔号 ・', normalizeForMatch('知更鸟・晴歌') === '知更鸟晴歌', normalizeForMatch('知更鸟・晴歌'))
check('去括号/引号/书名号', normalizeForMatch('「三月七」『(存护)』') === '三月七存护', normalizeForMatch('「三月七」『(存护)』'))
check('空值安全', normalizeForMatch(undefined) === '' && normalizeForMatch(null) === '')
// 间隔号六种变体必须等价（`•` U+2022 是 miao 侧角色名的实际写法：丹恒•饮月 / 阮•梅）
for (const sep of ['·', '・', '•', '‧', '⋅', '∙']) {
  check(`间隔号 ${sep}(U+${sep.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}) 归一`, normalizeForMatch(`知更鸟${sep}晴歌`) === '知更鸟晴歌', normalizeForMatch(`知更鸟${sep}晴歌`))
}
check('normalizeKeyword 去 # 前缀', normalizeKeyword('#胡桃') === '胡桃')
check('normalizeKeyword 去「图鉴」', normalizeKeyword('#图鉴胡桃') === '胡桃')
check('normalizeKeyword 去 * 前缀', normalizeKeyword('*符玄') === '符玄')
check('normalizeKeyword 去「Lotus图鉴」', normalizeKeyword('#Lotus图鉴胡桃') === '胡桃')
check('normalizeKeyword 保留内部字符', normalizeKeyword('  胡桃 天赋 ') === '胡桃 天赋', normalizeKeyword('  胡桃 天赋 '))

/* ============================================================
 *  B. 别名表基本性质（只依赖仓库内的预设层）
 * ============================================================ */
console.log('\n=== B. 别名表性质 ===')
const fullMap = loadAliasMap()
check('表非空', fullMap instanceof Map && fullMap.size > 0, `${fullMap?.size} 键`)
check('全量表复用同一实例（缓存）', loadAliasMap() === fullMap)

const presetKey = normalizeForMatch('火套')
const presetHits = (loadAliasMap('gi').get(presetKey) || []).map(item => item.value)
check('Atlas 预设层生效：火套 → 炽烈的炎之魔女', presetHits.includes('炽烈的炎之魔女'), presetHits.join('/'))

const typoKey = normalizeForMatch('冰封迷途的勇士')
const typoHits = (loadAliasMap('gi').get(typoKey) || []).map(item => item.value)
check('预设层的错字修正：冰封迷途的勇士 → 冰风迷途的勇士', typoHits.includes('冰风迷途的勇士'), typoHits.join('/'))
const keyIsNormalized = [...fullMap.keys()].every(key => normalizeForMatch(key) === key)
check('所有键已是归一化形态（幂等）', keyIsNormalized)
const separators = ['·', '・', '•', '‧', '⋅', '∙']
check('键中不含任何间隔号（六种变体）', [...fullMap.keys()].every(key => !separators.some(s => key.includes(s))))

const entryShapeOk = [...fullMap.values()].every(list => list.every(item =>
  typeof item.value === 'string' && item.value.length > 0 &&
  typeof item.game === 'string' &&
  typeof item.source === 'number'
))
check('每条目形状 = {value, game, source}', entryShapeOk)

const sources = new Set([...fullMap.values()].flat().map(item => item.source))
check('来源编号只在 0~3 内', [...sources].every(s => s >= 0 && s <= 3), [...sources].join(','))

/* ============================================================
 *  C. 按游戏过滤
 * ============================================================ */
console.log('\n=== C. 按游戏过滤 ===')
const giMap = loadAliasMap('gi')
const zzzMap = loadAliasMap('zzz')
check('过滤表是新实例（非全量表引用）', giMap !== fullMap && zzzMap !== fullMap)
check('同一 gameId 的过滤表命中缓存（同一实例）', loadAliasMap('gi') === giMap)
check('原神过滤表只含原神/通用条目', [...giMap.values()].flat().every(item => !item.game || item.game === '原神'))
check('绝区零过滤表只含绝区零/通用条目', [...zzzMap.values()].flat().every(item => !item.game || item.game === '绝区零'))

// 运行时取样：找一个同时挂着两个游戏条目的键（如「男主」），验证它按游戏被拆开
const crossEntry = [...fullMap.entries()].find(([, list]) =>
  new Set(list.map(item => item.game).filter(Boolean)).size > 1)
if (crossEntry) {
  const [crossKey, crossList] = crossEntry
  const games = [...new Set(crossList.map(item => item.game).filter(Boolean))]
  const giOnly = (giMap.get(crossKey) || []).map(item => item.game).filter(Boolean)
  // 取样有效性：跨游戏键必须同时含原神与星铁，否则这条断言没有意义
  check(`跨游戏取样有效（${crossKey}：${games.join('/')}）`, games.includes('原神') && games.includes('星铁'), games.join('/'))
  // 不能只写 every：giOnly 为空时 every 恒真（空数组误通过）
  check(`跨游戏键按 game 拆开（${crossKey}）`,
    giOnly.length > 0 && giOnly.every(g => g === '原神'), giOnly.join('/') || '空')
} else {
  console.log('  ⏭ 跳过跨游戏取样：当前表中没有同时挂两个游戏条目的键')
}

/* ============================================================
 *  D. buildKeywordVariants
 * ============================================================ */
console.log('\n=== D. 关键词变体 ===')
const synthetic = new Map([
  ['风套', [{ value: '翠绿之影', game: '原神', source: 2 }]],
  ['男主', [
    { value: '旅行者', game: '原神', source: 0 },
    { value: '{NICKNAME}', game: '星铁', source: 0 }
  ]]
])
const v1 = buildKeywordVariants('风套', synthetic, '原神')
check('展开原词与别名', v1.some(v => v.raw === '风套' && v.alias === false) && v1.some(v => v.raw === '翠绿之影' && v.alias === true),
  v1.map(v => `${v.raw}${v.alias ? '(别名)' : ''}`).join(' / '))
check('每个变体都带归一化 key', v1.every(v => v.key === normalizeForMatch(v.raw)))

const v2 = buildKeywordVariants('男主', synthetic, '原神')
check('按游戏过滤掉异游戏别名', !v2.some(v => v.raw === '{NICKNAME}') && v2.some(v => v.raw === '旅行者'))
const v3 = buildKeywordVariants('男主', synthetic, '')
check('game 为空时不按游戏过滤', v3.some(v => v.raw === '{NICKNAME}') && v3.some(v => v.raw === '旅行者'))

const v4 = buildKeywordVariants('胡桃', new Map(), '原神')
check('空表时只返回原词', v4.length === 1 && v4[0].raw === '胡桃' && v4[0].alias === false)
check('不支持的关键词也安全', buildKeywordVariants('不存在的东西', new Map()).length === 1)

/* ============================================================
 *  E. 覆盖语义：高来源替换低来源（临时自定义 YAML，跑完回退）
 * ============================================================ */
console.log('\n=== E. 覆盖语义 ===')
const customGameDir = path.join(pluginRoot, 'config', 'alias', 'gi')
const customFile = path.join(customGameDir, '_alias-loader-test.yaml')
/** 清理临时夹具（失败不影响断言结果，由后续「未残留」断言体现） */
function cleanupCustomFixture () {
  try {
    if (fs.existsSync(customFile)) fs.rmSync(customFile, { force: true })
    if (fs.existsSync(customGameDir) && fs.readdirSync(customGameDir).length === 0) fs.rmdirSync(customGameDir)
    reloadAliasMap()
  } catch {
    // 忽略：清理失败由「未残留」断言兜底
  }
}

// 只有「写不进去」才算环境缺失（跳过）；写入成功后，任何异常都属于覆盖语义没验证成功，必须转红
let canWrite = true
try {
  fs.mkdirSync(customGameDir, { recursive: true })
  // 自定义层（source 3）把「火套」改指甘雨，应整体替换预设层（source 2）的炽烈的炎之魔女
  fs.writeFileSync(customFile, '甘雨: 火套\n')
} catch (err) {
  canWrite = false
  console.log(`  ⏭ 跳过覆盖语义用例（无法写入临时自定义 YAML）：${err.message}`)
  cleanupCustomFixture()
}

if (canWrite) {
  try {
    reloadAliasMap()
    const overridden = (loadAliasMap('gi').get(presetKey) || []).map(item => item.value)
    check('高来源整体替换低来源', overridden.includes('甘雨') && !overridden.includes('炽烈的炎之魔女'), overridden.join('/'))

    // 删掉自定义文件后重建 → 自动回退到预设层（删除后重建自动回退）
    fs.rmSync(customFile, { force: true })
    reloadAliasMap()
    const restored = (loadAliasMap('gi').get(presetKey) || []).map(item => item.value)
    check('删除自定义后回退到预设层', restored.includes('炽烈的炎之魔女') && !restored.includes('甘雨'), restored.join('/'))
  } catch (err) {
    check('覆盖语义用例执行未抛错', false, err.message)
  } finally {
    cleanupCustomFixture()
  }
}
check('清理后未残留临时自定义文件', !fs.existsSync(customFile))

/* ============================================================
 *  F. reload 契约与 watcher 幂等
 * ============================================================ */
console.log('\n=== F. reload 契约 ===')
const before = loadAliasMap()
reloadAliasMap()
const after = loadAliasMap()
check('reload 后全量表换新实例', before !== after && after.size > 0)
const reloadedGi = loadAliasMap('gi')
check('reload 后过滤表也换新', reloadedGi !== giMap && reloadedGi.size > 0)

const watcherBefore = logCount('别名热更新监听已启动')
initAliasWatcher()
initAliasWatcher()
const watcherAfter = logCount('别名热更新监听已启动')
check('watcher 已随首次加载启动', watcherBefore >= 1, `${watcherBefore} 次`)
check('watcher 幂等（重复调用不重复启动）', watcherAfter === watcherBefore, `${watcherBefore} → ${watcherAfter}`)

/* ============================================================
 *  G. 版本号与过滤缓存的一致性（② 新增能力）
 * ============================================================ */
console.log('\n=== G. 版本号与缓存一致性 ===')
const versionBefore = getAliasVersion()
check('版本号是正整数', Number.isInteger(versionBefore) && versionBefore > 0, String(versionBefore))

const staleGi = loadAliasMap('gi')
const versionStable = getAliasVersion()
loadAliasMap('gi')
check('读取过滤表不会触发重建（版本不变）', getAliasVersion() === versionStable, `${versionStable}`)

reloadAliasMap()
const versionAfter = getAliasVersion()
check('reload 后版本号 +1', versionAfter === versionBefore + 1, `${versionBefore} → ${versionAfter}`)

const freshGi = loadAliasMap('gi')
check('reload 后过滤表不复用旧缓存', freshGi !== staleGi && freshGi.size > 0, `${staleGi.size} → ${freshGi.size}`)
check('reload 后过滤表内容仍正确（Atlas 预设层在）',
  (freshGi.get(normalizeForMatch('火套')) || []).some(item => item.value === '炽烈的炎之魔女'))
check('重建后同 gameId 仍命中稳定实例', loadAliasMap('gi') === freshGi)
check('全量表与过滤表版本同源（无独立计数）', getAliasVersion() === versionAfter)

/* ============================================================
 *  H. 对外门面 modules/aliasApi.js（③）
 * ============================================================ */
console.log('\n=== H. 对外门面 contract ===')
check('契约版本 = 1', aliasApi.ALIAS_API_VERSION === 1, String(aliasApi.ALIAS_API_VERSION))

const apiFull = aliasApi.getAliasMap()
check('getAliasMap() 返回副本（不是内部表）', apiFull !== loadAliasMap() && apiFull.size === loadAliasMap().size)
check('getAliasMap() 同版本内是稳定实例', aliasApi.getAliasMap() === apiFull)
const apiGi = aliasApi.getAliasMap('gi')
check('getAliasMap(gameId) 返回过滤快照（不是内部过滤表）', apiGi !== loadAliasMap('gi') && apiGi.size === loadAliasMap('gi').size)
check('getAliasMap 未知 gameId 退化为全量快照', aliasApi.getAliasMap('xx') === apiFull)

// 只读契约：set / delete / clear 必须被拒绝，且拒绝后内容完整（P1 回归）
const snapshotKey = '不存在的污染键'
const throwsTypeError = (fn) => {
  try {
    fn()
    return false
  } catch (err) {
    return err instanceof TypeError
  }
}
check('快照不是可写的 Map（instanceof Map 为假）', !(apiFull instanceof Map))
check('快照 set 被拒绝（抛 TypeError）', throwsTypeError(() => apiFull.set(snapshotKey, [{ value: '污染', game: '原神', source: 3 }])))
check('快照 delete 被拒绝（抛 TypeError）', throwsTypeError(() => apiFull.delete(normalizeForMatch('火套'))))
check('快照 clear 被拒绝（抛 TypeError）', throwsTypeError(() => apiFull.clear()))
check('写入被拒后同版本快照内容仍完整',
  aliasApi.getAliasMap() === apiFull && apiFull.size === loadAliasMap().size && apiFull.has(normalizeForMatch('火套')))
check('快照仍可正常读取（size / has / get / 迭代）',
  apiFull.get(normalizeForMatch('火套'))?.some(item => item.value === '炽烈的炎之魔女') === true &&
  [...apiFull.keys()].length === apiFull.size)
check('可用 new Map(view) 取可变副本', new Map(apiFull).size === apiFull.size)

const snapshotList = [...apiFull.values()][0]
let arrayFrozen = false
try {
  snapshotList.push({ value: '污染', game: '原神', source: 3 })
} catch {
  arrayFrozen = true
}
check('快照条目数组已冻结（push 抛错）', arrayFrozen && Object.isFrozen(snapshotList))
check('快照条目对象已冻结', snapshotList.length > 0 && Object.isFrozen(snapshotList[0]))

// 封装绕过入口：不能留可访问的底层 Map（公开字段 / forEach 第三参都会把 Map 交出去）
check('视图没有可访问的内部 Map 字段', !('_map' in apiFull) && !('map' in apiFull) && Object.keys(apiFull).length === 0)
let forEachThird = null
apiFull.forEach((value, key, map) => { if (!forEachThird) forEachThird = map })
check('forEach 第三参是视图本身（不是底层 Map）', forEachThird === apiFull && !(forEachThird instanceof Map))
check('forEach 第三参写入被拒（抛 TypeError）', throwsTypeError(() => forEachThird.clear()))
check('两种绕过尝试后快照内容仍完整',
  apiFull.size === loadAliasMap().size && apiFull.has(normalizeForMatch('火套')))

/* ============================================================
 *  I. 专武索引（「<角色>专武」→ 武器；支持别名、全名、多把、修饰词）
 * ============================================================ */
console.log('\n=== I. 专武解析 ===')
check('isSignatureKeyword 识别后缀', isSignatureKeyword('胡桃专武') && isSignatureKeyword('温迪新专武') && !isSignatureKeyword('胡桃'))
check('signatureLabelMarker 区分修饰词', signatureLabelMarker('温迪新专武') === '新' && signatureLabelMarker('胡桃专武') === '')

const sigOf = (name, game) => resolveSignatureWeapons(name, game).map(item => `${item.weapon}(${item.label})`)
check('官方名直查：胡桃 → 护摩之杖', sigOf('胡桃', 'gi').join() === '护摩之杖(专武)', sigOf('胡桃', 'gi').join())
check('别名闭合：雷神 → 薙草之稻光（经雷电将军专武）', sigOf('雷神', 'gi').join() === '薙草之稻光(专武)', sigOf('雷神', 'gi').join())
check('全名闭合：枫原万叶 → 苍古自由之誓（经万叶专武）', sigOf('枫原万叶', 'gi').join() === '苍古自由之誓(专武)', sigOf('枫原万叶', 'gi').join())
check('多把专武：温迪 → 2 条且带修饰词',
  sigOf('温迪', 'gi').join() === '终末嗟叹之诗(专武),黎明破晓之史(新专武)', sigOf('温迪', 'gi').join())
check('未登记专武的角色返回空：阿罗夏', resolveSignatureWeapons('阿罗夏', 'gi').length === 0)
check('修饰词过滤：温迪新专武 → 只有黎明破晓之史',
  resolveSignatureWeapons('温迪', 'gi', '新').map(x => x.weapon).join() === '黎明破晓之史', JSON.stringify(resolveSignatureWeapons('温迪', 'gi', '新')))
check('别名 + 修饰词：风神新专武 → 黎明破晓之史',
  resolveSignatureWeapons('风神', 'gi', '新').map(x => x.weapon).join() === '黎明破晓之史', JSON.stringify(resolveSignatureWeapons('风神', 'gi', '新')))
check('别名（无修饰）：风神 → 终末嗟叹之诗 + 黎明破晓之史',
  resolveSignatureWeapons('风神', 'gi').map(x => x.label).join() === '专武,新专武', JSON.stringify(resolveSignatureWeapons('风神', 'gi')))
check('修饰词无对应条目时返回空', resolveSignatureWeapons('胡桃', 'gi', '新').length === 0)
check('星铁 aliasCfg 已加载：黄泉 → 行于流逝的岸', sigOf('黄泉', 'hsr').join() === '行于流逝的岸(专武)', sigOf('黄泉', 'hsr').join())
check('按游戏过滤：胡桃 在 zzz 无结果', resolveSignatureWeapons('胡桃', 'zzz').length === 0)
check('绝区零暂无专武登记：雅 → 空', resolveSignatureWeapons('雅', 'zzz').length === 0)
check('空输入安全', resolveSignatureWeapons('', 'gi').length === 0 && resolveSignatureWeapons(undefined).length === 0)

// 索引随 reload 重建
const sigBefore = sigOf('雷神', 'gi').join()
reloadAliasMap()
check('reload 后专武索引仍可用', sigOf('雷神', 'gi').join() === sigBefore && sigBefore.length > 0, sigBefore)

const resolved = aliasApi.resolveAlias('风套', 'gi')
check('resolveAlias 命中别名（风套 → 翠绿之影）',
  resolved.key === '风套' && resolved.candidates.includes('翠绿之影') && resolved.primary === '翠绿之影',
  JSON.stringify(resolved.candidates))
const dotMixed = aliasApi.resolveAlias('知更鸟·晴歌', 'hsr')
check('resolveAlias 对 •/· 混写生效（知更鸟·晴歌 命中）',
  dotMixed.candidates.length > 0, JSON.stringify(dotMixed.candidates))
check('resolveAlias 未命中返回空结构',
  JSON.stringify(aliasApi.resolveAlias('绝对不存在的名字')) === JSON.stringify({ key: '绝对不存在的名字', candidates: [], primary: null }))
const emptyCases = [undefined, null, '', '   '].map(v => aliasApi.resolveAlias(v))
check('resolveAlias 空/缺失入参返回空结构', emptyCases.every(r => r.primary === null && r.candidates.length === 0))
// 数字入参不抛错；若恰好是合法别名（表里存在 "123" → 伊安珊）则正常返回
const numeric = aliasApi.resolveAlias(123)
check('resolveAlias 数字入参不抛错且形状合法', typeof numeric.key === 'string' && Array.isArray(numeric.candidates))

const expanded = aliasApi.expandKeyword('风套', 'gi')
check('expandKeyword 展开原词与别名',
  expanded.some(v => v.raw === '风套') && expanded.some(v => v.raw === '翠绿之影'))
const emptyExpand = aliasApi.expandKeyword('', 'gi')
check('expandKeyword 空输入返回单元素兜底', Array.isArray(emptyExpand) && emptyExpand.length === 1)

check('门面版本号与 Atlas 一致', aliasApi.getAliasVersion() === getAliasVersion(), `${aliasApi.getAliasVersion()}`)
const status = aliasApi.getAliasStatus()
check('getAliasStatus 形状完整',
  Number.isInteger(status.version) && status.keys > 0 && status.entries >= status.keys &&
  ['gi', 'hsr', 'zzz'].every(g => Number.isInteger(status.games[g])),
  `v${status.version} / ${status.keys} 键 / ${status.entries} 条目`)

const versionBeforeCalls = aliasApi.getAliasVersion()
aliasApi.getAliasMap('gi'); aliasApi.resolveAlias('风套', 'gi'); aliasApi.expandKeyword('风套', 'gi'); aliasApi.getAliasStatus()
check('门面调用不触发重建（版本不变）', aliasApi.getAliasVersion() === versionBeforeCalls, `${versionBeforeCalls}`)

finish()
