// 数据更新后的缓存失效回归
//   断言：reloadIndex() 后各模块自持的派生缓存必须重建为新对象（不重建 = 更新后仍按旧数据渲染）
//   同时断言：未触发 reloadIndex 时缓存仍被复用（没退化成每次重建）
import { mod, requireAtlasData, checker, installFrameworkStubs } from './_helper.mjs'

installFrameworkStubs()
requireAtlasData()

const { reloadIndex, search } = await import(mod('model/AtlasService.js'))
const mapLoader = await import(mod('model/itemIndex/mapLoader.js'))
const gi = await import(mod('model/itemIndex/gi.js'))
const zzz = await import(mod('model/itemIndex/zzz.js'))
const monsterIndex = await import(mod('model/monsterIndex/index.js'))
const levelTable = await import(mod('model/monsterIndex/levelTable.js'))
const { loadLinkIndex } = await import(mod('model/LinkResolver.js'))
const { check, finish } = checker()

/** 取一轮「可观测身份」的缓存快照 */
const snapshot = () => {
  const map = mapLoader.loadMap()
  const monsterPath = Object.values(map?.games?.gi?.locales?.zh?.pages?.monster?.records || {})[0]?.path || ''
  return {
    mapLoaderMap: map,
    itemRecords: mapLoader.getItemRecords('gi'),
    itemAllRecords: mapLoader.getItemAllRecords('gi'),
    relicIcon: gi.getGIRelicByIcon('UI_RelicIcon_10005_4'),
    zzzIcon: zzz.getZZZItemIcon(100),
    monsterVariants: monsterIndex.getMonsterVariants('gi', monsterPath),
    linkIndex: loadLinkIndex('gi'),
    // 非身份可观测的，取数值做「数据未变时结果不变」的冒烟对照
    giName: gi.getGIItemName(202),
    zzzName: zzz.getZZZItemName(100),
    monsterCount: monsterIndex.listMonsterEntries('zzz').length,
    levelRatio: JSON.stringify(levelTable.hsrLevelRatio(1, 95)),
    searchTop: search('gi', '胡桃')?.results?.[0]?.name || ''
  }
}

reloadIndex()
const first = snapshot()

console.log('=== ① 未触发重载：缓存应被复用（不会每次重建）===')
const again = snapshot()
check('mapLoader.loadMap() 复用同一对象', first.mapLoaderMap === again.mapLoaderMap)
check('item records 复用', first.itemRecords === again.itemRecords)
check('圣遗物部件图标表复用', first.relicIcon === again.relicIcon)
check('文本链接索引复用', first.linkIndex === again.linkIndex)
check('怪物变体数组复用', first.monsterVariants === again.monsterVariants)

console.log('\n=== ② reloadIndex()：全部派生缓存必须换新 ===')
reloadIndex()
const after = snapshot()
check('mapLoader.loadMap() 换新', first.mapLoaderMap !== after.mapLoaderMap)
check('item records 换新', first.itemRecords !== after.itemRecords)
check('item_all records 换新', first.itemAllRecords !== after.itemAllRecords)
check('圣遗物部件图标表换新', first.relicIcon !== after.relicIcon && Boolean(after.relicIcon))
check('ZZZ 物品图标缓存换新（结果仍正确）', after.zzzIcon === first.zzzIcon)
check('文本链接索引换新', first.linkIndex !== after.linkIndex)
check('怪物变体数组换新', first.monsterVariants !== after.monsterVariants)
check('怪物条目仍取得到（数据未变则数量不变）', first.monsterCount === after.monsterCount,
  `${first.monsterCount} → ${after.monsterCount}`)

console.log('\n=== ③ 数据未变时结果不变（只换缓存、不换结论）===')
check('GI 素材名一致', first.giName === after.giName, `${first.giName} → ${after.giName}`)
check('ZZZ 素材名一致', first.zzzName === after.zzzName, `${first.zzzName} → ${after.zzzName}`)
check('星铁等级比率一致', first.levelRatio === after.levelRatio)
check('搜索首条一致', first.searchTop === after.searchTop, first.searchTop)

finish()
