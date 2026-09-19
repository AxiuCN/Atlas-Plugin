/**
 * 角色攻略「纯显示级」归一 —— 网页版（build-html.mjs）与游戏内面板
 * （Atlas-Plugin/model/codexIndex/parse.js）共用同一份规则。
 *
 * 分层约定（重要）：
 *   - **文本级归一**（措辞替换、符号替换、简写展开）属于数据侧，放在 scripts/lib/schema.mjs 的
 *     `deriveSections`，并让 parse-docx.mjs 能反向读懂；doc → JSON → doc 必须保持往返相等。
 *   - **纯显示级**（标题简称、档位标签、空行/空模块、皇冠并入天赋、命座「命之座X」、
 *     副词条 `＞`、简写展开、面板 `0%` 行）**只在本模块做**，一个字都不写回 JSON / docx。
 *     这样内部 section 标题（`1. 武器推荐` …）保持不动 —— 插件与图标映射依赖它们。
 *
 * 输入/输出都是**渲染模型**（同一套结构），所以两侧渲染结果逐字一致：
 *   section: { title, displayTitle, kind, badge, empty, rows, teams, items, fields, iconRef, icon, image }
 *   row:     { label, ref, items: [{ text, note, ref, sepAfter, icon, iconLine }] }
 *   team:    { tag, members: [{ name, note, ref, icon, plain }], text, note }
 *
 * ⚠ 本文件与 Atlas-Plugin/model/codexIndex/display.js **必须逐字节相同**。
 *   校验：node scripts/check-display-sync.mjs
 * 输入里的行内 HTML（`<span class="must">` 之类）由调用方注入，本模块只做纯文本替换，
 * 因此替换结果不会被二次转义；`**文字**` / `==文字==` 标记也原样保留。
 */

/* ------------------------------------------------------------------ *
 * 一、模块表（顺序 = 长图顺序；键名与 v2 字段一一对应）
 * ------------------------------------------------------------------ */

/**
 * 六个模块的显示顺序与显示标题。
 *
 * 顺序**保持现状 = 文档顺序**（用户明确要求）：武器 → 圣遗物 → 天赋 → 毕业面板 → 命座 → 配队。
 * 文档里 `4.` 是毕业面板参考、`5.` 是命座推荐，显示上任其在前；
 * 编号徽标直接取本数组下标 +1，网页版与面板两边一致。
 */
export const DISPLAY_SECTIONS = [
  { key: 'weapons', title: '武器', kind: 'rows' },
  { key: 'artifacts', title: '圣遗物', kind: 'rows' },
  { key: 'talents', title: '天赋', kind: 'rows' },
  { key: 'panels', title: '面板', kind: 'stats' },
  { key: 'constellations', title: '命座', kind: 'rows' },
  { key: 'teams', title: '配队', kind: 'teams' }
]

/** 旧标题关键词 → 显示标题（旧版文本行 JSON / HTML 回退路径用） */
const TITLE_BY_KEYWORD = [
  [/武器/, '武器'], [/圣遗物/, '圣遗物'], [/天赋/, '天赋'],
  [/命座/, '命座'], [/面板|属性/, '面板'], [/配队|队伍|阵容/, '配队']
]

/** 空模块占位文案 */
export const EMPTY_TEXT = '暂无'

/** 行内备注前缀（配队括注统一成 `注：`，与段末「注：」备注行同一套写法） */
export const NOTE_PREFIX = '注：'

/** 行内备注分隔符（同一行多条备注合并） */
export const NOTE_SEP = '；'

/**
 * 内部标题（`1. 武器推荐`）→ 显示标题（`武器`）。
 * 认不出的标题原样返回（例如仓库以后新加的段）。
 * @param {string} title
 * @returns {string}
 */
export function displayTitle (title) {
  const raw = String(title ?? '').trim()
  if (!raw) return ''
  for (const [re, name] of TITLE_BY_KEYWORD) if (re.test(raw)) return name
  return raw
}

/**
 * 渲染模型的段落类型 → 显示类型（`rows` / `stats` / `teams` / `list` / `fields`）
 * @param {string} type
 * @returns {string}
 */
export function displayKind (type) {
  const t = String(type ?? '').trim()
  if (t === 'teams') return 'teams'
  if (t === 'stats') return 'stats'
  if (t === 'list') return 'list'
  if (t === 'fields') return 'fields'
  return 'rows'
}

/* ------------------------------------------------------------------ *
 * 二、措辞 / 缩写的映射表（可维护：新增简写只改这两张表）
 * ------------------------------------------------------------------ */

/** 档位标签：源写法 → 显示写法（首选→推荐、其他/过渡/次选/可选→可选） */
export const TIER_LABEL = {
  第一档: '推荐',
  第二档: '可选',
  第三档: '过渡',
  首选: '推荐',
  其他: '可选',
  次选: '可选',
  过渡: '可选',
  可选: '可选',
  套装: '推荐'
}

/** 档位序号 → 显示标签（只有两档时取前两个：推荐 / 可选） */
export const TIER_BY_INDEX = ['', '推荐', '可选', '过渡']

/**
 * 简写 → 全称映射表（**面板与副词条共用**）。三列：
 *   [简写, 全称, notBefore?, notAfter?]
 *   - `notBefore`：命中**后面**紧跟这些字时不换（`充能效率` 里的 `充能`、`暴击率` 里的 `暴击`）
 *   - `notAfter`：命中**前面**是这些字时不换（`元素充能效率` 里的 `充能效率`，避免再叠一层 `元素`）
 * 展开走「长词优先 + 单遍替换」，所以展开结果不会被后续规则再匹配一次。
 *
 * 新识别出简写时直接在这里补一行即可。
 */
