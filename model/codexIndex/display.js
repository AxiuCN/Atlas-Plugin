/**
 * 角色攻略「纯显示级」归一 —— 网页版（build-html.mjs）与游戏内面板
 * （Atlas-Plugin/model/codexIndex/parse.js）共用同一份规则。
 *
 * 分层约定（重要）：
 *   - **文本级归一**（措辞替换、符号替换、简写展开）属于数据侧，放在 scripts/lib/schema.mjs 的
 *     `deriveSections`，并让 parse-docx.mjs 能反向读懂；doc → JSON → doc 必须保持往返相等。
 *   - **纯显示级**（标题简称、档位标签、空行/空模块、皇冠并入天赋、命座「命之座X」、
 *     副词条 `=`/`＞`、简写展开、面板 `0%` 行）**只在本模块做**，一个字都不写回 JSON / docx。
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
 *
 * ===================================================================
 * 档位词汇表（用户定稿：**三档**，只有这三个是显示用档位词）
 * ===================================================================
 *   第 1 档 → `推荐`      第 2 档 → `可选`      第 3 档 → `过渡`
 *
 *   - 来源写法（**文档词汇**，必须原样保留以支持 doc → JSON → doc 往返）：
 *     `第一档` / `第二档` / `第三档`、`首选` / `次选` / `可选` / `过渡` / `套装`。
 *     其中 `首选`→`推荐`、`其他`/`次选`/`可选`→`可选`；`过渡` 与 `第一~三档` 的
 *     对应关系见 TIER_LABEL / TIER_BY_INDEX。
 *   - 显示写法（**显示词汇**，只由本模块产出）：`推荐` / `可选` / `过渡`。
 *   - `TIER_BY_INDEX` 是档位序号的唯一权威；`推荐/可选/过渡` 属于显示词汇，
 *     `displayLabel` 对它们**直接放行**（不做二次归一，见 displayLabel 内的提前返回）。
 *   - 档位行内容为空时**整行不渲染**（不允许出现「过渡：」这种只有标签没有内容的行），
 *     由 `rowIsEmpty` + `normalizeSection` 统一保证，网页版与面板共用同一条规则。
 *   - **自定义档位词**（用户定稿）：行的 `label` 非空时**它就是这一行的标签**
 *     （如把「推荐」写成「建议」→ 文档 `建议：西风剑`、网页版 / 面板同显 `建议`）；
 *     此时**不写** `第N档：`、也不看 `tier`。两端与文档层同口径：
 *     显示 = `displayLabel`（本文件）、文档 = `schema.renderWeaponRow`。
 *     所以「自定义词」与「档位序号」在文档里是**互斥**的（一行只有一个标签词），
 *     编辑器负责在输入时二选一（见 `resources/editor/app.js` 的 `isCustomLabel`），
 *     避免出现 `建议：第一档：…` 这种文档层无法还原的写法。
 *
 * ===================================================================
 * 符号语义（用户定稿，四处一致：正文行 / 面板 / 网页版 / 文档）
 * ===================================================================
 *   `=`（显示 `＝`）  同级 / 等价    → 两个独立 chip，中间显示 `=`
 *   `/`              或者 / 可替换  → 同一个 chip 内 `/`（二选一）
 *   `>`（显示 `＞`）  优先级 / 顺序  → 前后有序，不可互换
 *   实现见 `displaySep` / STAT_ALIASES 顶部注释 / `deriveSections`（schema.mjs）。
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

/**
 * 武器段的固定小字说明（用户定稿 2026-09-26）。
 *
 * 三星 / 四星武器默认按满精（精5）推荐，所以条目里**不再逐个写「（精5）」**；
 * 五星武器默认精1，真要指定满精时仍写在条目的 `note` 上（如 `波乱月白经津（精5）`）。
 * 文案在显示层写死、不进数据：文档 / JSON / 编辑器都不需要维护这句话。
 * （口径上是原神攻略的说法；面板的攻略页目前只由本仓库 data/gi 供给。）
 */
export const WEAPON_REFINE_HINT = '（四星/三星武器默认为精5）'

/**
 * 模块级「无需填写」时攻略页显示的自由说明（用户定稿 2026-09-26）。
 *
 * 角色 JSON 顶层 `freeModules: ['talents']` 表示**这个角色这个模块本身就无需填写**：
 * 编辑器左栏不再显示它的「未填」，攻略页在**空模块**处显示下面这一行（替代「暂无」）。
 * 文案只在显示层写死（网页版与面板共用这一份，见 `normalizeGuideSections` 的 `opts.free`）。
 */
export const FREE_MODULE_HINTS = {
  weapons: '自由选择',
  artifacts: '自由搭配',
  talents: '无需加点',
  panels: '无硬性要求',
  constellations: '无关键命座',
  teams: '自由配队'
}

/** 行内备注前缀（配队括注统一成 `注：`，与段末「注：」备注行同一套写法） */export const NOTE_PREFIX = '注：'

/** 行内备注分隔符（同一行多条备注合并） */
export const NOTE_SEP = '；'

/** 毕业面板「≤3 条合并成一行」时条目之间的分隔（全角空格：既是间距也是分隔，不画长横线） */
export const PANEL_MERGE_SEP = '　'

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

/**
 * 档位标签：**来源写法（文档词汇）→ 显示写法（显示词汇）**。
 *
 * 只有 `首选`→`推荐`、`其他`/`次选`→`可选` 是真正的"改写"；
 * `可选` / `过渡` / `推荐` 本身已经是显示词汇，`displayLabel` 会**提前放行**（不再二次归一），
 * 所以这里**不要**给 `过渡` 配 `可选` —— 那会让"三档"口径自相矛盾，且是永远走不到的死代码。
 * 档位序号的权威是 TIER_BY_INDEX。
 */
export const TIER_LABEL = {
  第一档: '推荐',
  第二档: '可选',
  第三档: '过渡',
  首选: '推荐',
  其他: '可选',
  次选: '可选',
  套装: '推荐'
}

/**
 * 档位序号 → 显示档位词（**三档口径的唯一权威**）。
 * 第 1/2/3 档 = 推荐 / 可选 / 过渡；下标 0 占位（档位从 1 开始）。
 * 只有两档的角色只用到前两个；第三档内容为空时整行不渲染（见 rowIsEmpty）。
 */
export const TIER_BY_INDEX = ['', '推荐', '可选', '过渡']

