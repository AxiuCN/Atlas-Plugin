// 武器外观（`record.skin === true`）回归
//
// 口径：外观是**独立图鉴条目**，不折叠到本体、不借本体星级，只在名字旁标一个「皮肤」方框；
// 它们没有 `atk` / `sub`，所以面板本来就为空——不额外造字段，也不拦着不让搜。
import fs from 'node:fs'
import path from 'node:path'
import template from 'art-template'
import { mod, requireAtlasData, checker, installFrameworkStubs, pluginRoot } from './_helper.mjs'

installFrameworkStubs()
requireAtlasData()

const { buildGIWeapon } = await import(mod('components/sections/weapon/gi.js'))
const { search, getPageRecords } = await import(mod('model/AtlasService.js'))
const { loadRecord } = await import(mod('model/AtlasRepository.js'))
const { check, finish } = checker()

const weaponTpl = fs.readFileSync(path.join(pluginRoot, 'resources/atlas/weapon.html'), 'utf8')

const base = { gameName: '原神', pageTitle: '武器', name: '星锋剑·源光', rarity: '4', renderScale: 1.5, _res_path: 'file:///atlas-res', image: '', metaFields: [], sections: [] }

console.log('\n=== ① 构建器标记（数据无关）===')
const skinHero = buildGIWeapon({ type: 'WEAPON_SWORD_ONE_HAND', skin: true }, {}, { rarity: 4 }).hero
const normalHero = buildGIWeapon({ type: 'WEAPON_SWORD_ONE_HAND' }, {}, { rarity: 5 }).hero
check('skin: true → hero.skin 为真', skinHero.skin === true)
check('没有 skin 字段 → hero.skin 为假', normalHero.skin === false)
check('外观不额外造面板字段', buildGIWeapon({ skin: true }, {}, {}).metaFields.every((field) => field.label !== '基础攻击力'))

console.log('\n=== ② 模板渲染（数据无关）===')
const withSkin = template.render(weaponTpl, { ...base, hero: { weapon: '单手剑', desc: '', skin: true } })
const withoutSkin = template.render(weaponTpl, { ...base, hero: { weapon: '单手剑', desc: '' } })
const countChips = (html) => (html.match(/class="hero-info-item"/g) || []).length
check('皮肤条目在标签行多一个「皮肤」方框', withSkin.includes('皮肤') && countChips(withSkin) === 2, `${countChips(withSkin)} 个方框`)
check('普通武器只有一个类型方框', !withoutSkin.includes('皮肤') && countChips(withoutSkin) === 1, `${countChips(withoutSkin)} 个方框`)
check('模板无残留未渲染标记', !withSkin.includes('{{') && !withoutSkin.includes('{{'))

console.log('\n=== ③ 真实数据：外观条目的性质 ===')
const entries = getPageRecords('gi', 'weapon')
let skins = 0
let mismatched = 0
let withStats = 0
for (const entry of entries) {
  const record = loadRecord(entry.filePath)
  if (!record) continue
  const isSkin = record.content?.list?.skin === true
  const heroSkin = buildGIWeapon(record.content.list, record.content.detail, record.meta).hero.skin === true
  if (isSkin) {
    skins += 1
    if (!heroSkin) mismatched += 1
    if (record.content.list.atk != null || record.content.list.sub != null) withStats += 1
  } else if (heroSkin) {
    mismatched += 1
  }
}
check('武器页存在外观条目', skins > 0, `${skins} / ${entries.length} 条`)
check('外观标记与记录一致（不多标也不少标）', mismatched === 0, `不一致 ${mismatched} 条`)
check('外观条目都没有 atk / sub（面板本就为空）', withStats === 0, `带数值 ${withStats} 条`)

// 独立条目：按 id 搜到的就是外观自己，不会被折到本体
const byId = search('gi', '390002')
check('按 id 搜到外观自己（不折叠到本体）', byId?.results?.[0]?.name?.includes('星锋剑'), `实际 ${byId?.results?.[0]?.name || '-'}`)
const ownPage = getPageRecords('gi', 'weapon').find((entry) => entry.name === '星锋剑')
check('本体仍是独立条目', Boolean(ownPage), ownPage?.name)

finish()