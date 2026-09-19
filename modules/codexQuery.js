/**
 * 角色攻略查询编排（独立页面类型 codex）
 *
 * 触发：#胡桃攻略 / *符玄攻略 / %雅攻略（后缀登记见 components/constants.js 的 PAGE_TYPE_SUFFIXES）
 * 数据：tool/Character-Codex-Data/Character-Codex-Data（经 model/codexIndex/index.js 读取）
 * 图标：model/codexIndex/icons.js（v2 数据按 ref 的类型前缀取武器/圣遗物/天赋/命座图标，
 *       旧版文本行按名称到图鉴现取；配队成员同理取头像）
 * 模板：resources/atlas/codex.html
 *
 * 职责：定位图鉴条目 → 取攻略数据 → 按长图顺序排段 → 补齐 hero 字段与段落/条目图标 → 交模板渲染。
 * 攻略正文的解析在 model/codexIndex，本层不读攻略仓库文件。
 */
import { renderAtlas } from '../components/render.js'
import { GAME_NAMES, CODEX_PAGE_KEY } from '../components/constants.js'
import { buildDetailData } from '../components/queryUtils.js'
import { loadRecord } from '../model/AtlasService.js'
import { isCodexReady, getCharacterGuide } from '../model/codexIndex/index.js'
import { resolveGuideIcons, attachItemIcons, attachTeamIcons } from '../model/codexIndex/icons.js'

/** 长图段落顺序：武器 → 圣遗物 → 天赋 → 面板 → 命座 → 配队（未列出的段落按原顺序排在末尾） */
const SECTION_ORDER = ['武器', '圣遗物', '天赋', '面板', '命座', '配队']

/** 段落标题 → 图标种类（line 表示线稿图标，需要反相成深色） */
const ICON_BY_SECTION = [
  [/武器/, 'weapon', false],
  [/圣遗物/, 'artifact', false],
  [/天赋/, 'talent', true],
  [/命座/, 'constellation', true]
]

/**
 * 按长图顺序排列段落
 * 数据里的段落顺序不保证（仓库可自由增删），这里按标题关键词归位；同一位置保持原顺序
 * @param {Array} sections - getCharacterGuide() 返回的段数组
 * @returns {Array} 排序后的新数组
 */
function orderSections (sections) {
  const rank = (section) => {
    const title = String(section?.title || '')
    const i = SECTION_ORDER.findIndex(key => title.includes(key))
    return i === -1 ? SECTION_ORDER.length : i
  }
  return [...(sections || [])].sort((a, b) => rank(a) - rank(b))
}

/**
 * 给段落挂上标题图标（取不到的段落不加，模板据此不渲染）
 * @param {Array} sections
 * @param {object} icons - resolveGuideIcons() 结果
 * @returns {Array}
 */
function attachIcons (sections, icons) {
  return sections.map(section => {
    const hit = ICON_BY_SECTION.find(([re]) => re.test(String(section.title || '')))
    const icon = hit ? icons[hit[1]] : ''
    if (!icon) return section
    return { ...section, icon, iconLine: hit[2] }
  })
}

/**
 * 取图鉴条目的 hero 数据（背景大图 / 立绘 / 头像 / 称号 / 稀有度）
 *
 * 攻略页 hero 与角色页共用同一套框架（resources/common/hero.css + character.html 的 hero 块），
 * 故这里直接透传 buildDetailData 产出的 hero 对象，不自己拼字段：
 * 原神名片大图、星铁 avatarDrawCard 立绘、绝区零影画大图与圆头像都由它带出。
 * 读原条目而非重新搜索；条目缺失或构建失败返回 null，由模板走 hero-plain 兜底。
 * @param {string} gameId
 * @param {object} entry - search() 结果中的图鉴条目
 * @param {object|null} record - 已读取的图鉴条目 JSON
 * @returns {{hero: object, image: string}|null}
 */
function buildAtlasHero (gameId, entry, record) {
  if (!record) return null
  try {
    const atlas = buildDetailData(gameId, { ...entry, record })
    if (!atlas?.hero) return null
    return { hero: atlas.hero, image: atlas.image || atlas.hero.portrait || '' }
  } catch (err) {
    logger?.warn(`[Atlas] 攻略页图鉴 hero 构建失败（${entry?.name || ''}）: ${err.message}`)
    return null
  }
}