export const STAT_ALIASES = [
  ['双爆', '暴击率=暴击伤害'],
  ['大生命', '生命值'],
  ['大攻击', '攻击力'],
  ['大防御', '防御力'],
  ['小生命', '生命值'],
  ['小攻击', '攻击力'],
  ['小防御', '防御力'],
  ['暴伤', '暴击伤害'],
  ['爆伤', '暴击伤害'],
  // 恒等项（最长，先命中）：把已经是全称的位置占住，后面的短词规则就不会再叠一层
  ['元素充能效率', '元素充能效率'],
  ['元素精通', '元素精通'],
  ['充能效率', '元素充能效率'],
  ['充能沙', '元素充能效率'],
  ['元素充能', '元素充能效率'],
  ['充能', '元素充能效率', '效沙'],
  ['精通头', '元素精通'],
  ['精通沙', '元素精通'],
  ['精通杯', '元素精通'],
  ['精通', '元素精通'],
  ['暴击头', '暴击率'],
  ['暴伤头', '暴击伤害'],
  ['爆伤头', '暴击伤害'],
  ['百分比攻击力', '攻击力百分比'],
  ['攻击头', '攻击力'],
  ['生命头', '生命值'],
  ['攻击沙', '攻击力'],
  ['生命沙', '生命值'],
  ['防御沙', '防御力'],
  ['攻击杯', '攻击力'],
  ['生命杯', '生命值'],
  ['防御杯', '防御力'],
  ['元素伤害杯', '元素伤害加成'],
  ['大公鸡', '攻击力'],
  ['暴击', '暴击率', '率伤']
]

/**
 * 简写展开：**长词优先 + 单遍替换**。
 *
 * 逐个简写扫全串（长词先扫），已命中的片段记进 `taken` 不再参与后续匹配，
 * 因此不会出现重复字（`元素充能效率` 不会被 `充能` 再换一次），
 * 也不会把全称拆开（`元素精通` 整体被 `元素精` 规则命中，`精通` 规则跳过）。
 * 替换结果不参与后续匹配（避免 `充能→元素充能效率` 里新出现的词被再换一次）。
 *
 * @param {string} text
 * @returns {string}
 */
function expandAliases (text) {
  const src = String(text ?? '')
  if (!src) return src
  // 长词优先：同一位置上更长的简写先命中
  const rules = [...STAT_ALIASES].sort((a, b) => b[0].length - a[0].length)
  const taken = new Array(src.length).fill(false)
  const hits = []
  for (const [from, to, notBefore, notAfter] of rules) {
    let at = src.indexOf(from)
    while (at >= 0) {
      const end = at + from.length
      const next = src[end] ?? ''
      const prev = at > 0 ? src[at - 1] : ''
      const free = !taken.slice(at, end).some(Boolean)
      const blocked = (notBefore && next && notBefore.includes(next)) ||
        (notAfter && prev && notAfter.includes(prev))
      if (free && !blocked) {
        for (let i = at; i < end; i++) taken[i] = true
        hits.push({ at, end, to })
      }
      at = src.indexOf(from, at + 1)
    }
  }
  if (!hits.length) return src
  hits.sort((a, b) => a.at - b.at)
  let result = ''
  let cursor = 0
  for (const hit of hits) {
    result += src.slice(cursor, hit.at) + hit.to
    cursor = hit.end
  }
  return result + src.slice(cursor)
}

/**
 * 纯文本显示归一：
 *   1. 简写展开（双爆 → 暴击率=暴击伤害、充能 → 元素充能效率 …）
 *      —— 展开出的全称已经带「元素 / 伤害」等前缀，不会被短词二次命中，无需再做裸词补齐
 *   2. 分隔符两侧空格归一（`暴击率 / 暴击伤害` → `暴击率/暴击伤害`）
 *
 * **不动 `>` 与 `≥`**：档位分隔符由各渲染层的 `sepAfter` 决定
 * （面板用数据原样 `>`，网页版按显示需要换成 `＞`），这里改了会与面板漂移。
 * @param {string} text
 * @returns {string}
 */
export function displayText (text) {
  const out = expandAliases(text)
    // `/` 两侧空白归一成 `/`，并修掉区间边界上残留的悬挂 `/`（`A / / B` → `A/B`）
    .replace(/[ \t]*[/／][ \t]*/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+|\/+$/g, '')
    // `=`（同级）两侧留空格，并统一成全角 `＝`；`＞` / `>` / `≥` 原样保留
    .replace(/[ \t]*[=＝][ \t]*/g, '＝')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  return out
}

/**
 * 面板行文本：在 displayText 基础上把**并列的数值**保留 `/` 与空格
 * （`暴击率70% / 暴伤220%+` → `暴击率70% / 暴击伤害220%+`）
 * @param {string} text
 * @returns {string}
 */
