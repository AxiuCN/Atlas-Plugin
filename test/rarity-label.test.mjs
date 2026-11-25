// 稀有度展示（原神 / 星铁）回归：记录里是游戏枚举或数字，展示统一成「N星」
//
// 背景：换 Hesperides 后记录来自游戏原始数据，`rank` 变成 `QUALITY_ORANGE` /
// `CombatPowerAvatarRarityType5` 这类枚举（旧后端的 meta.rarity 是「五星」中文）。
// 本套件锁住「枚举 / 数字 / 数组 / 中文」四种输入 → 星级中文，以及绝区零仍是 S/A/B/C。
import { mod, requireAtlasData, checker, installFrameworkStubs } from './_helper.mjs'

installFrameworkStubs()
const { rarityNumber, rarityLabel, zzzRank } = await import(mod('components/constants.js'))
const { check, finish } = checker()

console.log('=== ① 枚举 → 星级（数据无关）===')
const ENUMS = [
  ['QUALITY_ORANGE', 5, '五星'],
  ['QUALITY_ORANGE_SP', 5, '五星'],
  ['QUALITY_PURPLE', 4, '四星'],
  ['QUALITY_BLUE', 3, '三星'],
  ['QUALITY_GREEN', 2, '二星'],
  ['QUALITY_GREY', 1, '一星'],
  ['CombatPowerAvatarRarityType5', 5, '五星'],
  ['CombatPowerAvatarRarityType4', 4, '四星'],
  ['CombatPowerLightconeRarity5', 5, '五星'],
  ['CombatPowerLightconeRarity3', 3, '三星']
]
for (const [raw, num, label] of ENUMS) {
  check(`${raw} → ${label}`, rarityNumber(raw) === num && rarityLabel(raw) === label, `${rarityNumber(raw)} / ${rarityLabel(raw)}`)
}

console.log('\n=== ② 数字 / 数组 / 中文 ===')
check('数字 5 → 五星', rarityLabel(5) === '五星')
check('数组取最高档（圣遗物 [4,5]）', rarityNumber([4, 5]) === 5 && rarityLabel([4, 5]) === '五星')
check('中文原样（索引补丁写的「三星」）', rarityLabel('三星') === '三星')
check('字符串数字 "4" → 四星', rarityLabel('4') === '四星')
check('0 / 空 / null / 未知一律不出星级',
  rarityLabel(0) === '' && rarityLabel('') === '' && rarityLabel(null) === '' && rarityLabel('unknown') === '',
  [rarityLabel(0), rarityLabel(''), rarityLabel(null), rarityLabel('unknown')].join('|'))
check('越界数字夹到 5', rarityNumber(9) === 5)

console.log('\n=== ③ 绝区零不受影响（仍是 S/A/B/C）===')
check('zzz 4 档 → S', zzzRank(4, 'character') === 'S')
check('zzz 1 档 → C', zzzRank(1, 'character') === 'C')
check('zzz「四星」也能认出', zzzRank('四星', 'character') === 'S')

requireAtlasData()

console.log('\n=== ④ 详情页接线（真实数据，运行时取样）===')
{
  const { loadRecord, search, getPageRecords } = await import(mod('model/AtlasService.js'))
  const { buildDetailData } = await import(mod('components/queryUtils.js'))

  for (const [gameId, pageKey] of [['gi', 'character'], ['gi', 'weapon'], ['hsr', 'character'], ['hsr', 'lightcone']]) {
    // 取样口径：索引里该页第一条，不写死角色名
    const entry = getPageRecords(gameId, pageKey)[0]
    if (!entry) { check(`${gameId}/${pageKey} 有可取样条目`, false); continue }
    const record = loadRecord(entry.filePath)
    const data = buildDetailData(gameId, { ...entry, record })
    const shown = data.hero?.rarity || data.rarity || ''
    check(`${gameId}/${pageKey} 稀有度已转中文`, /^[一二三四五]星$/.test(shown), `${entry.name}: ${JSON.stringify(shown)}`)
  }

  // 绝区零仍走评级
  const zzzEntry = search('zzz', '艾莲')?.results?.[0] || getPageRecords('zzz', 'character')[0]
  if (zzzEntry) {
    const data = buildDetailData('zzz', { ...zzzEntry, record: loadRecord(zzzEntry.filePath) })
    check('绝区零详情页仍是 S/A/B/C', /^[SABCD]$/.test(data.hero?.rarity || data.rarity || ''),
      `${zzzEntry.name}: ${data.hero?.rarity || data.rarity}`)
  }
}

finish()