/**
 * 圣遗物档位的 `kind` → **来源写法（文档词汇）**。
 *
 * ⚠ 这里是**文档词汇**，不是显示词汇：`kind` 是内部键名（不改），
 * 但拼"行首标签"时必须先取这里的来源写法、再交给 `displayLabel` 归一，
 * 这样面板与网页版**同一份映射**，不会出现"面板显示首选、网页显示推荐"的两端漂移。
 * 显示词一律不要硬编码在本表里。
 */
export const ARTIFACT_KIND_LABEL = {
  preferred: '首选',
  transition: '过渡',
  optional: '可选'
}

/**
 * 简写 / 固定术语 → 全称映射表（**全仓唯一一份**）。
 *
 * ⚠ 这是"固定术语"的**唯一权威**：网页版（`build-html.mjs`）、面板（`parse.js`）、
 *   编辑器（`/api/preview` 与表单 chip）**全部只走这一份**，任何一侧都不要再写本地展开表。
 *   校验：`check-display-sync.mjs` 保证本文件与插件 `model/codexIndex/display.js` 逐字节相同。
 *
 * 四列：`[简写, 全称, notBefore?, notAfter?]`
 *   - `notBefore`：命中**后面**紧跟这些字时不换（`充能效率` 里的 `充能`、`暴击率` 里的 `暴击`）
 *   - `notAfter`：命中**前面**是这些字时不换（`元素充能效率` 里的 `充能效率`，避免再叠一层 `元素`）
 * 展开走「长词优先 + 单遍替换」，所以展开结果不会被后续规则再匹配一次。
 *
 * 来源：`原神·角色攻略.docx` 里作者使用的简写（`大攻击` / `充能` / `暴伤` / `双爆`…），
 * 以及面板图鉴词条的标准写法。新识别出简写时**只在这里补一行**即可。
 *
 * 术语分类（便于维护）：
 *   - **同级对**：`双爆` → `暴击率=暴击伤害`（`=` 同级；**不是** `＞` 优先级）
 *   - 大小前缀（**副词条口径，两个都是最终显示形态**）：
 *     `大生命`/`大攻击`/`大防御` = 百分比；`小生命`/`小攻击`/`小防御` = 固定值。
 *     主词条**不写「百分比」**（主词条默认就是百分比）：直接写 `攻击力` / `生命值` / `防御力`。
 *   - 属性别称：`暴伤`/`爆伤` → `暴击伤害`、`精通` → `元素精通`、`充能` → `元素充能效率`
 *   - 部位连写：`充能沙`/`精通头`/`暴击头`/`攻击杯` …
 *   - 恒等项（最长，先命中）：占住已是全称的位置，避免短词再叠一层
 */