export function displayPanelText (text) {
  return expandAliases(text)
    .replace(/[ \t]*[/／][ \t]*/g, ' / ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/**
 * 档位标签归一：`第一档`→`推荐`、`第二档`→`可选`、`第三档`→`过渡`、
 * `首选`→`推荐`、`其他`→`可选`。认不出的（自定义队名 / 输出向 / 辅助向 …）原样返回。
 * @param {string} label
 * @param {number|string|null} [tier] 档位序号（有 tier 时优先用它）
 * @returns {string}
 */
export function displayLabel (label, tier = null) {
  const t = Number(tier)
  if (Number.isInteger(t) && t > 0 && TIER_BY_INDEX[t]) return TIER_BY_INDEX[t]
  const raw = String(label ?? '').trim()
  if (!raw) return ''
  // 已经是显示词就直接返回，避免二次归一（`过渡` 不能再被折成 `可选`）
  if (TIER_BY_INDEX.includes(raw)) return raw
  if (Object.prototype.hasOwnProperty.call(TIER_LABEL, raw)) return TIER_LABEL[raw]
  const m = raw.match(/^第([一二三四五六123456])[档挡]$/)
  if (m) {
    const idx = '一二三四五六'.indexOf(m[1]) + 1 || Number(m[1])
    return TIER_BY_INDEX[idx] ?? raw
  }
  return raw
}

/** 这行文案算不算「没填」（空串 / 占位符 `___` / 只剩标点） */
export function isBlankDisplay (text) {
  const s = String(text ?? '').trim()
  if (!s) return true
  if (s.includes('___')) return true
  const rest = s.replace(/^[^：:—]{1,8}[：:—]+/, '').trim()
  if (!rest) return true
  return /^[_\-—·、/：:（）()＞]+$/.test(rest)
}

/**
 * 面板行数值是不是 `0` / `0%`：`0%`、`0`、`0%（收益可忽略）` 都算 0；
 * `约 5%`、`0.5%` 不算。带「标签：」前缀时（`100级提升：0%`）只看冒号后面那一段。
 * @param {string} text
 * @returns {boolean}
 */
export function isZeroValue (text) {
  const raw = String(text ?? '').trim().replace(/\s+/g, '')
  if (!raw) return false
  const m = raw.match(/^[^：:]{1,10}[：:](.*)$/)
  const s = (m ? m[1] : raw).trim()
  if (!s) return false
  return /^[+＋]?0+(?:\.0+)?[%％]?(?:[^0-9.]*)$/.test(s)
}

/* ------------------------------------------------------------------ *
 * 三、分隔符与档位条目
 * ------------------------------------------------------------------ */

/**
 * 档位分隔符显示：`/` → `＞`（优先级语义），`>` / `≥` 原样
 * @param {string} sep
 * @returns {string}
 */
export function displaySep (sep) {
  const s = String(sep ?? '').trim()
  if (!s) return ''
  if (/^[/／]$/.test(s)) return '＞'
  return s
}

/** 一条档位条目的文本（简写展开 + 标点归一：`>` → `＞`） */
export function displayItemText (text) {
  return displayText(text)
}

/* ------------------------------------------------------------------ *
 * 四、各模块的显示级归一
 * ------------------------------------------------------------------ */

/** 六个模块显示标题 → 关键词（旧标题里也含这个词，图标映射靠它） */
export const SECTION_KEYWORDS = { 武器: '武器', 圣遗物: '圣遗物', 天赋: '天赋', 命座: '命座', 面板: '面板', 配队: '配队' }

/** 一条备选条目里多个套装名的连接符（2+2 组合） */
export const SET_COMBO_SEP = '+'

/**
 * 套装行的**显示级组合归一**（网页版与面板共用同一份规则）。
 *
 * 输入是「原始套装序列 + 逐档分隔符」，输出是「显示条目」：
 *   - `/` 分隔的候选条目之间用 `/` 连接（`首选 / 过渡`）
 *   - `+` 连接的同一条目是 **2+2 组合**，整体保留、用 `+` 连接（`A+B`）
 *   - **同名套装只保留一次**：`A / A+B` → `A+B`、`A / A / B` → `A / B`、
 *     `A + A` → `A`（同一组合内同名也按一次显示）
 *
 * 之所以放在这里：两侧曾各自实现一遍，`A / A+B` 这类重叠写法的去重方向不同
 * （保留组合 vs 保留候选），渲染结果会漂移。收敛成一个函数后不会再分叉。
 *
 * @param {Array<string|{name?: string, pieces?: string, ref?: string, [k: string]: any}>} sets
 * @param {string[]} [seps] 逐档分隔符（长度 = sets.length - 1；末项忽略）
 * @param {{sep?: string}} [opts] 输出条目之间的显示分隔符（默认 `/`）
 * @returns {Array<{name: string, pieces: string, sepAfter: string, item: any}>}
 */
export function resolveSetItems (sets, seps = [], opts = {}) {
  const outSep = opts.sep ?? '/'
  const isPlus = (s) => {
    const t = String(s ?? '').trim()
    return t === '+' || t === '＋' || t === '&' || t === '＆'
  }
  const nameOf = (x) => String(x?.name ?? x ?? '').trim()

  // 1. 按原始分隔符合并成「显示条目」（`+` 属于同一条目，`/` 断开）
  const entries = []
  let cur = null
  for (let i = 0; i < sets.length; i++) {
    const name = nameOf(sets[i])
    if (!name) continue
    const pieces = String(sets[i]?.pieces ?? '').trim()
    const joined = i > 0 && isPlus(seps[i - 1])
    if (cur && joined) cur.parts.push(pieces ? `${name}（${pieces}）` : name)
    else { cur = { parts: [pieces ? `${name}（${pieces}）` : name], base: sets[i] }; entries.push(cur) }
  }

  // 2. 同名只保留一次：某条目的**全部**套装名都在更靠后的条目里出现过时，整条丢掉
  const lastAt = new Map()
  entries.forEach((e, i) => { for (const p of e.parts) lastAt.set(p, i) })
  const kept = entries.filter((e, i) => e.parts.some(p => lastAt.get(p) === i))

  return kept.map((e, i) => {
    const parts = [...new Set(e.parts)]
    return {
      name: parts.join(SET_COMBO_SEP),
      // 名字里已经拼过括注，这里把原字段清掉，避免模板再补一次
      pieces: '',
      sepAfter: i === kept.length - 1 ? '' : outSep,
      item: e.base
    }
  })
}

/**
 * 优先级一条里的档位分隔符：`>` / `≥` / `＞` / `=`
 * （`A=Q＞E` 这种「A 与 Q 同级」的写法要拆成 `A`、`Q`、`E` 三条）
 */
export const TALENT_RANK_SEPS = [' > ', ' ≥ ', '＞', '>', '≥', '＝', '=', ' / ', '/', '／']

/**
 * 优先级条目：把「一条里写了多个字母」的写法拆开，并标记必需项（皇冠）。
 *
 * **文本里不带 `10`**（`Q10 ＞ E` → `Q ＞ E`）：皇冠必需与否只落在渲染模型的 `crown: true` 上，
 * 由渲染层在技能图标角上叠一个皇冠徽标（面板）/ 保持纯字母（网页版）。
 * 这样「数据与文档文本」保持干净，两侧文本也天然一致。
 *
 * @param {string} text 条目文本（如 `A=Q＞E`、`体Q(E)` 或旧写法 `Q10`）
 * @param {string[]} [crowned] 需要皇冠的字母（如 `['A','E']`）
 * @returns {Array<{text: string, sepAfter: string, crown: boolean}>}
 */
export function normalizePriorityItems (text, crowned = []) {
  const seps = TALENT_RANK_SEPS
  const out = []
  let depth = 0
  let buf = ''
  const flush = (sep) => {
    let t = buf.trim()
    buf = ''
    if (!t) return
    // 旧的 `X10` 写法：10 是皇冠标记，不是文本内容 —— 剥掉并转成 crown 标记
    const legacy = /\s*10\s*$/.test(t)
    t = t.replace(/\s*10\s*$/, '').trim()
    if (!t) return
    const ch = String(t.match(/[AEQ]/) ?? '')
    const crown = !!ch && (legacy || crowned.includes(ch))
    out.push({ text: t, sepAfter: sep, crown })
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if ('(（[【'.includes(c)) depth += 1
    else if (')）]】'.includes(c)) depth = Math.max(0, depth - 1)
    if (depth === 0) {
      const hit = seps.find(s => text.startsWith(s, i))
      if (hit) { flush(hit.trim()); i += hit.length - 1; continue }
    }
    buf += c
  }
  flush('')
  return out.map((it, i) => ({ ...it, sepAfter: i === out.length - 1 ? '' : it.sepAfter }))
}

/**
 * 逗号 / 分号（`、` `,` `，` `；` `;`）分隔的候选：命座说明、面板数值等
 * `攻击力 / 精通` 里的 `/` 由调用方处理。
 * @param {string} text
 * @returns {string[]}
 */
export function splitByComma (text) {
  return String(text ?? '').split(/\s*[、,，;；]\s*/).map(s => s.trim()).filter(Boolean)
}

/** 档位标签 → 可用于 class 名的后缀（`推荐` → `label-推荐`；其它为空串） */
export function tierLabelClass (label) {
  const s = String(label ?? '').trim()
  return ['推荐', '可选', '过渡'].includes(s) ? `label-${s}` : ''
}

/**
 * 空模块：标题带模块关键词（`武器` / `圣遗物` …），这样插件侧按 `/武器/` 取图标的逻辑不受影响。
 * `type` 照旧按模块类型给（模板先判 `empty`，再按 type 分支）。
 * @param {string} title 显示标题
 * @param {string} [kind]
 * @returns {object}
 */
export function emptySection (title, kind = 'rows') {
  const keyword = SECTION_KEYWORDS[title] ?? title
  return { title: keyword, displayTitle: keyword, kind, type: kind, empty: true, rows: [], teams: [] }
}

/** 单条目：文本展开 + 备注展开（`>` / `≥` 原样保留，与面板一致） */
function normalizeItem (item) {
  return {
    ...item,
    text: displayItemText(item.text),
    note: item.note ? displayText(item.note) : item.note
  }
}

/**
 * 武器行：档位标签 → 推荐 / 可选 / 过渡；`首选` → 推荐、`其他` → 可选。
 * 描述性标签（辅助向 / 输出向 …）保持不变，并列在档位标签之后。
 * @param {object[]} rows
 * @returns {object[]}
 */
export function normalizeWeaponRows (rows) {
  return (rows ?? []).map(row => ({
    ...row,
    label: row.label ? displayLabel(row.label) : displayLabel('', row.tier),
    items: (row.items ?? []).map(normalizeItem)
  }))
}

/**
 * 圣遗物：`首选` → 推荐、`过渡` → 可选、`次选/可选` → 可选；
 * 主词条候选之间用 `/`（去空格），副词条里的斜杠 → 全角 `＞`，简写展开。
 * @param {object[]} rows
 * @returns {object[]}
 */
export function normalizeArtifactRows (rows) {
  return (rows ?? []).map(row => {
    const isSub = /副词条/.test(String(row.label ?? ''))
    return {
      ...row,
      label: displayLabel(row.label),
      items: (row.items ?? []).map(item => ({
        ...item,
        text: displayItemText(item.text),
        note: item.note ? displayText(item.note) : item.note,
        sepAfter: isSub ? (item.sepAfter ? '＞' : item.sepAfter) : displaySep(item.sepAfter)
      }))
    }
  })
}

/**
 * 天赋：皇冠行并入优先级行 —— 必需项（必须）在该条目上标 `crown: true`（文本保持纯字母），
 * 可选的（建议/可选）不标注，单独的「皇冠」行删除。渲染层在图标角上叠皇冠徽标。
 *
 * 优先级的档位条目在数据里可能是一条（`A＞E＞Q`）也可能是多条，这里先按档位分隔符
 * 拆开再按字母定位，所以「必需」标记永远落在**对应的那个字母**上（`E` → `crown:true`）。
 * @param {object[]} rows
 * @returns {object[]}
 */
export function normalizeTalentRows (rows) {
  const list = (rows ?? []).map(row => ({ ...row, items: (row.items ?? []).map(normalizeItem) }))
  const priority = list.filter(row => /优先级/.test(String(row.label ?? '')))
  const crowns = list.filter(row => /皇冠/.test(String(row.label ?? '')))
  const others = list.filter(row => !priority.includes(row) && !crowns.includes(row))
  if (!priority.length || !crowns.length) return list

  const crowned = []
  for (const row of crowns) {
    for (const item of row.items ?? []) {
      const level = String(item.level ?? item.note ?? '')
      const name = String(item.name ?? item.text ?? '').trim()
      // 「必须」= 需要皇冠；「建议 / 可选 / 无需」不标注
      if (name && /必须/.test(level)) crowned.push(name.toUpperCase())
    }
  }
  if (!crowned.length) return [...priority, ...others]

  const head = priority[0]
  // 一条里的 `A＞E＞Q` 先拆成多个档位条目，再按字母定位
  // （拆出来的**最后一段**要接回原条目后面的分隔符，否则档位序列会断）
  const members = []
  for (const item of head.items ?? []) {
    const tokens = splitRankTokens(String(item.text ?? ''))
    tokens.forEach((token, i) => {
      const name = String(token.text.match(/[AEQ]/) ?? '')
      members.push({
        ...item,
        text: token.text,
        crown: !!name && (crowned.includes(name) || item.crown === true),
        sepAfter: i < tokens.length - 1 ? (token.sep || '＞') : (item.sepAfter || '')
      })
    })
  }
  const present = new Set(members.map(item => String((item.text ?? '').match(/[AEQ]/) ?? '')))
  for (const name of crowned) {
    if (!present.has(name)) members.push({ text: name, note: '', ref: `talent:${name}`, crown: true, sepAfter: '' })
  }
  return [{ ...head, items: members }, ...others]
}

/**
 * 按档位分隔符（` > ` / ` ≥ ` / `＞` / `/`）把一条文本拆成 `[{text, sep}]`
 * @param {string} text
 * @returns {Array<{text: string, sep: string}>}
 */
export function splitRankTokens (text) {
  const seps = [' > ', ' ≥ ', '＞', '>', '≥', '/', '／']
  const out = []
  let depth = 0
  let buf = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if ('(（[【'.includes(ch)) depth += 1
    else if (')）]】'.includes(ch)) depth = Math.max(0, depth - 1)
    if (depth === 0) {
      const hit = seps.find(sep => text.startsWith(sep, i))
      if (hit) {
        const t = buf.trim()
        if (t) out.push({ text: t, sep: hit.trim() })
        buf = ''
        i += hit.length - 1
        continue
      }
    }
    buf += ch
  }
  const tail = buf.trim()
  if (tail) out.push({ text: tail, sep: '' })
  return out
}

/**
 * 命座：`二命——说明` → `命之座2` + 说明（序号用阿拉伯数字，说明文字保留）；
 * 只有命座名的裸行 → 整行 `命之座X`。
 * @param {object[]} rows
 * @returns {object[]}
 */
export function normalizeConstellationRows (rows) {
  return (rows ?? []).map(row => {
    const label = String(row.label ?? '').trim()
    const rawItems = (row.items ?? []).map(item => ({
      ...item,
      text: item.text ? displayItemText(item.text) : item.text
    }))
    // 一条说明里用 `/` 并列多个候选（`提升攻击力 / 精通`）时，拆成多条目、用 `/` 连接 ——
    // 与网页版（build-html 的 splitRankParts）形状一致
    const items = []
    rawItems.forEach((it, idx) => {
      const parts = String(it.text ?? '').split(/\s*[/／]\s*/).map(s => s.trim()).filter(Boolean)
      if (parts.length <= 1) { items.push(it); return }
      parts.forEach((p, i) => items.push({
        ...it,
        text: p,
        sepAfter: i < parts.length - 1 ? '/' : (it.sepAfter || '')
      }))
      void idx
    })
    // 裸行（label 为空，条目就是命座名）与「label 是命座名」两种情况都归一到「命之座X」；
    // label 恒有值（模板两列网格靠它对齐），说明为空时留空 items（整行就显示「命之座X」）
    const bare = !label && constellationNumber(items[0]?.text ?? '')
    const idx = bare || constellationNumber(label)
    if (!idx) return { ...row, items }
    const labelText = `命之座${idx}`
    if (bare) return { ...row, label: labelText, items: [] }
    return { ...row, label: labelText, items }
  })
}

/** `一命` / `2命` / `命之座2` → 2；认不出返回 0 */
export function constellationNumber (text) {
  const s = String(text ?? '').trim()
  const m = s.match(/([一二三四五六]|\d{1,2})\s*命/)
  if (!m) return 0
  const n = m[1]
  const cn = '一二三四五六'.indexOf(n)
  if (cn >= 0) return cn + 1
  const num = Number(n)
  return Number.isInteger(num) && num >= 1 && num <= 6 ? num : 0
}

/**
 * 面板：简写 → 全称；数值为 0 / 0% 的行不显示；并列数值用全角 `＞` 连接（与网页版一致）。
 * @param {object[]} rows
 * @returns {object[]}
 */
export function normalizePanelRows (rows) {
  const out = []
  for (const row of rows ?? []) {
    const kept = []
    for (const item of row.items ?? []) {
      const text = displayPanelText(item.text)
      if (!text || isZeroValue(text)) continue
      kept.push({ ...item, text, note: item.note ? displayText(item.note) : item.note })
    }
    if (!kept.length) continue
    // 一行的多个数值之间用 `＞`（与网页版 / 副词条同一套优先级符号）
    const items = kept.map((item, i) => ({ ...item, sepAfter: i < kept.length - 1 ? '＞' : '' }))
    out.push({ ...row, label: displayText(row.label ?? ''), items })
  }
  return out
}
/** 行内备注（成员括注 / 队伍说明）→ `注：…` 文本 */
function noteLine (notes) {
  const parts = notes.map(t => String(t ?? '').trim()).filter(Boolean)
  return parts.length ? `${NOTE_PREFIX}${parts.join(NOTE_SEP)}` : ''
}

/** 成员括注算不算「备注走廊」（命座 / 成本类）：与 schema.mjs 的 isCostNoteText 同一判据 */
export function isCostNote (text) {
  const s = String(text ?? '').trim()
  if (!s) return false
  if (/^[一二三四五六\d]+\s*命$/.test(s)) return true
  return /^(高金|中金|低金|随命座)$/.test(s)
}

/**
 * 配队：`首选` → 推荐、`其他` → 可选；**自定义队名（月感电 / 火神队 …）原样**；
 * 角色后面的括注移到行尾，统一成 `注：…`（同一行多条合并）。
 * @param {object[]} teams
 * @returns {object[]}
 */
export function normalizeTeams (teams) {
  return (teams ?? []).map(team => {
    const notes = []
    const members = (team.members ?? []).map(member => {
      // 成员括注（命座 / 成本类）→ 行尾 `注：`；其它括注（精五 …）留在成员上
      if (member.note && isCostNote(member.note)) {
        notes.push(member.note)
        return { ...member, note: '' }
      }
      return { ...member, name: displayText(member.name ?? '') }
    })
    if (team.text) notes.push(displayText(team.text))
    // 输入模型里已经写好的行尾备注（网页版把「减抗位」这类说明放进 note）原样保留
    if (team.note) notes.push(String(team.note))
    const tag = displayLabel(team.tag)
    const note = noteLine(notes)
    // 没有成员也没有备注的行不画标签，避免渲染出空的「可选：」
    const hasBody = members.length > 0 || note
    return { ...team, tag: hasBody ? tag : '', tagClass: tierLabelClass(tag), members, text: '', note }
  })
}

/* ------------------------------------------------------------------ *
 * 五、入口：整段 / 整篇归一
 * ------------------------------------------------------------------ */

/** 按显示标题选对应的行归一器 */
function normalizeRowsByTitle (title, rows) {
  const list = rows ?? []
  let out
  if (/武器/.test(title)) out = normalizeWeaponRows(list)
  else if (/圣遗物/.test(title)) out = normalizeArtifactRows(list)
  else if (/天赋/.test(title)) out = normalizeTalentRows(list)
  else if (/命座/.test(title)) out = normalizeConstellationRows(list)
  else if (/面板/.test(title)) return normalizePanelRows(list)
  else out = list.map(row => ({ ...row, items: (row.items ?? []).map(normalizeItem) }))
  // 档位标签的配色 class（模板按 labelClass 上色，推荐/可选/过渡 三档）
  return out.map(row => ({ ...row, labelClass: tierLabelClass(row.label) }))
}

/**
 * 优先级文本里「需要皇冠」的字母：既认旧写法 `X10`，也认 `X（必须）`。
 * @param {string} text
 * @returns {string[]}
 */
export function crownedLetters (text) {
  const out = []
  const s = String(text ?? '')
  for (const m of s.matchAll(/([AEQ])\s*10/g)) if (!out.includes(m[1])) out.push(m[1])
  for (const m of s.matchAll(/([AEQ])\s*[（(]([^）)]*)[）)]/g)) {
    if (/必须/.test(m[2]) && !out.includes(m[1])) out.push(m[1])
  }
  return out
}

