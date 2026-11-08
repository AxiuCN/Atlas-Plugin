/**
 * 版本新增内容：nanoka manifest 的 `new` → 分组 + 名称
 *
 * 纯函数为主（数据无关），真实产物存在时补一条端到端断言。
 */
import { mod, checker, installFrameworkStubs } from './_helper.mjs'

installFrameworkStubs()

const { buildNewContentModel, formatNewContent, pageOfEntity } = await import(mod('model/NewContent.js'))
const { getHesperidesUpstreamManifest, getHesperidesIndex } = await import(mod('model/Hesperides.js'))

const { check, finish } = checker()

const MANIFEST = {
  games: {
    gi: {
      latest: '7.2.50',
      live: '7.2',
      new: {
        weapon: [12438, 12517],
        character: [10000147, 10000149],
        item: [113094],
        suite: [],
        future_entity: [9001]
      }
    },
    hsr: { latest: '4.6.54', live: '4.6', new: { character: [1511] } },
    zzz: { latest: '3.4.3', live: '3.3', new: {} }
  }
}

// index 就是 getHesperidesIndex() 的返回形状（keys = gameId）
const INDEX = {
  gi: {
    sources: {
      nanoka: {
        pages: {
          character: { entries: { 10000147: { name: '新角色甲' } } },
          weapon: { entries: { 12438: { name: '新武器甲' } } },
          item: { entries: { 113094: { name: '新物品甲' } } }
        }
      }
    }
  },
  hsr: {
    sources: {
      nanoka: {
        pages: {
          character: { entries: { 1511: { name: '新角色乙' } } },
          lightcone: { entries: {} }
        }
      }
    }
  }
}

console.log('=== ① 实体 → 页目录 ===')
check('同名页直接映射', pageOfEntity('gi', 'character') === 'character' && pageOfEntity('zzz', 'monster') === 'monster')
check('武器按游戏分页（hsr 是光锥页）', pageOfEntity('gi', 'weapon') === 'weapon' && pageOfEntity('hsr', 'weapon') === 'lightcone')
check('未知实体没有页', pageOfEntity('gi', 'future_entity') === '')

console.log('\n=== ② 模型组装 ===')
const model = buildNewContentModel('gi', MANIFEST, INDEX)
check('带上版本与线上版本', model.latest === '7.2.50' && model.live === '7.2')
check('空分组被丢弃', !model.groups.some((g) => g.entity === 'suite'))
check('按固定顺序排列（角色 → 武器 → 物品 → 未知）',
  model.groups.map((g) => g.entity).join(',') === 'character,weapon,item,future_entity')
check('名称从索引补出', model.groups[0].names[0] === '新角色甲' && model.groups[1].names[0] === '新武器甲')
check('查不到名字退回 id', model.groups[0].names[1] === '10000149')
check('未知实体用实体名作标签', model.groups.at(-1).label === 'future_entity')
check('总数是各组之和', model.total === 6, String(model.total))

console.log('\n=== ③ 边界 ===')
check('上游没有该游戏 → null', buildNewContentModel('zzz', MANIFEST, INDEX) === null)
check('没有 new 字段 → null', buildNewContentModel('gi', { games: { gi: { latest: '1.0' } } }, INDEX) === null)
check('manifest 缺失 → null', buildNewContentModel('gi', null, INDEX) === null)
check('索引缺失时名字退回 id', buildNewContentModel('hsr', MANIFEST, null).groups[0].names[0] === '1511')

console.log('\n=== ④ 文案 ===')
const text = formatNewContent(model, { gameName: '原神' })
check('首行带版本与总数', /原神 版本新增内容（数据版本 7\.2\.50｜线上 7\.2）：共 6 项/.test(text), text.split('\n')[0])
check('每组一行、带数量', text.split('\n').some((line) => line === '· 角色（2）：新角色甲、10000149'))
const truncated = formatNewContent(model, { gameName: '原神', maxNames: 1 })
check('超出按「等 N 项」截断', truncated.includes('· 角色（2）：新角色甲（等 2 项）'), truncated.split('\n')[1])
check('空模型给空串', formatNewContent(null) === '')

// 同名多条（时装配色变体）只展示一个名字，但计数保留
{
  const dupManifest = { games: { gi: { latest: '1.0', live: '1.0', new: { character: [1, 2] } } } }
  const dupIndex = { gi: { sources: { nanoka: { pages: { character: { entries: { 1: { name: '同名人' }, 2: { name: '同名人' } } } } } } } }
  const dup = buildNewContentModel('gi', dupManifest, dupIndex)
  check('组内名字去重、计数保留', dup.groups[0].count === 2 && dup.groups[0].names.length === 1)
  check('去重时文案说明名称数', formatNewContent(dup).includes('· 角色（2）：同名人（共 2 项 / 1 个名称）'), formatNewContent(dup).split('\n')[1])
}

console.log('\n=== ⑤ 真实产物（缺失则跳过）===')
const realManifest = getHesperidesUpstreamManifest()
if (!realManifest) {
  console.log('  ⏭ 还没有 upstream/nanoka.json 快照，跳过真实数据断言')
} else {
  const real = buildNewContentModel('gi', realManifest, getHesperidesIndex())
  check('真实 manifest 能组装出模型', Boolean(real?.groups?.length), real ? `共 ${real.total} 项` : '(null)')
  check('真实模型带 latest', Boolean(real?.latest))
}

finish()