export const STAT_ALIASES = [
  // 符号语义（用户定稿）：`=` 同级/等价、`/` 或者/可替换、`>`（显示 `＞`）优先级/顺序。
  // `双爆` 是两个**同级（等价）**候选 → 展开成 `=`，渲染层切成**两个独立 chip、中间显示 `=`**
  // （不是挤在一个 chip 里、也不是 `>` 优先级，更不是 `/` 的「二选一」）。
  // `双爆` 是**固定术语**：默认就是**同级（等价）**，展开恒为 `暴击率=暴击伤害`（`=` 同级），
  // 与优先级 `＞` 无关，**不需要任何启发式判断**。网页版 / 面板 / 编辑器（表单与预览）
  // 全部只走这一份表，任何一侧都不要自己再写一份展开。
  //
  // 边界（`notBefore`=后随字、`notAfter`=前邻字）：`双爆` 只在**词条位置**成立；
  // 散文里（`提升双爆` / `提供双爆加成` / `减抗，提升双爆`）必须**原样保留**，
  // 否则会渲染成 `提升暴击率=暴击伤害` 这种读不通的句子。
  ['双爆', '暴击率=暴击伤害', '加头率伤', '升供加抗减提'],
  // 百分比词条统一成**简写**（用户定稿）：`大生命` / `大攻击` / `大防御` **本身就是要显示的形态**，
  // 所以它们是恒等项（占住位置，不再被折成 `生命值` / `攻击力` / `防御力` —— 那是"固定值"语义，会弄错）。
  // 固定值同理（用户定稿）：副词条写 `小生命` / `小攻击` / `小防御`，**也原样显示**。
  // ⚠ `攻击力百分比` **不在这里**：它同时还出现在**主词条**里（旧写法 `时之沙：攻击力百分比`），
  //   而主词条用固定词表、不许改；所以那条只在副词条专属的 `subStatText` 里归一。
  //   主词条现在的写法是**不带「百分比」**的 `攻击力` / `生命值` / `防御力`（默认就是百分比）。
  ['大生命', '大生命'],
  ['大攻击', '大攻击'],
  ['大防御', '大防御'],
  ['生命值百分比', '大生命'],
  ['百分比生命值', '大生命'],
  ['百分比攻击力', '大攻击'],
  ['防御力百分比', '大防御'],
  ['百分比防御力', '大防御'],
  ['小生命', '小生命'],
  ['小攻击', '小攻击'],
  ['小防御', '小防御'],
  ['暴伤', '暴击伤害'],
  ['爆伤', '暴击伤害'],
  // 恒等项（最长，先命中）：把已经是全称的位置占住，后面的短词规则就不会再叠一层
  ['元素充能效率', '元素充能效率'],
  ['元素精通', '元素精通'],
  ['充能效率', '元素充能效率'],
  ['充能沙', '元素充能效率'],
  ['元素充能', '元素充能效率'],
  ['充能', '元素充能效率', '效沙', '24'],
  ['精通头', '元素精通'],
  ['精通沙', '元素精通'],
  ['精通杯', '元素精通'],
  // `2X` / `4X` = **圣遗物件数简写**（`2精通 + 2精通`、`2充能 + 2充能`）：件数后面的词条**不展开**，
  // 否则会把"简写"重新变回全称（`2元素精通`），违背用户口径「2+2 用简写」。
  // 判据用「前邻字符是 2 或 4」—— 正值场景（`265精通`）不受影响。
  ['精通', '元素精通', undefined, '24'],
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
 *   2. 分隔符两侧空格归一（`暴击率 / 暴击伤害` → `暴击率/暴击伤害`、`A = B` → `A＝B`）
 *
 * **符号语义（用户定稿）**：`=` 同级/等价、`/` 或者/可替换（` / ` 形态受保护）、`>` 优先级。
 *
 * **` / `（两侧带空格的斜杠）不动**：那是「同一格里的可替换项」的分隔写法
 * （如配队成员 `迪奥娜 / 阿罗夏`），上游解析层（teamsFromLines / parseMembers）靠它把
 * 候选并回同一格；这里用私有区占位符把它保护起来，出函数前再还原成 ` / `。
 *
 * **不动 `>` 与 `≥`**：档位分隔符由各渲染层的 `sepAfter` 决定
 * （面板用数据原样 `>`，网页版按显示需要换成 `＞`），这里改了会与面板漂移。
 * @param {string} text
 * @returns {string}
 */
export function displayText (text) {
  const out = expandAliases(text)
    // 受保护的 ` / ` 先换成占位符，避免被下面的「两侧空白归一」吃掉空格
    .replace(/ \/ /g, OPTION_SEP_MARK)
    // `/` 两侧空白归一成 `/`，并修掉区间边界上残留的悬挂 `/`（`A / / B` → `A/B`）
    .replace(/[ \t]*[/／][ \t]*/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+|\/+$/g, '')
    // `=`（显示 `＝`）= **同级 / 等价**（`双爆` → `暴击率＝暴击伤害`）：原样保留，
    // 渲染层把它切成两个独立 chip、中间显示 `=`
    .replace(/[ \t]*[=＝][ \t]*/g, '=')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  // 占位符还原成 ` / `（受保护的可替换项分隔符）
  return out.split(OPTION_SEP_MARK).map(s => s.trim()).join(TEAM_OPTION_SEP)
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
 * 档位标签归一（**三档口径**）：`第一档`→`推荐`、`第二档`→`可选`、`第三档`→`过渡`、
 * `首选`→`推荐`、`其他`/`次选`→`可选`。认不出的（自定义队名 / 输出向 / 辅助向 …）原样返回。
 *
 * `推荐` / `可选` / `过渡` **本身就是显示词汇**，命中即原样放行（见下面的提前返回）：
 * 其中 `过渡` 既是来源写法也是第三档的显示词，**不再折成 `可选`** —— 这是三档口径的定稿行为。
 * @param {string} label
 * @param {number|string|null} [tier] 档位序号（**只在 `label` 为空时**才用它）
 * @returns {string}
 */
export function displayLabel (label, tier = null) {
  const raw = String(label ?? '').trim()
  // **自定义词优先**（与文档层 schema.renderWeaponRow、编辑器同口径）：
  // `label` 非空就用它（`建议` 这类自定义档位词原样显示），只有 label 为空时才看档位序号。
  // 为什么必须 label 优先：网页版 / 编辑器预览过去按 tier 算标签，于是
  // 「档位=推荐 + 自定义词=建议」时网页版显示 `推荐`、面板显示 `建议`（两端漂移）。
  if (raw) {
    // 已经是显示词汇（推荐 / 可选 / 过渡）就直接放行，避免二次归一 ——
    // 尤其 `过渡` 是三档口径的第三档显示词，折成 `可选` 会让两个档位撞名。
    if (TIER_BY_INDEX.includes(raw)) return raw
    if (Object.prototype.hasOwnProperty.call(TIER_LABEL, raw)) return TIER_LABEL[raw]
    const m = raw.match(/^第([一二三四五六123456])[档挡]$/)
    if (m) {
      const idx = '一二三四五六'.indexOf(m[1]) + 1 || Number(m[1])
      return TIER_BY_INDEX[idx] ?? raw
    }
    return raw
  }
  const t = Number(tier)
  if (Number.isInteger(t) && t > 0 && TIER_BY_INDEX[t]) return TIER_BY_INDEX[t]
  return ''
}

/**
 * 一个「档位行 / 数据行」是不是空的（**空行整行不渲染**，避免出现 `过渡：` 这类空标签）。
 *
 * 判据按显示口径（`isBlankDisplay`：空串 / `___` 占位 / 只剩标点都算空）：
 *   - 没有条目 → 空；
 *   - 有条目但**全部**没有可显示文本 → 空；
 *   - 只要有一条有内容 → 非空。
 * 面板与网页版共用这一处，保证 `audit-web-vs-panel` 恒为 0。
 * @param {{items?: Array<{text?: string}>}} row
 * @returns {boolean}
 */
export function rowIsEmpty (row) {
  const items = row?.items ?? []
  if (!items.length) return true
  return !items.some(item => !isBlankDisplay(item?.text ?? ''))
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
 * 档位分隔符显示：`/` → `＞`（面板把候选分隔符画成全角 `＞`）、`>` / `≥` / `=` 原样
 *
 * 符号语义（用户定稿，三处一致）：
 *   · `=`（显示 `＝`）= **同级 / 等价**（`双爆` → `暴击率=暴击伤害`）→ 两个独立 chip，中间显示 `=`
 *   · `/` = **或者 / 可替换**（同一格内二选一，如配队成员 `迪奥娜 / 阿罗夏`）→ 同一个 chip 内 ` / `
 *   · `>`（显示 `＞`）= **优先级 / 顺序**（只有原文确实表示先后才用，如 `充能 ＞ 暴击 ＞ 生命值`）
 * @param {string} sep
 * @returns {string}
 */
export function displaySep (sep) {
  const s = String(sep ?? '').trim()
  if (!s) return ''
  // `/`（或者 / 可替换 / 同级）→ **原样 `/`**（用户定稿：`教官/勇者`）。
  // 以前这里折成 `＞`，会把"同级"说成"优先级"，而且和武器行、套装行的口径都不一致。
  if (/^[/／]$/.test(s)) return '/'
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
 * 圣遗物**同级**（源文档里的 `/`）的显示分隔符：**空** ——
 * 两个 chip 紧挨着，不画 `＞`（用户定稿：「同级的圣遗物套装之间不要用 ＞ 区分」）。
 * 只有**优先级**（`>` / `≥`）才保留分隔符。
 */
export const SET_LEVEL_SEP = '/'

/**
 * 两条套装之间的显示分隔符：
 *   · **同级**（源文档 `/`，"这套或那套都行"）→ `/`（字面斜杠，用户定稿：`教官/勇者`）；
 *   · **优先级**（`>` / `≥`）→ 原样（由 displaySep 渲染成 `＞`）。
 * @param {string} raw 源文档里的分隔符
 * @param {string} fallback 认不出时的兜底
 * @returns {string}
 */
function gapSepOf (raw, fallback = '') {
  const t = String(raw ?? '').trim()
  if (!t) return ''
  if (t === '/' || t === '／') return SET_LEVEL_SEP
  if (t === '+' || t === '＋' || t === '&' || t === '＆') return fallback || SET_LEVEL_SEP
  return t
}

/**
 * `2X` / `4X` = **圣遗物件数简写**（`2精通` / `2充能` / `2攻击`…），是"效果描述"不是套装名。
 * @param {string} p
 * @returns {boolean}
 */
function isPieceShorthand (p) {
  return /^[24][^\d\s]/.test(String(p ?? '').trim())
}

/**
 * 组合内的同名去重（`A + A` → `A`）。
 *
 * ⚠ **件数简写不去重**（用户定稿）：`2精通 + 2精通` 是"两套都给精通"的效果描述，
 * 合成一个 `2精通` 会被读成"只要一件 2 件套" —— 用户明确要的是 `2精通+2精通`。
 * 真套装名（`千岩牢固 + 千岩牢固`）仍然去重。
 * @param {string[]} parts
 * @returns {string[]}
 */
function dedupeParts (parts) {
  const out = []
  for (const p of parts ?? []) {
    if (isPieceShorthand(p)) { out.push(p); continue }
    if (!out.includes(p)) out.push(p)
  }
  return out
}

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
  //
  // ⚠ `+` **只有两侧都是件数简写时**才算「同一组合」（用户定稿，2026-09-20）：
  //   2+2 才凑得满 4 件，所以真正的组合只可能是 `2X + 2X`；**全套装名之间的 `+` 是同级选项**
  //   （用户原话：「同级圣遗物套装之间依旧有部分角色为 `+` 而不是 `/`」），显示成 `/`。
  //   例：`如雷的盛怒 + 昔日宗室之仪`      → `如雷的盛怒/昔日宗室之仪`
  //       `2生命 + 2充能 + 角斗士的终幕礼`  → `2生命+2充能 / 角斗士的终幕礼`
  //       `2精通 + 2精通`                  → `2精通+2精通`（仍是同一个 chip）
  const entries = []
  let cur = null
  let prevName = ''
  for (let i = 0; i < sets.length; i++) {
    const name = nameOf(sets[i])
    if (!name) continue
    const pieces = String(sets[i]?.pieces ?? '').trim()
    const joined = i > 0 && isPlus(seps[i - 1]) && isPieceShorthand(prevName) && isPieceShorthand(name)
    const after = String(seps[i] ?? '') // 这一条**后面**的分隔符（最后一条为 ''）
    if (cur && joined) { cur.parts.push(pieces ? `${name}（${pieces}）` : name); cur.gapAfter = after } else { cur = { parts: [pieces ? `${name}（${pieces}）` : name], base: sets[i], gapAfter: after }; entries.push(cur) }
    prevName = name
  }

  // 2. 同名只保留一次：某条目的**全部**套装名都在更靠后的条目里出现过时，整条丢掉
  const lastAt = new Map()
  entries.forEach((e, i) => { for (const p of e.parts) lastAt.set(p, i) })
  const kept = entries.filter((e, i) => e.parts.some(p => lastAt.get(p) === i))

  return kept.map((e, i) => {
    const parts = dedupeParts(e.parts)
    return {
      name: parts.join(SET_COMBO_SEP),
      // 名字里已经拼过括注，这里把原字段清掉，避免模板再补一次
      pieces: '',
      // **同级**（源文档写 `/`，"这套或那套都行"）→ 画 `/`（用户定稿：`教官/勇者`）；
      // 优先级（`>` / `≥`）保留分隔符（由 displaySep 渲染成 `＞`）。见 SET_LEVEL_SEP。
      sepAfter: i === kept.length - 1 ? '' : gapSepOf(e.gapAfter, outSep),
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
    // 等级写法：字母 + 紧跟的 1~2 位数字（`E10` / `A1` / `E 10`），10 = 已投皇冠
    const lvHit = t.match(/^([AEQaeq])\s*(\d{1,2})$/)
    let level = null
    if (lvHit) {
      const lv = Number(lvHit[2])
      if (Number.isInteger(lv) && lv >= 1 && lv <= 10) level = lv
      t = lvHit[1].toUpperCase()
    } else {
      // 旧写法 `X10`（字母 + 10 + 可能的尾巴）：剥掉并转成 level
      const legacy = t.match(/^([AEQaeq])\s*10\s*$/)
      if (legacy) { level = 10; t = legacy[1].toUpperCase() } else t = t.replace(/\s*10\s*$/, '').trim()
    }
    if (!t) return
    const ch = String(t.match(/[AEQ]/) ?? '')
    // 缺省 = 1（用户确认：宁可写 1 也不留「未知」）；皇冠 → 10
    const crown = !!ch && (level === 10 || crowned.includes(ch))
    if (ch && level === null) level = crown ? 10 : 1
    out.push({ text: t, sepAfter: sep, crown, level })
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
 * 武器行的档位分隔符**显示口径**（用户定稿：**正常武器用 `＞`**）：
 *   · `/`、`>`、`＞` → 一律 `＞` —— 武器档位是**优先级链**（第 1 把最推荐），
 *     作者在文档里怎么写（`/` 或 `>`）都按优先级显示；
 *   · `≥` 原样（显式写法）；`+` 原样（同一条目内的组合）。
 *
 * ⚠ “同级且毫无区别”的写法**不在这里**：那是对**条目文字本身**的写法
 *   （例如 `88爆伤/44暴击武器` 是一个条目名），名字原样保留、不会被当分隔符。
 * ⚠ 以前这里一个字都不动，于是 v2 写 ` / ` 的武器行会把字面斜杠画出来（`苍古自由之誓 / 圣显之钥`），
 *   而走文档行的同型行画的是 `＞` —— 同一个模块两种画法。
 * @param {string} sep
 * @returns {string}
 */
function weaponSep (sep) {
  const s = String(sep ?? '').trim()
  if (s === '/' || s === '／') return '＞'
  if (s === '>' || s === '＞' || s === '&gt;') return '＞'
  return s
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
    items: (row.items ?? []).map(it => ({ ...normalizeItem(it), sepAfter: weaponSep(it.sepAfter) }))
  }))
}

/**
 * 副词条**专属**的词条写法再归一（**主词条不许用这一套**）。
 *
 * 只有 `攻击力百分比` 需要在这里：它同时也是**主词条**的固定词
 * （`时之沙：攻击力百分比` / `空之杯：攻击力百分比`），主词条必须保持原样，
 * 所以不能把它放进全局 `STAT_ALIASES`。其余百分比写法（`百分比攻击力` /
 * `生命值百分比` / `防御力百分比` …）只在副词条出现，已直接进全局表。
 * @param {string} text
 * @returns {string}
 */
function subStatText (text) {
  return String(text ?? '').replace(/攻击力百分比/g, '大攻击')
}

/**
 * 副词条分隔符的**符号归一**（只用于 `kind:'sub'` 行，最终口径见 `subSepBetween`）：
 *   `>` / `＞` / `&gt;` → `＞`；`/` → `=`（同级）；`≥` / `=` / 其它原样。
 *
 * `&gt;` 也一起归一：面板侧 `parse.js` 在交给本模块之前已经把分隔符 HTML 转义
 * （`escapeHtml(sep)`），所以这里必须同时认转义形态，否则会出现
 * "网页版 `＞` / 面板 `&gt;`"的两端漂移（`audit-web-vs-panel` 的 canon 会把它当等价而漏掉）。
 * @param {string} sep
 * @returns {string}
 */
function subSep (sep) {
  const s = String(sep ?? '').trim()
  if (s === '/' || s === '／') return '='
  if (s === '>' || s === '＞' || s === '&gt;') return '＞'
  return s
}

/** 显示文本是不是「暴击率」这一侧（`暴击` / `暴击率` 都算） */
function isCritRateText (text) {
  const t = String(text ?? '').replace(/<[^>]*>/g, '').trim()
  return t === '暴击率' || t === '暴击'
}

/** 显示文本是不是「暴击伤害」这一侧（`暴伤` / `爆伤` 展开后也算） */
function isCritDmgText (text) {
  return String(text ?? '').replace(/<[^>]*>/g, '').trim() === '暴击伤害'
}

/**
 * 这一档分隔符该显示成什么（用户定稿 2026-09-21，换代了旧口径）：
 *   · **双爆（暴击率 ↔ 暴击伤害）恒为 `=`**，且在编辑器与攻略图里都**不可被覆盖** ——
 *     源文档写 `/`、`>`、`≥` 还是 `=`，显示一律 `=`（这一对不存在优先级写法）。
 *   · **其余两两之间按数据里存的符号原样渲染**：`>` → `＞`、`≥` → `≥`、`=` → `=`。
 *     编辑器里就是这么让用户改「不同词条之间的优先级」的（唯一真相是 `v2.artifacts[].sep`）。
 *   · 文档里的 `/`＝同级：这个写法**只对双爆成立**，非双爆的 `/` 按优先级显示 `＞`
 *     （旧口径「其他都是大于」的兼容分支；`scan-separators` 会把非双爆的 `/` 报为非法写法）。
 * 判据用**显示文本**（`暴击` / `暴伤` 已经展开成 `暴击率` / `暴击伤害` 后再比）。
 * @param {string} sep
 * @param {string} left 左侧条目的显示文本
 * @param {string} right 右侧条目的显示文本
 * @returns {string}
 */
function subSepBetween (sep, left, right) {
  const pair = (isCritRateText(left) && isCritDmgText(right)) || (isCritDmgText(left) && isCritRateText(right))
  if (pair) return '='
  const raw = String(sep ?? '').trim()
  if (raw === '/' || raw === '／') return '＞'
  return subSep(raw)
}

/**
 * 圣遗物：`首选` → `推荐`、`次选`/`可选` → `可选`；`过渡` 是**第三档显示词，原样保留**；
 * 分隔符**原样保留**（副词条例外：见 `subSep`；其余 `=` 同级、`>` 优先级见 displaySep），简写展开。
 * @param {object[]} rows
 * @returns {object[]}
 */
/**
 * **主词条 / 副词条值末尾的括注** → `{ text, note }`（用户定稿 2026-09-20：括注统一写在**值里**）。
 *
 * 数据里括注跟在**具体那个值**后面：`防御力（特殊）`、`暴击率（西风）`、`水元素伤害加成（二命）`、
 * `暴击率（携带西风秘典时）`。显示时折成「值 + 小字备注」，走与面板/网页版模板 `note` 分支
 * 完全相同的一条路，所以两种历史写法（值里 / `note`+`noteSlot` 字段）看起来一模一样。
 *
 * 只认**末尾那一层**括号（与 parse-docx 的 `NAME_NOTE_RE` 同一判据）；括号出现在值中间
 * 说明写法不对（`scan-separators.mjs` 会警告），因为部位内部的分隔符逻辑会把它切开。
 *
 * ⚠ 凡是要**按值精确匹配**的地方（候选表、别名归一、审计比对）都要先过这个函数拿 `text`。
 * @param {string} value
 * @returns {{text: string, note: string}}
 */
export function splitStatNote (value) {
  const s = String(value ?? '')
  const m = s.match(/^(.*?)\s*[（(]([^（()）]+)[）)]\s*$/)
  return m ? { text: m[1].trim(), note: m[2].trim() } : { text: s, note: '' }
}

export function normalizeArtifactRows (rows) {
  return (rows ?? []).map(row => {
    const fromLabel = String(row.label ?? '')
    const isMain = /主词条/.test(fromLabel)
    const isSub = /副词条/.test(fromLabel)
    const src = row.items ?? []
    // **主词条 / 副词条值末尾的括注 → 条目的 `note`（渲染成小字弱化）**
    // （用户定稿 2026-09-20：括注统一写在**值里**，见 splitStatNote）
    //   历史数据里还有另一种写法：`kind:'main'` 的 `note` + `noteSlot` 字段（面板本来就画成
    //   note、网页版却画成行内括注）。两种写法在显示层收敛到同一个效果 —— 模板的 `note` 分支。
    const splitNote = splitStatNote
    // 先把每条的显示文本算出来（`暴击` → `暴击率`、`爆伤` → `暴击伤害`…），
    // 分隔符要**看着左右两边的文本**决定：只有暴击对才是 `=`，其余都是 `＞`。
    // 括注要在**算分隔符之前**拆掉，否则 `暴击率（西风）` 认不出是暴击对。
    const parsed = src.map(item => {
      const base = isSub ? subStatText(displayItemText(item.text)) : displayItemText(item.text)
      const hasOwnNote = !!String(item.note ?? '').trim()
      if (hasOwnNote || (!isMain && !isSub)) return { text: base, note: '' }
      return splitNote(base)
    })
    const texts = parsed.map(p => p.text)
    return {
      ...row,
      label: displayLabel(row.label),
      items: src.map((item, i) => ({
        ...item,
        // 副词条走 `subStatText`（把 `攻击力百分比` 收成 `大攻击`）；其它行不碰
        text: texts[i],
        // 数据自带 note 优先；否则用从值里拆出来的括注（拆出来的**不带括号**，模板自己补）
        note: item.note ? displayText(item.note) : (parsed[i].note || item.note),
        // 副词条：**只有暴力对之间** `/` 才是同级 `=`，其余 `/` 与 `>` 都显示 `＞`（见 subSepBetween）
        sepAfter: isSub
          ? subSepBetween(item.sepAfter, texts[i], texts[i + 1])
          : displaySep(item.sepAfter)
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
    // 一条说明里用 `/` 并列多个候选（`提升攻击力 / 精通`）时，拆成多条目 —— 与网页版
    // （build-html 的 splitRankParts）形状一致。
    // ⚠ **不再画字面 `/`**（用户反馈：「chip 之间存在 `/` 等残留数据」）：`/` 只是拆分的依据，
    //   拆出来的 chip 之间靠间距区分就够了；字面 `/` 只保留给**圣遗物同级套装**那一条规则。
    const items = []
    rawItems.forEach((it, idx) => {
      const parts = String(it.text ?? '').split(/\s*[/／]\s*/).map(s => s.trim()).filter(Boolean)
      if (parts.length <= 1) { items.push(it); return }
      parts.forEach((p, i) => items.push({
        ...it,
        text: p,
        sepAfter: i < parts.length - 1 ? '' : (it.sepAfter || '')
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
  /**
   * 同一分组的行数 ≤ 3 时**合并成一行**（用户要求：面板内容不多，合并后变矮，给天赋 / 配队留空间）。
   * 面板行的形态有两类，合并时要区别对待：
   *   · `text` 型（`辅助向：暴击率70%+ / 充能240%+`）：整行是说明文本 → 用 `　`（全角空格）连接
   *   · `k/v` 型（`暴击率：70%+`）：键值对 → 合并成 `暴击率：70%+　暴击伤害：200%+`
   * 合并只发生在**同一 label 分组内且条目 ≤ 3** 时；>3 条维持分行（保持可读性）。
   *
   * ⚠ 入参有**两种形状**，必须都认（曾经只认 `k/v`，于是面板模块永远「暂无」）：
   *   · `{ label, k, v }` / `{ label, text }`   —— v2 原始形状（`data/gi/*.json` 的 `v2.panels`）
   *   · `{ label, items: [{ text }] }`          —— 渲染模型形状，**网页版 build-html 与面板 parse.js
   *     实际传进来的就是这种**。
   *     两条链路都按「键值对 → `label` 留空、把 `k：v` 放进 item；说明行 → `label` 就是标签」的约定产出行，
   *     这样同一标签下的多行才能按「≤3 条合并一行」合并成 `暴击率：70%+　暴击伤害：220%+`。
   *     旧代码只判 `row.k === undefined && !row.text` → 每一行都被当成空行丢掉 →
   *     5 个有面板数据的角色（丝柯克/七七/久岐忍/九条裟罗/云堇）以及编辑器里新填的面板行全都「暂无」。
   *
   * ⚠ **分组键要把「空标签的键值行」算进上一行的标签**（2026-09-20 修订，用户指出的现象：
   *   梦见月瑞希的「辅助｜精通：1000+」「辅助｜暴击率：65%」「(无标签)｜暴击伤害：120%」
   *   被拆成两行）。源文档就是这么写的 —— 一条带档位/用途前缀，后面跟着若干**裸数值行**：
   *     主c：攻击力：2200+ / 暴击率：70%+ / 暴击伤害：200%+   ← 温迪文档第 4 节
   *   裸行显然属于同一个 build，所以空标签行**沿用上一个非空标签**再分组，这样
   *   「说明行 + 裸数值行」才能合并成 `主c　攻击力：2200+　暴击率：70%+　暴击伤害：200%+`。
   *   仅当组内行数 ≤3 时合并；>3 条仍分行，且分行时键值行**照旧留空标签**（只借标签分组）。
   */
  const groups = new Map()
  const order = []
  let carriedLabel = ''
  for (const row of rows ?? []) {
    const own = String(row?.label ?? '')
    if (own) carriedLabel = own          // 带标签的行 → 刷新「当前 build」
    const key = own || carriedLabel      // 空标签行 → 跟随当前 build（前面没有标签时仍是 ''）
    if (!groups.has(key)) { groups.set(key, []); order.push(key) }
    groups.get(key).push(row)
  }
  for (const key of order) {
    const rowsInGroup = groups.get(key) ?? []
    const kept = []
    for (const row of rowsInGroup) {
      const note = row.note ? displayText(row.note) : row.note
      const own = String(row?.label ?? '')   // 行**自己的**标签（键值行为空）：分行时用它，合并时用分组键
      // ① v2 原始形状 `{k, v}`：键值对 → 折成 `k：v`（label 留空，便于同组合并）
      if (row.k !== undefined) {
        const v = String(row.v ?? '').trim()
        if (isBlankDisplay(v)) continue            // 只有键没值（编辑器里刚敲了键）→ 不渲染
        kept.push({ label: '', items: [{ text: `${displayText(row.k ?? '')}：${v}`, sepAfter: '' }], note })
        continue
      }
      // ② v2 原始形状 `{text}`（带标签 = 说明行；`label` 为空 = 裸数值行）
      if (row.text !== undefined && !row.items) {
        const t = displayPanelText(row.text)
        if (!t || isZeroValue(t)) continue
        // 行自己的标签（空就是空）：合并成一行时用**分组键**当标签，分行时裸数值行不带标签
        kept.push({ label: displayText(own), items: [{ text: t, sepAfter: '' }], note })
        continue
      }
      // ③ 渲染模型形状 `{label, items}`：两条链路（build-html / parse.js）产出的就是这种。
      //    label 为空 = 键值对（`暴击率：70%+` 已经在 item 文本里）；label 非空 = 说明行。
      const items = (row.items ?? [])
        .map(it => ({ ...it, text: displayText(it.text) }))
        .filter(it => String(it.text ?? '').trim())
      if (!items.length) continue
      kept.push({ label: displayText(own), items, note })
    }
    if (!kept.length) continue
    if (kept.length <= 3) {
      // **≤3 条合并成一行**（用户要求：面板内容不多，合并后变矮，给天赋 / 配队留空间）：
      // 把各行的 items 依次拼进同一行；**行与行之间**用 `　`（全角空格：既是间距也是分隔），
      // 行**内部**的分隔符（说明行里 `/` 拆出来的候选）原样保留，不要被 `　` 顶掉。
      const items = []
      kept.forEach((row, i) => {
        row.items.forEach((it, j) => {
          const lastOfRow = j === row.items.length - 1
          const lastOverall = i === kept.length - 1
          items.push({ ...it, sepAfter: lastOfRow ? (lastOverall ? '' : PANEL_MERGE_SEP) : (it.sepAfter || '') })
        })
      })
      if (!items.length) continue
      out.push({ label: displayText(key ?? ''), items, mergedFrom: kept.length })
      continue
    }
    // >3 条维持分行（保持可读性）
    for (const row of kept) out.push({ ...row, label: displayText(row.label ?? key ?? '') })
  }
  return out
}
/** 行内备注（成员括注 / 队伍说明）→ `注：…` 文本；要不要加前缀由调用方按 NOTE_PREFIX_RULE 决定 */
function noteLine (notes) {
  const parts = notes.map(t => String(t ?? '').trim()).filter(Boolean)
  return parts.length ? `${NOTE_PREFIX}${parts.join(NOTE_SEP)}` : ''
}

/**
 * 「注：」前缀的使用规则（网页版与面板必须一致；`scripts/lib/guide-display.mjs`
 * 与插件 `display.js` 逐字节同步）
 *
 *   1. **对已有内容的补充 / 限定** → 加 `注：`，放在**行尾**、渲染成小一号灰字。
 *      例：`推荐：丝柯克 + 希诺宁 + 芙宁娜　注：希诺宁为二命`、
 *          `主词条：… ｜ 空之杯：生命值 注：建议二命及以上使用水伤杯`。
 *   2. **段落最下方那条纯文字行**（没有成员、也没有档位词）→ 加 `注：`。
 *      例：`注：建议二命及以上；高金配置`。
 *   3. **整行就是这一行的内容**（带档位词、没有成员）→ 不加 `注：`。
 *      例：`可选：自由选择`（不是 `可选：注：自由选择`）、`推荐：减抗位`。
 *   4. **成员自带的说明用行内全角括弧**（用户定稿 2026-09-20：与圣遗物的
 *      `千岩牢固（四件套）` 同款，比 `… + 希诺宁　注：二命` 精简）：
 *      `叶洛亚 / 希诺宁（二命）` —— 不升级成 `注：`。
 *
 * 实现：模型里把备注存成 `note`（**不带前缀**）并给一个 `notePrefix`；
 * 渲染层据此决定加不加 `注：`（网页版见 build-html.mjs，面板见 codex.html 的 `team.notePrefix`）。
 */
export const NOTE_PREFIX_RULE = '注：只给「补充/限定」与段末那条纯文字行；带档位词、整行就是内容的不加；成员括注用行内全角括弧（见 guide-display.mjs 注释）'

/** 成员括注算不算「备注走廊」（命座 / 成本类）：与 schema.mjs 的 isCostNoteText 同一判据 */
export function isCostNote (text) {
  const s = String(text ?? '').trim()
  if (!s) return false
  if (/^[一二三四五六\d]+\s*命$/.test(s)) return true
  return /^(高金|中金|低金|随命座)$/.test(s)
}

/** 成员格内「可替换项」的分隔符（显示口径固定为 ` / `，两侧各一个半角空格） */
export const TEAM_OPTION_SEP = ' / '
/** 过 displayText 时保护 ` / ` 的占位符（私有区字符，正文不会出现） */
const OPTION_SEP_MARK = '\uE000'

/**
 * 成员格文本：同一格里的可替换项（`迪奥娜 / 阿罗夏`）并回一格后再做显示归一。
 * ` / ` 先换成占位符：displayText 会把「分隔符两侧空白」归一掉（`A / B` → `A/B`），
 * 那会让成员格里的斜杠看起来像档位分隔符，成员被误拆或误并。
 * @param {string} text
 * @returns {string}
 */
export function joinOptionText (text) {
  const marked = String(text ?? '').replace(/\s*[/／]\s*/g, OPTION_SEP_MARK)
  return displayText(marked).split(OPTION_SEP_MARK).map(s => s.trim()).filter(Boolean).join(TEAM_OPTION_SEP)
}

/**
 * 配队：`首选` → 推荐、`其他` → 可选；**自定义队名（月感电 / 火神队 …）原样**。
 *
 * **成员括注留在成员身上**（用户定稿 2026-09-20：「把备注也改为圣遗物同款括弧，去掉『注：』，
 * 只有最下方的文字行才用 `注：`」）：渲染成 `叶洛亚 / 希诺宁（二命）`——与圣遗物的
 * `千岩牢固（四件套）` 同一种写法，比 `… + 希诺宁　注：二命` 精简。
 * （以前这里会把「命座 / 成本」类括注提到行尾当备注，现已取消。）
 *
 * `note` 一律**不带** `注：` 前缀，由 `notePrefix` 决定渲染时加不加（规则见 NOTE_PREFIX_RULE）：
 *   · 有成员 → 行尾备注是补充说明，`notePrefix: true`（`… + 芙宁娜　注：希诺宁为二命`）
 *   · 没有成员、**也没有档位词**（整行就是那条备注，通常是段落最下方那行）→ `notePrefix: true`
 *     （`注：建议二命及以上；高金配置`）
 *   · 没有成员、但有档位词（`可选：自由选择`）→ `notePrefix: false`（备注就是这一行的内容）
 * @param {object[]} teams
 * @returns {object[]}
 */
export function normalizeTeams (teams) {
  return (teams ?? []).map(team => {
    const notes = []
    const members = (team.members ?? []).map(member => {
      // 同一格里的可替换项（旧数据的 `A / B` 两格写法）并回一格：`迪奥娜 / 阿罗夏`。
      // ` / ` 先换成占位符再过 displayText —— 它会做「分隔符两侧空白归一」（`A / B` → `A/B`），
      // 直接过一遍会把成员的斜杠和档位分隔符的斜杠混成同一个字形（成员就被误拆/误并）。
      const name = joinOptionText(member.name)
      // 成员括注原样留在成员上（模板渲染成 `（二命）` 行内括弧）
      return { ...member, name, note: String(member.note ?? '').trim() }
    })
    if (team.text) notes.push(displayText(team.text))
    // 旧文本行路径（插件 parse.js 的 linesToTeams）把 `注：xxx` 解析成 tag='注' + 空成员：
    // 这里把它还原成**整行备注**，与网页版 teamsFromLines 的结果对齐
    let tagRaw = String(team.tag ?? '').trim()
    let inlineNote = ''
    if (!members.length && /^注\s*[:：]?$/.test(tagRaw)) { inlineNote = displayText(tagRaw.replace(/^注\s*[:：]?/, '')); tagRaw = '' }
    // Web 路径（build-html 的 teamsFromLines）已经解析过一次：那时备注在 `note` 里、`text` 是空的。
    // 这里要把它接过来，否则「整行只有一条说明」的行会被判成空行、标签也一起丢掉。
    const rawText = String(team.text ?? '').trim()
    const existingNote = String(team.note ?? '').trim().replace(/^注\s*[:：]/, '') || inlineNote
    const text = (notes.map(t => String(t ?? '').trim()).filter(Boolean).join(NOTE_SEP)) || existingNote
    // 「注：」只给「对已有内容的补充/限定」与**段落最下方那条纯备注行**（无成员、无档位词）
    const notePrefix = team.notePrefix !== undefined
      ? team.notePrefix === true
      : (members.length > 0 || !tagRaw)
    const tag = displayLabel(tagRaw)
    // 没有成员也没有备注的行不画标签，避免渲染出空的「可选：」
    const hasBody = members.length > 0 || !!text || !!rawText || !!existingNote
    return { ...team, tag: hasBody ? tag : '', tagClass: tierLabelClass(tag), members, text: '', note: text || existingNote, notePrefix: text || existingNote ? notePrefix : false }
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
      // 等级：文档里的数字优先，其次数据里的 field，最后按「皇冠=10 / 其它=1」兜底
      level: Number.isInteger(p.level) ? p.level : (Number.isInteger(Number(it.level)) && Number(it.level) >= 1 && Number(it.level) <= 10 ? Number(it.level) : (p.crown || it.crown === true ? 10 : 1)),
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
    // 空档位行整行不渲染：「过渡：」这类只有标签、条目全空白的行一律丢掉。
    // 判据与面板侧完全一致（同一份 rowIsEmpty），所以两端不会各有各的空行。
    const kept = rows.filter(row => !rowIsEmpty(row))
    return { ...out, rows: kept, empty: !kept.length }
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
/**
 * 段落固定小字说明（显示层写死，不来自数据）：武器段有内容时挂上「三星/四星默认精5」。
 * 空段（显示「暂无」）没有条目，不挂。
 * @param {object} section 已归一的段落
 * @returns {object}
 */
function attachSectionHint (section) {
  if (!section || section.empty || section.title !== '武器') return section
  return { ...section, hint: WEAPON_REFINE_HINT }
}

export function normalizeSections (sections, opts = {}) {
  const keepEmpty = opts.keepEmpty !== false
  const out = (sections ?? []).map(normalizeSection).map(attachSectionHint)
  return keepEmpty ? out : out.filter(section => !section.empty)
}

/**
 * 把「该模块无需填写」落到显示模型上：**空模块**换成一行自由说明（替代「暂无」）。
 *
 * 有内容的模块原样返回 —— 渲染层唯一的判据就是「空不空」，
 * 所以「标记之后又填了内容」的旧标记不会和内容打架（内容优先）。
 * 网页版（`build-html.mjs`）与面板（`parse.js`）都调这一份，两侧自然同文案同位置。
 * @param {object[]} sections 已归一的段落
 * @param {string[]} [free] 角色 JSON 的 `freeModules`（v2 键：weapons / artifacts / …）
 * @returns {object[]}
 */
export function applyFreeHints (sections, free) {
  const list = new Set(Array.isArray(free) ? free : [])
  if (!list.size) return sections
  const keyByTitle = new Map(DISPLAY_SECTIONS.map(d => [d.title, d.key]))
  return (sections ?? []).map(section => {
    const key = keyByTitle.get(section?.title)
    if (!key || !list.has(key) || !section.empty) return section
    return { ...section, empty: false, rows: [], hint: FREE_MODULE_HINTS[key] }
  })
}

/**
 * 六个模块的显示级归一（面板侧入口）：按固定顺序补齐缺失模块（补成「暂无」），
 * 保证「武器 / 圣遗物 / 天赋 / 命座 / 面板 / 配队」六块永远都在；
 * 六块之外的段落（仓库以后新加的段）排在后面，原样保留。
 *
 * `opts.free`（角色 JSON 的 `freeModules`）：列出的模块**空着时**显示一行自由说明
 * （见 `applyFreeHints`），不再显示「暂无」。
 * @param {object[]} sections
 * @param {{free?: string[]}} [opts]
 * @returns {object[]}
 */
export function normalizeGuideSections (sections, opts = {}) {
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
  return applyFreeHints([...core, ...extras], opts.free)
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

/** 行内容按标签归一（分隔符字形原样；**副词条例外**：`/` 同级 → `=`、`>` 优先级 → `＞`） */
function normalizeBodyByLabel (label, value) {
  const v = String(value ?? '').trim()
  // 副词条：源文档里 `/`（同级/并列，都要堆）显示成 `=`，`>`（优先级）显示成 `＞`。
  // **不能**把 `/` 折成 `＞`：那会把"同级"误说成"优先级"（`暴击率 / 暴击伤害` 应显示 `暴击率=暴击伤害`）。
  if (label === '副词条') {
    return subStatText(displayText(v))
      .replace(/\s*[/／]\s*/g, '=')
      .replace(/＝/g, '=')
      .replace(/\s*[>＞]\s*/g, '＞')
  }
  return displayText(v)
}

/** 行首标签 → 档位显示标签（`第一档：…` → `推荐：…`、`首选：` → `推荐：`；`过渡：` 是三档显示词、原样保留） */
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