/**
 * 归一优先级行：拆开一条里的多个字母（`A=Q＞E`）、必需项标 `crown: true`（**文本不带 10**），
 * 并**沿用数据里的分隔符**（`E / Q` 保持 `/`、`E＞Q` 保持 `＞`、`A=Q` 保留同级 `=`）；
 * raw 里没有的档位退回 `＞`。网页版与面板共用。
 *
 * `crowned` 省略时从条目文本里推断（`X10` 或 `X（必须）`）；网页版直接把 `v2.talents`
 * 皇冠行里带「必须」的字母传进来，避免二次推断出歧义。
 * @param {Array<{text?: string, sepAfter?: string, [k: string]: any}>} items
 * @param {string[]} [crowned] 需要皇冠的字母
 * @param {string} [raw] 数据里的原始优先级写法（用来还原逐档分隔符）
 * @returns {Array<object>}
 */
export function normalizePriorityRow (items, crowned, raw) {
  const list = items ?? []
  const marks = crowned ?? crownedLetters(list.map(it => String(it.text ?? '')).join(' '))
  // 原始分隔符逐档取（`E / Q` → ['/']、`A=Q＞E` → ['='、'＞']）
  const rawSeps = String(raw ?? '').split(/[AEQaeq0-9\s]+/).filter(s => /[>＞≥＝=/／]/.test(s))
  const out = []
  for (const it of list) {
    const parsed = normalizePriorityItems(String(it.text ?? ''), marks)
    parsed.forEach((p, pi) => out.push({
      ...it,
      text: displayText(p.text),
      crown: p.crown === true || it.crown === true,
      sepAfter: pi < parsed.length - 1 ? p.sepAfter : (it.sepAfter || '')
    }))
  }
  // 分隔符优先用 raw 里的原写法，其次用模型里已有的，最后兜底 `＞`
  return out.map((it, i) => {
    if (i === out.length - 1) return { ...it, sepAfter: '' }
    return { ...it, sepAfter: rawSeps[i] || it.sepAfter || '＞' }
  })
}