/**
 * 合并 hero 小方框内容：攻略侧标签（建议等级 / 定位）在前，图鉴侧 chips / 元素 / 武器随后
 * @param {string[]} guideChips - 攻略数据自带标签
 * @param {object|null} hero
 * @returns {string[]}
 */
function mergeHeroChips (guideChips, hero) {
  const chips = []
  for (const chip of [...(guideChips || []), ...(hero?.chips || []), hero?.element, hero?.weapon]) {
    if (chip && !chips.includes(chip)) chips.push(chip)
  }
  return chips
}

/**
 * 处理角色攻略查询
 * @param {object} e - Runtime 实例
 * @param {string} gameId - gi / hsr / zzz
 * @param {object} result - search() 的搜索结果（已按剥离后缀的关键词搜过）
 * @param {string} keyword - 剥离后缀后的关键词（角色名）
 * @returns {Promise<boolean>} true=消息已处理
 */
export async function handleCodexQuery (e, gameId, result, keyword) {
  // 只有「确定命中角色」才由图鉴接管攻略页：命中角色但攻略仓库没有该角色 → 提示并中断。
  // 判定用搜索结果首条——角色页优先级最高（PAGE_PRIORITY 240），首条不是角色说明关键词命中的
  // 是圣遗物/物品等其他条目（如 #如雷的盛怒攻略），不是角色攻略查询，放行给其他插件（如 miao 面板）
  const entry = result?.results?.[0]
  if (entry?.pageKey !== 'character') return false

  if (!isCodexReady()) {
    await e.reply('[Atlas] 角色攻略数据尚未拉取，请先执行 #图鉴初始化 或 #图鉴更新')
    return true
  }

  const rawGuide = getCharacterGuide(gameId, entry.name)
  if (!rawGuide) {
    await e.reply(`[Atlas] ${entry.name} 暂无攻略数据`)
    return true
  }

  // 图鉴条目只读一次：hero 字段与段落图标都基于它
  let record = null
  if (entry.pageKey === 'character') {
    try {
      record = loadRecord(entry.filePath)
    } catch (err) {
      logger?.warn(`[Atlas] 攻略页读取图鉴条目失败（${entry.name}）: ${err.message}`)
    }
  }

  // 长图单列固定顺序：hero → 参考 → 武器 → 圣遗物 → 天赋 → 面板 → 命座 → 配队 → 页脚
  let guide = { ...rawGuide, sections: orderSections(rawGuide.sections) }
  // 段落标题图标 + 档位条目图标（v2 按 ref 解析，没有 ref 的旧版条目自动跳过）+ 配队成员头像
  // （头像取不到时模板退回显示名字，图标取不到时模板退回纯文字条目）
  const icons = resolveGuideIcons(gameId, guide, record)
  guide = {
    ...guide,
    sections: attachTeamIcons(gameId, attachIcons(attachItemIcons(gameId, guide.sections, record), icons))
  }

  // 图鉴侧 hero：背景大图 / 立绘 / 头像 / 称号 / 稀有度全部来自角色页同一套 hero 数据
  const atlasHero = buildAtlasHero(gameId, entry, record)
  const hero = atlasHero?.hero || null

  const data = {
    pageKey: CODEX_PAGE_KEY,
    pageTitle: '角色攻略',
    gameName: GAME_NAMES[gameId],
    keyword,
    name: entry.name,
    recordName: entry.name,
    // 稀有度与兜底图同时挂在顶层：hero 取不到时模板走 hero-plain 分支
    rarity: hero?.rarity || entry.rarity || '',
    image: atlasHero?.image || '',
    hero: hero ? { ...hero, chips: mergeHeroChips(guide.chips, hero) } : null,
    guide
  }
  const img = await renderAtlas(CODEX_PAGE_KEY, data, { imgType: 'jpeg' })
  if (img) await e.reply(img)
  else await e.reply(`[Atlas] ${entry.name} — 攻略渲染失败`)
  return true
}