/**
 * 归一单个段落（按显示类型分派）
 * @param {object} section 渲染模型段落
 * @returns {object}
 */
export function normalizeSection (section) {
  if (!section || typeof section !== 'object') return section
  const title = displayTitle(section.title ?? section.displayTitle)
  const kind = displayKind(section.type ?? section.kind)
  const out = { ...section, title, displayTitle: title, kind }

  if (kind === 'teams') {
    const teams = normalizeTeams(section.teams)
    return { ...out, teams, empty: !teams.some(t => t.members.length || t.note) }
  }
  if (kind === 'rows' || kind === 'stats') {
    const rows = normalizeRowsByTitle(title, section.rows)
    // 行内备注：**统一去掉括注本身**（`（二命）` → `二命`）——
    // 面板模板的 `.rank-item` 会自己补全角括号、网页版的文本自带括号，两侧都不能叠层
    for (const row of rows) {
      for (const it of row.items ?? []) {
        if (it.note) it.note = String(it.note).trim().replace(/^[（(]\s*|\s*[）)]$/g, '')
        // `/`（并列候选）两侧空白归一：面板侧模型文本走一遍 displayText，与网页版一致
        if (it.text) it.text = displayText(it.text)
      }
    }
    // 优先级行：拆 `A=Q` / 补皇冠 `10`，并沿用数据里的分隔符（见 normalizePriorityRow）
    if (/天赋/.test(title)) {
      for (const row of rows) {
        if (/优先级/.test(String(row.label ?? ''))) row.items = normalizePriorityRow(row.items, undefined, row.raw ?? row.items?.[0]?.raw)
      }
    }
    return { ...out, rows, empty: !rows.length }
  }
  if (kind === 'list') {
    const items = (section.items ?? [])
      .map(item => ({ ...item, name: displayText(item.name ?? ''), desc: item.desc ? displayText(item.desc) : item.desc }))
      .filter(item => !isBlankDisplay(item.name))
    return { ...out, items, empty: !items.length }
  }
  if (kind === 'fields') {
    const fields = (section.fields ?? [])
      .map(field => ({ label: displayText(field.label ?? ''), value: displayPanelText(field.value ?? '') }))
      .filter(field => !isBlankDisplay(field.value))
    return { ...out, fields, empty: !fields.length }
  }
  return out
}

/**
 * 归一整个渲染模型的段落数组：
 *   - 标题换成简称（武器 / 圣遗物 / 天赋 / 命座 / 面板 / 配队）
 *   - 空段落统一标 `empty: true`（模板据此显示「暂无」）
 * @param {object[]} sections
 * @param {{keepEmpty?: boolean}} [opts] keepEmpty=false 时丢弃空段（旧行为）
 * @returns {object[]}
 */
export function normalizeSections (sections, opts = {}) {
  const keepEmpty = opts.keepEmpty !== false
  const out = (sections ?? []).map(normalizeSection)
  return keepEmpty ? out : out.filter(section => !section.empty)
}

/**
 * 六个模块的显示级归一（面板侧入口）：按固定顺序补齐缺失模块（补成「暂无」），
 * 保证「武器 / 圣遗物 / 天赋 / 命座 / 面板 / 配队」六块永远都在；
 * 六块之外的段落（仓库以后新加的段）排在后面，原样保留。
 * @param {object[]} sections
 * @returns {object[]}
 */
export function normalizeGuideSections (sections) {
  const normalized = normalizeSections(sections)
  const used = new Set()
  const core = DISPLAY_SECTIONS.map(({ title, kind }) => {
    const hit = normalized.find(section => section.title === title && !used.has(section))
    if (hit) { used.add(hit); return hit }
    const legacy = normalized.find(section => !used.has(section) && String(section.title).includes(SECTION_KEYWORDS[title] ?? title))
    if (legacy) { used.add(legacy); return { ...legacy, displayTitle: title } }
    return emptySection(title, kind)
  })
  const extras = normalized.filter(section => !used.has(section))
  return [...core, ...extras]
}

/* ------------------------------------------------------------------ *
 * 六、文本行 → 显示级文本（网页版路径 / 旧路径用）
 * ------------------------------------------------------------------ */

/**
 * 皇冠行文本 → 必需项字母（`E（必须）Q（建议）` → `['E']`；旧写法 `E10` 也认）
 *
 * 注意：这里的 `10` 只是**旧写法的兼容解析**，渲染模型里皇冠用布尔 `crown` 表达，
 * 文本一律不带 `10`（见 normalizePriorityItems）。
 * @param {string} text
 * @returns {string[]}
 */
export function crownItems (text) {
  const out = []
  const re = /([AEQaeq])\s*(?:10|(?:[（(]([^）)]*)[）)]))?/g
  let m
  while ((m = re.exec(String(text ?? ''))) !== null) {
    const name = m[1].toUpperCase()
    if (m[2] === undefined || m[2] === null || /必须/.test(m[2])) {
      // `X10`（无括注）与 `X（必须）` 都算必需；`X（建议）` 不算
      if (m[2] === undefined ? /\s*10/.test(m[0]) : /必须/.test(m[2])) {
        if (!out.includes(name)) out.push(name)
      }
    }
  }
  return out
}

/** 行内容按标签归一（主词条 `/` 去空格、副词条 `/` → `＞`、其余展开简写） */
function normalizeBodyByLabel (label, value) {
  const v = String(value ?? '').trim()
  if (label === '副词条') return displayText(v).replace(/\s*[/／]\s*/g, '＞')
  return displayText(v)
}

/** 行首标签 → 档位显示标签（`第一档：…` → `推荐：…`、`首选：` → `推荐：`、`过渡：` → `可选：`） */
function displayLineLabel (label) {
  return displayLabel(label)
}

/**
 * 文本行数组 → 显示级文本行
 *
 * 状态在行与行之间（皇冠要并进同段的优先级行、优先级行要并进队伍行的说明），
 * 所以先把整段缓冲下来，最后统一 `flush` —— 不能边读边吐，否则 `注：` 这类
 * 需要并进**前一行**的行会被拆到后面（曾导致配队备注跑到最前面）。
 * @param {string[]} lines
 * @returns {string[]}
 */
export function displayLines (lines) {
  const norm = new LineNormalizer()
  for (const line of lines ?? []) norm.push(line)
  return norm.flush()
}

/** 逐行显示级归一（`displayLines` 的实现体） */
export class LineNormalizer {
  constructor () {
    /** 已定稿、待输出的行：{label, text}（label='' 表示整行文本，不拆档位） */
    this.done = []
    /** 优先级行的下标（皇冠并进这里） */
    this.priorityAt = -1
  }

  /**
   * 归一一行（结果一律进 `this.done`，由 `flush` 统一输出 —— 不靠调用方接返回值）
   * @param {string} line
   * @returns {void}
   */
  push (line) {
    const text = String(line ?? '').trim()
    if (!text) return

    // 皇冠行：必需的并进同段的优先级行，其余整行删除
    const crown = text.match(/^皇冠[:：]\s*(.*)$/)
    if (crown) {
      const crowned = crownItems(crown[1])
      if (crowned.length) this.mergeIntoPriority(crowned)
      return
    }

    // 段末备注行 `注：…` 原样
    if (/^注\s*[:：]/.test(text)) { this.done.push({ text }); return }

    // 命座行 `二命——说明` → `命之座2：说明`（必须**先于** `标签：值` 判断，
    // 否则 `二命——…` 会被当成 label「二命」、value「——…」，命座号就不见了）
    const dash = text.match(/^(.*?)——\s*(.*)$/)
    if (dash) {
      const idx = constellationNumber(dash[1])
      if (idx) {
        const tail = displayText(dash[2] ?? '')
        this.done.push({ text: tail ? `命之座${idx}：${tail}` : `命之座${idx}` })
        return
      }
    }

    const kv = text.match(/^([^：:]{1,12})[:：]\s*(.*)$/)
    if (kv) {
      const label = displayLabel(kv[1])
      const value = String(kv[2] ?? '').trim()
      if (label === '优先级') {
        const parts = splitRankTokens(value)
        // 记下每一档**实际的**分隔符（`>` / `≥` / `＝` 各归各位，不被统一成 `＞`）
        this.done.push({ label, parts, seps: parts.slice(0, -1).map(p => p.sep || '＞') })
        this.priorityAt = this.done.length - 1
        return
      }
      this.done.push({ label, text: normalizeBodyByLabel(label, value) })
      return
    }

    // 剩下的裸行（没有 `标签：` / `——` 结构）原样做显示级文本归一
    this.done.push({ text: displayText(text) })
  }

  /**
   * 把皇冠并进同段的优先级行：命中的字母标 `crown: true`（**不再往文本里写 `10`**），
   * 文本保持 `优先级：Q＞E＞A`，皇冠由渲染层用「图标角上的皇冠徽标」表达。
   * @param {string[]} crowned 必需项字母（如 ['E']）或旧写法 ['E10']
   */
  mergeIntoPriority (crowned) {
    const letters = crowned.map(c => String(c).match(/[AEQ]/)?.[0] ?? '').filter(Boolean)
    const row = this.priorityAt >= 0 ? this.done[this.priorityAt] : null
    if (row && Array.isArray(row.parts)) {
      for (const part of row.parts) {
        const name = String(part.text.match(/[AEQ]/) ?? '')
        if (name && letters.includes(name)) part.crown = true
      }
      // 皇冠行里有、但优先级行没提到的字母：不新增条目（文本保持原样），仅记录在行上供渲染层参考
      const present = new Set(row.parts.map(part => String(part.text.match(/[AEQ]/) ?? '')))
      row.crownedExtra = letters.filter(l => !present.has(l))
      return
    }
    // 只有皇冠行、没有优先级行：保留皇冠字母本身（此时不再有 `10`）
    this.done.push({ label: '优先级', parts: letters.map(text => ({ text, sep: '' })), crownedCrowns: true })
    this.priorityAt = this.done.length - 1
  }

  /** 收尾：把结构化行渲染成文本行 */
  flush () {
    return this.done.splice(0, this.done.length).map(row => {
      if (Array.isArray(row.parts)) {
        const body = row.parts.map((p, i) => p.text + (i < row.parts.length - 1 ? (row.seps?.[i] || '＞') : '')).join('')
        return `${row.label}：${body}${row.tail ? `　${row.tail}` : ''}`
      }
      return row.label ? `${row.label}：${row.text}` : row.text
    })
  }}
