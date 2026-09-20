/**
 * 角色攻略数据解析（Character-Codex-Data）
 *
 * 攻略仓库当前以 JSON 发布：data/<gameId>/<角色名>.json，字段规范见该仓库 README。
 * 本模块负责把 JSON 归一为模板可消费的卡片结构，并把行内强调约定转成 HTML：
 *   - `**文字**` → <span class="must">，`==文字==` → <span class="highlight">
 *   - 正文是纯文本，标签由本模块生成（不信任数据里的 HTML）
 *   - 段落配图 image 为仓库内相对路径，解析为 file:// 绝对路径；站外地址与缺失文件丢弃（运行期不联网）
 *
 * 正文展示形态在这里定：按段落标题把自由文本整理成
 *   「标签 + 内容」行（rows）/ 队伍成员（teams）/ 数值行（stats），模板只负责画。
 *
 * **纯显示级归一**（标题简称、档位标签 推荐/可选/过渡、副词条 ＞、简写展开、皇冠并入天赋、
 * 命座「命之座X」、配队括注移行尾「注：」、2+2 组合整体保留、同名套装去重、空模块「暂无」）
 * 统一走 ./display.js —— 与数据仓库的网页版（scripts/lib/guide-display.mjs）同一份规则，
 * 两边逐字节相同（数据仓库 scripts/check-display-sync.mjs 校验）。
 *
 * 数据格式两代并存，**v2 优先**：
 *   - `data.schema === 2` 且带 `data.v2` 时，直接用结构化字段生成渲染模型（见 buildV2Sections）：
 *     武器/套装/天赋/命座的每个条目都带 `ref`（`weapon:西风剑` 这类类型前缀），
 *     图标解析因此不必再靠「猜这一行里的名字是武器还是圣遗物」，见 ./icons.js
 *   - 没有 v2（或 v2 为空、缺字段）时，逐字回退到旧版文本行解析（data.sections[].lines），
 *     行为与改造前完全一致；两代数据的输出结构同一个形状，模板与编排层无需分支
 *   - `data.unparsed` 里未结构化的文本行按普通行追加到对应段落末尾
 *
 * 同时保留旧版 HTML 页面的解析（parseGuideHtml），供尚未拉取到 JSON 数据的旧克隆兜底；
 * 仓库里一旦存在 JSON 数据，索引层就只认 JSON（见 index.js）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { DISPLAY_SECTIONS, normalizeGuideSections, resolveSetItems, displayItemText, displayLabel, ARTIFACT_KIND_LABEL } from './display.js'

/** 正文中允许保留的内联类名（样式见 resources/common/codex.css） */
const ALLOWED_SPAN_CLASS = new Set(['must', 'highlight'])

/** v2 引用标记（`[[w:西风剑]]`）：结构化数据由 ref 字段承载，正文若混写标记也按纯文本展示 */
const REF_MARK_RE = /\[\[[a-z][:：]([^[\]]+?)\]\]/g

/** 纯文本字段需要解码的 HTML 实体（仅 HTML 旧格式用） */
const ENTITY_MAP = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ldquo: '“',
  rdquo: '”',
  hellip: '…'
}

/* ============================================================
 *  通用工具
 * ============================================================ */

/** 取出标签属性值（兼容单/双引号），返回首个非空捕获 */
function attrOf (tag, name) {
  const m = String(tag).match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'))
  if (!m) return ''
  return m[1] ?? m[2] ?? ''
}

/** 属性值转义（用于本模块自行写出的 alt） */
function escapeAttr (text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 纯文本转义（JSON 数据是纯文本，标签由本模块生成） */
function escapeHtml (text) {
  return escapeAttr(text)
}

/**
 * 行内强调约定 → HTML（**着重** / ==高亮==）
 * @param {*} text - 纯文本
 * @returns {string} 转义后的 HTML 片段
 */
function inlineHtml (text) {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<span class="must">$1</span>')
    .replace(/==([^=]+)==/g, '<span class="highlight">$1</span>')
}

/** 内容里的「>」换成视觉分隔符（转义后再替换，避免误伤标签） */
function decorateValue (text) {
  return inlineHtml(text).replace(/ &gt; /g, ' <span class="sep">&gt;</span> ')
}

/** 去掉 v2 引用标记只留名称（结构化数据一般不用，混写时兜底） */
function stripMarks (text) {
  return String(text ?? '').replace(REF_MARK_RE, '$1')
}

/** v2 取值文本（去标记 + 行内强调 + 档位分隔符） */
function inlineText (text) {
  return decorateValue(stripMarks(text))
}

/** v2 标签/名称文本（去标记 + 行内强调） */
function inlineLabel (text) {
  return inlineHtml(stripMarks(text))
}

/** 皇冠等级里的「必须」沿用现有的红色小标签（见 codex.css 的 .must），其余按普通备注 */
function levelHtml (level) {
  const text = String(level ?? '').trim()
  if (!text) return ''
  return /必须/.test(text) ? `<span class="must">${escapeHtml(text)}</span>` : inlineLabel(text)
}

/**
 * 攻略仓库内的相对图片路径 → file:// 绝对路径
 * 只接受仓库内存在的相对路径；站外地址（http/https/data）、带协议或盘符的路径、越界路径与缺失文件返回空串
 * @param {string} fileDir - 数据文件所在目录的绝对路径
 * @param {string} src - 数据里的相对路径
 * @returns {string} file:// URL；不可用时为空串
 */
function resolveImage (fileDir, src) {
  const raw = String(src || '').trim()
  if (!raw || !fileDir) return ''
  // 带协议前缀的（http: https: data: file: C: 等）一律不取，避免运行期联网
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return ''
  const root = path.resolve(fileDir)
  const target = path.resolve(root, raw.replace(/^\.\//, '').replace(/^[/\\]+/, ''))
  if (target !== root && !target.startsWith(root + path.sep)) return ''
  try {
    if (!fs.statSync(target).isFile()) return ''
  } catch {
    return ''
  }
  return pathToFileURL(target).href
}

/* ============================================================
 *  正文分行（展示层归一）
 * ============================================================ */

/**
 * 段落展示形态（数据是自由文本，这里只按标题关键词决定怎么画）
 * - teams：配队 / 队伍 / 阵容 → 每行一支队伍，成员拆成独立标签
 * - stats：面板 / 属性 → 数值行用大字号，方便扫读
 * - rows：默认 → 「标签 + 内容」行
 * @param {string} title
 * @returns {'rows' | 'teams' | 'stats'}
 */
function sectionKind (title) {
  if (/配队|队伍|阵容/.test(title)) return 'teams'
  if (/面板|属性/.test(title)) return 'stats'
  return 'rows'
}

/**
 * 在顶层分隔符处切分（跳过括号内部），用于把「A / B / C」这类并列内容拆成多行
 * @param {string} text
 * @param {string} sep
 * @returns {string[]}
 */
function splitTop (text, sep) {
  const out = []
  let depth = 0
  let buf = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if ('(（[【'.includes(ch)) depth += 1
    else if (')）]】'.includes(ch)) depth = Math.max(0, depth - 1)
    if (depth === 0 && text.startsWith(sep, i)) {
      out.push(buf)
      buf = ''
      i += sep.length - 1
      continue
    }
    buf += ch
  }
  out.push(buf)
  return out.map(part => part.trim()).filter(Boolean)
}

/**
 * 行 → 标签 + 内容：在第一个冒号或破折号处切分，左侧超过 8 字则不切（避免切断长句）
 * @param {string} line
 * @returns {{label: string, value: string}}
 */
function splitLabel (line) {
  const text = String(line || '').trim()
  const colon = text.match(/^([^：:]{1,8})[：:]\s*(.+)$/)
  if (colon) return { label: colon[1].trim(), value: colon[2].trim() }
  const dash = text.match(/^([^—]{1,8})——\s*(.+)$/)
  if (dash) return { label: dash[1].trim(), value: dash[2].trim() }
  return { label: '', value: text }
}

/**
 * 值是否为空（空串、只有占位符 `___`、或只剩标点）：攻略页默认不显示这类待补栏位
 * @param {string} html
 * @returns {boolean}
 */
function isBlankText (html) {
  const text = plainText(html)
  if (!text) return true
  if (text.includes('___')) return true
  // 去掉「标签：」「标签——」前缀后还有没有实际内容（「第二档：」这类待补栏位算空）
  const rest = text.replace(/^[^：:—]{1,8}[：:—]+/, '').trim()
  if (!rest) return true
  return /^[_\-—·、/：:（）()]+$/.test(rest)
}

/**
 * 皇冠推荐若只有「可选 / 无需」，这行没有信息量，攻略页直接不显示
 * （只作用于旧版文本行；v2 结构化数据里出现皇冠行即视为有意为之，不丢）
 * @param {object} row - 已归一的表格行 { label, items }
 * @returns {boolean}
 */
function isOptionalCrown (row) {
  if (!/皇冠/.test(plainText(row?.label || ''))) return false
  const value = (row.items || []).map(item => plainText(item.text)).join('')
  if (!value) return false
  return !/(必须|建议)/.test(value) && /(可选|无需|不需要)/.test(value)
}
/** 段落标题 → 序号徽标 + 标题文字（「1. 武器推荐」→ 「1」+「武器推荐」） */
function splitTitle (title) {
  const m = String(title || '').match(/^\s*(\d+)\s*[.、．]\s*(.+)$/)
  return m ? { badge: m[1], title: m[2].trim() } : { badge: '', title: String(title || '').trim() }
}

/**
 * 排名序列拆条：按顶层的「>」「≥」切分（跳过括号内部，避免拆散「空之杯(冰伤 > 攻击)」），
 * 同时保留原始分隔符，模板据此渲染成「条目 › 条目」的档位序列
 * @param {string} text
 * @returns {{items: string[], seps: string[]}} seps 比 items 少一项
 */
function splitRank (text) {
  const items = []
  const seps = []
  let depth = 0
  let buf = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if ('(（[【'.includes(ch)) depth += 1
    else if (')）]】'.includes(ch)) depth = Math.max(0, depth - 1)
    if (depth === 0) {
      const cut = [' > ', ' ≥ '].find(sep => text.startsWith(sep, i))
      if (cut) {
        if (buf.trim()) items.push(buf.trim())
        seps.push(cut.trim())
        buf = ''
        i += cut.length - 1
        continue
      }
    }
    buf += ch
  }
  if (buf.trim()) items.push(buf.trim())
  return { items, seps }
}

/** 去空后的行数组 */
function cleanLines (lines) {
  return (Array.isArray(lines) ? lines : [])
    .map(line => String(line ?? '').trim())
    .filter(Boolean)
}

/** 档位条目（结构化与文本行共用形状；note 为备注/皇冠等级，ref 供图标解析） */
function rankItem (item, sepAfter = '', ref = '') {
  if (item === null || item === undefined) return { text: '', note: '', ref: String(ref || ''), sepAfter }
  if (typeof item !== 'object') {
    // 纯文本条目走一遍共享显示归一（`A / B` → `A/B`、简写展开），与网页版同一套写法
    return { text: displayItemText(decorateValue(stripMarks(item))), note: '', ref: String(ref || ''), sepAfter }
  }
  const name = inlineLabel(item.name ?? item.text ?? '')
  const note = String(item.note ?? '').trim()
    ? inlineLabel(item.note)
    : String(item.level ?? '').trim() ? levelHtml(item.level) : ''
  // 天赋等级（v2.talents.priority 的 order[].level，1..10）：渲染成图标/字母下方的小数字
  const lv = Number(item.talentLevel)
  const out = { text: name, note, ref: String(item.ref || ref || ''), sepAfter }
  if (Number.isInteger(lv) && lv >= 1 && lv <= 10) out.talentLevel = lv
  if (item.crown === true || lv === 10) out.crown = true
  if (item.slot) out.slot = String(item.slot)
  return out
}

/** 一行是否有实际内容（档位条目全部为空则整行不画） */
function rowHasContent (row) {
  return (row?.items || []).some(item => !isBlankText(item.text))
}

/**
 * 文本行 → 「标签 + 内容」行（旧版解析路径）
 * 并列内容（如「时之沙(攻击力) / 空之杯(冰伤) / 理之冠(暴击)」）各占一行，标签只在首行出现；
 * 行内再用「>」「≥」拆成档位条目
 * @param {string[]} lines
 * @returns {Array<{label: string, ref: string, items: Array}>}
 */
function linesToRows (lines) {
  const rows = []
  for (const line of cleanLines(lines)) {
    const { label, value } = splitLabel(line)
    splitTop(value, ' / ').forEach((part, i) => {
      const { items, seps } = splitRank(part)
      rows.push({
        label: i === 0 ? inlineLabel(label) : '',
        ref: '',
        items: items.map((text, idx) => ({
          text: decorateValue(text),
          note: '',
          ref: '',
          sepAfter: idx < items.length - 1 ? escapeHtml(seps[idx] || '>') : ''
        }))
      })
    })
  }
  return rows
}

/** 旧版文本行 → 已过滤的展示行（空栏位与「皇冠只有可选/无需」的行不显示） */
function textLinesToRows (lines) {
  return linesToRows(lines).filter(row => !isOptionalCrown(row) && rowHasContent(row))
}

/** 旧版文本行 → 队伍行（「首选：A + B + C」） */
function linesToTeams (lines) {
  return cleanLines(lines)
    .map(line => {
      const { label, value } = splitLabel(line)
      const members = splitTop(value, '+').map(member => inlineHtml(member)).filter(member => !isBlankText(member))
      return { tag: inlineLabel(label), members }
    })
    // 成员全为空的（待补栏位）不显示
    .filter(team => team.members.length)
}

/* ============================================================
 *  文本行 JSON 数据（旧格式，v2 缺失时回退）
 * ============================================================ */

/**
 * 归一单个段落
 * 正文三选一：lines（文本行）/ items（名称+说明）/ fields（标签+取值）
 * @param {object} section
 * @param {string} fileDir - 数据文件所在目录（相对图片按此解析）
 * @returns {object|null} 模板段落；无有效正文时返回 null
 */
function toSection (section, fileDir) {
  if (!section || typeof section !== 'object') return null
  const rawTitle = String(section.title || '').trim()
  if (!rawTitle) return null
  const { badge, title } = splitTitle(rawTitle)
  const image = section.image ? resolveImage(fileDir, section.image) : ''

  const lines = cleanLines(section.lines)
  if (lines.length) {
    const kind = sectionKind(rawTitle)

    if (kind === 'teams') {
      const teams = linesToTeams(lines)
      return teams.length ? { badge, title, type: 'teams', teams, iconRef: '', image } : null
    }

    // 空栏位（只有标签没有内容）与「皇冠只有可选/无需」的行都不显示
    const kept = textLinesToRows(lines)
    return kept.length ? { badge, title, type: kind === 'stats' ? 'stats' : 'rows', rows: kept, iconRef: '', image } : null
  }

  if (Array.isArray(section.items) && section.items.length) {
    const items = section.items
      .filter(item => item && item.name && !isBlankText(item.name))
      .map(item => ({
        name: inlineHtml(item.name),
        desc: item.desc && !isBlankText(item.desc) ? inlineHtml(item.desc) : ''
      }))
    return items.length ? { badge, title, type: 'list', items, image } : null
  }

  if (Array.isArray(section.fields) && section.fields.length) {
    const fields = section.fields
      .filter(field => field && field.label != null && !isBlankText(field.value) && !isBlankText(field.label))
      .map(field => ({
        label: inlineHtml(field.label),
        value: inlineHtml(field.value)
      }))
    return fields.length ? { badge, title, type: 'fields', fields, image } : null
  }

  return null
}

/* ============================================================
 *  v2 结构化数据（优先：每个引用都带类型前缀 ref）
 * ============================================================ */

/** 档位中文数字（tier → 第一档 / 第二档 …） */
const CN_TIER = ['', '一', '二', '三', '四', '五', '六', '七', '八']

/**
 * 套装行的默认档位名 —— **不在这里硬编码**。
 *
 * 取共享显示层的 `ARTIFACT_KIND_LABEL`（档位 kind → **来源写法**）再交给 `displayLabel` 归一，
 * 与网页版 `build-html.mjs` 走的是同一份档位词汇表；否则一旦两边各写一份，
 * 就会出现"面板显示 `首选`、网页显示 `推荐`"的两端漂移（audit-web-vs-panel 会抓到）。
 * @param {string} kind
 * @returns {string} 显示档位词（推荐 / 可选 / 过渡），认不出返回空串
 */
function artifactHead (kind) {
  const src = ARTIFACT_KIND_LABEL[kind]
  return src ? displayLabel(src) : ''
}

/** 圣遗物主词条三槽（顺序固定） */
const MAIN_SLOTS = ['时之沙', '空之杯', '理之冠']

/**
 * 槽位之间的分隔符（**仅文档 / 纯文本层用**：并列关系 → 全角竖线 `｜`；槽位内部候选值仍用 `/`）。
 * 面板 / 长图**不写字面 `｜`**：靠排版分隔（见下面 v2ArtifactRows 的 `kind: 'mainSlots'`）。
 * 常量与数据仓库 scripts/lib/schema.mjs / scripts/build-html.mjs 的同名常量保持一致。
 */
const MAIN_SLOT_SEP = '｜'

/** v2 段落 → 标题（与旧版文本行标题一致，下游按标题排序 / 挂段落图标） */
const V2_ROW_SECTIONS = [
  ['weapons', '1. 武器推荐', '武器', 'rows'],
  ['artifacts', '2. 圣遗物推荐', '圣遗物', 'rows'],
  ['talents', '3. 天赋加点', '天赋', 'rows'],
  ['panels', '4. 毕业面板参考', '面板', 'stats'],
  ['constellations', '5. 命座推荐', '命座', 'rows']
]

/** 是否走 v2 结构化字段（有 v2 对象即用；schema 仅作声明，不强制） */
function isV2 (data) {
  return !!data.v2 && typeof data.v2 === 'object' && !Array.isArray(data.v2)
}

/**
 * 档位分隔符数组
 *
 * v2 的 sep 是「逐档分隔符」按空白拼接的结果（`'/ +'` = 三件套之间先用 / 再用 +），
 * 只写一个符号时按同一符号重复（武器行的 `' > '` 配 3 个条目很常见）。
 * @param {string} sep - 数据里的 sep
 * @param {number} count - 需要的分隔符个数（= 条目数 - 1）
 * @param {string} fallback - 取不到时的默认分隔符
 * @returns {string[]}
 */
function gapSeps (sep, count, fallback) {
  if (count <= 0) return []
  const tokens = String(sep ?? '').trim().split(/\s+/).filter(Boolean)
  if (!tokens.length) return new Array(count).fill(fallback)
  // 逐档按顺序用（\`' / + '\` 配 3 条 → \`/\` 然后 \`+\`），token 不够时重复**最后一个**
  // —— 早先重复第一个会把「组合符号」和「候选分隔符」错位，
  //    导致 2+2 组合（\`A / B + C\`）被拆成 \`A / B / C\`
  const out = []
  for (let i = 0; i < count; i++) out.push(tokens[i] ?? tokens[tokens.length - 1])
  return out
}

/** 段落图标引用：取第一个带 ref 的行（v2 段落整段共用首个引用作为标题图标） */
function firstRef (rows) {
  const hit = (rows || []).find(row => row?.ref)
  return hit ? String(hit.ref) : ''
}

/** v2.weapons[] → 档位行（武器图标按 ref 的 weapon: 前缀解析，见 icons.js） */
function v2WeaponRows (rows) {
  const out = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const items = (Array.isArray(row?.items) ? row.items : [])
      .filter(item => item && String(item.name ?? item).trim())
    if (!items.length) continue
    const tier = Number(row?.tier)
    const label = String(row?.label ?? '').trim() || (tier > 0 ? `第${CN_TIER[tier] ?? tier}档` : '')
    const seps = gapSeps(row?.sep, items.length - 1, '>')
    out.push({
      label: inlineLabel(label),
      ref: String(items[0]?.ref || ''),
      items: items.map((item, i) => rankItem(item, i < items.length - 1 ? escapeHtml(seps[i] || '>') : ''))
    })
  }
  return out
}

/** v2.artifacts[] → 套装行 / 主词条三槽 / 副词条（圣遗物图标按 ref 的 artifact: 前缀解析） */
function v2ArtifactRows (rows) {
  const out = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const kind = String(row?.kind || '').trim()

    if (kind === 'main') {
      const stats = row?.stats && typeof row.stats === 'object' ? row.stats : {}
      const slots = MAIN_SLOTS.filter(slot => Array.isArray(stats[slot]) && stats[slot].some(v => String(v ?? '').trim()))
      if (slots.length) {
        // 面板/长图**不写字面 `｜`**：三个槽位靠排版分隔（模板把每个槽位渲染成独立的 chip，自动换行）。
        // 所以这里不带 sepAfter，只给 slot 名（模板用它上色/加粗）。
        out.push({
          label: '主词条',
          ref: '',
          kind: 'mainSlots',
          items: slots.map((slot, i) => {
            const values = stats[slot].map(v => String(v ?? '').trim()).filter(Boolean)
            // 主词条上的「命座/成本」括注（`空之杯：水元素伤害加成（二命）`）挂在**对应部位**的值后面
            // —— 与网页版 build-html.mjs 的 splitMainSlots 渲染一致
            const note = String(row?.note ?? '').trim()
            const noteSlot = String(row?.noteSlot ?? '').trim()
            const hit = !!note && (noteSlot ? noteSlot === slot : i === slots.length - 1) &&
              !values.some(v => /[（(]/.test(v))
            return {
              slot,
              text: `${escapeHtml(slot)}：${inlineText(values.join(' / '))}`,
              note: hit ? inlineLabel(note) : '',
              ref: '',
              sepAfter: ''
            }
          })
        })
      }
      continue
    }

    if (kind === 'sub') {
      const stats = (Array.isArray(row?.stats) ? row.stats : []).map(v => String(v ?? '').trim()).filter(Boolean)
      if (stats.length) {
        const seps = gapSeps(row?.sep, stats.length - 1, '>')
        out.push({
          label: '副词条',
          ref: '',
          items: stats.map((stat, i) => ({
            text: inlineText(stat),
            note: '',
            ref: '',
            sepAfter: i < stats.length - 1 ? escapeHtml(seps[i] || '>') : ''
          }))
        })
      }
      continue
    }

    if (kind === 'text') {
      const text = String(row?.text ?? '').trim()
      if (!text) continue
      out.push({ label: inlineLabel(row.label || ''), ref: '', items: [rankItem(text)] })
      continue
    }

    // preferred / transition / optional（以及未标 kind 的套装行）
    const sets = (Array.isArray(row?.sets) ? row.sets : [])
      .filter(set => set && String(set.name ?? set).trim())
    if (!sets.length) {
      const text = String(row?.text ?? '').trim()
      if (text) out.push({ label: inlineLabel(row.label || ''), ref: '', items: [rankItem(text)] })
      continue
    }
    const seps = gapSeps(row?.sep, sets.length - 1, '/')
    out.push({
      label: inlineLabel(String(row?.label ?? '').trim() || artifactHead(kind)),
      ref: String(sets[0]?.ref || ''),
      // 组合归一（2+2 整体保留、同名只留一次）与网页版共用 resolveSetItems
      items: resolveArtifactSetItems(sets, seps).map((entry, i, arr) => ({
        text: inlineLabel(entry.name),
        // 套装备注（「千岩牢固（四件套）」拆出来的部分）与武器条目同一套小字渲染，不占图标位
        note: String(entry.item?.note ?? '').trim() ? inlineLabel(entry.item.note) : '',
        ref: String(entry.item?.ref || ''),
        // 同级（源文档 `/`）→ **`/`**（字面斜杠：`教官/勇者`）；优先级（`>`/`≥`）→ `＞`。
        // 与网页版同口径（见 guide-display.mjs 的 SET_LEVEL_SEP / gapSepOf）
        sepAfter: entry.sepAfter === '/' ? '/' : (entry.sepAfter ? '＞' : '')
      }))
    })
  }
  return out
}

/**
 * 套装行的显示条目：直接复用 ./display.js 的 \`resolveSetItems\`（与网页版同一份规则）。
 * @param {object[]} sets
 * @param {string[]} seps
 * @returns {Array<{name: string, sepAfter: string, item: object}>}
 */
function resolveArtifactSetItems (sets, seps) {
  try {
    return resolveSetItems(sets, seps, { sep: '' })
  } catch {
    // 兜底：规则模块出问题时退化成原样渲染，不丢内容（件数已定稿不显示，见下）
    return sets.map((item, i) => ({
      name: String(item?.name ?? item ?? '').trim(),
      sepAfter: i < sets.length - 1 ? '/' : '',
      item
    }))
  }
}

/** v2.talents[] → 优先级 / 皇冠行（天赋图标按 ref 的 talent:A/E/Q 解析） */
function v2TalentRows (rows) {
  const out = []
  const talents = Array.isArray(rows) ? rows : []
  // 天赋：**固定三格 A → E → Q**（不再按优先级排序，也不画「优先级」行）。
  // 等级取 priority.order[].level（缺省 1），皇冠由 crown:true / level===10 决定。
  const byName = new Map()
  for (const row of talents) {
    if (String(row?.kind || '').trim() !== 'priority') continue
    for (const item of Array.isArray(row?.order) ? row.order : []) {
      const name = String(item?.name ?? item ?? '').trim().toUpperCase()
      if (!/^[AEQ]$/.test(name)) continue
      const lv = Number(item?.level)
      const level = Number.isInteger(lv) && lv >= 1 && lv <= 10 ? lv : 1
      byName.set(name, {
        name,
        level,
        crown: item?.crown === true || level === 10,
        // 等级要单独传给渲染层（图标下方小数字），不塞进 text
        talentLevel: level,
        ref: String(item?.ref || `talent:${name}`)
      })
    }
  }
  if (byName.size) {
    out.push({
      // 行首标签用**显示词汇** `推荐`（与武器 / 圣遗物行一致；文档里仍写 `天赋：…`，网页版同口径）
      label: '推荐',
      kind: 'talents',
      ref: String((byName.get('A') || byName.values().next().value || {}).ref || ''),
      items: ['A', 'E', 'Q'].map(name => {
        const hit = byName.get(name) || { name, level: 1, crown: false, talentLevel: 1, ref: `talent:${name}` }
        return rankItem(hit, '')
      })
    })
  }
  for (const row of talents) {
    const kind = String(row?.kind || '').trim()
    if (kind === 'priority' || kind === 'crown') continue
    const text = String(row?.text ?? '').trim()
    if (text) out.push({ label: inlineLabel(row.label || ''), ref: '', items: [rankItem(text)] })
  }
  return out
}

/** v2.panels[] → 毕业面板行
 *  · 键值对（`k` 非空）→ **label 留空、把 `k：v` 放进 item** —— 这样面板模块的
 *    `normalizePanelRows` 才能把同组 ≤3 条合并成一行（`暴击率：70%+　暴击伤害：220%+`）；
 *  · 说明行（只有 `text`）→ label 就是标签，值按 `/` 拆条。 */
function v2PanelRows (rows) {
  const out = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = String(row?.k ?? '').trim()
    if (key) {
      const value = String(row?.v ?? '').trim()
      if (value) out.push({ label: '', ref: '', items: [rankItem(`${key}：${value}`)] })
      continue
    }
    const text = String(row?.text ?? '').trim()
    if (!text) continue
    const parts = splitTop(text, ' / ')
    out.push({
      label: inlineLabel(row.label || ''),
      ref: '',
      // `/` 只是拆分的依据，**不画字面分隔符**（用户反馈：chip 之间不该有残留的 `/`）
      items: parts.map(part => rankItem(part, ''))
    })
  }
  return out
}

/** v2.constellations[] → 命座行（index 供命座图标解析；无说明时整行就是命座名） */
function v2ConstellationRows (rows) {
  const out = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const name = String(row?.name ?? '').trim()
    const text = String(row?.text ?? '').trim()
    if (!name && !text) continue
    const index = Number(row?.index)
    const ref = Number.isInteger(index) && index > 0 ? `constellation:${index}` : ''
    if (text) out.push({ label: inlineLabel(name), ref, items: [rankItem(text, '', ref)] })
    else out.push({ label: '', ref, items: [rankItem(name, '', ref)] })
  }
  return out
}

/** v2.teams[] → 队伍行（成员只留 {name, note, ref}，头像在 icons.js 里按 ref 解析） */
function v2TeamRows (rows) {
  const out = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const label = String(row?.label ?? '').trim()
    const text = String(row?.text ?? '').trim()
    const toMember = (member) => ({
      name: inlineLabel(member?.name ?? member ?? ''),
      // 括注拆出来的备注（「纳西妲（二命）」→ note「二命」）：随成员带下去，模板按小字渲染
      note: String(member?.note ?? '').trim() ? inlineLabel(member.note) : '',
      plain: '',
      ref: String(member?.ref || ''),
      icon: ''
    })
    // `+` 连接的是并列成员；成员名里的 `/` 是**同一格的可替换项**（二选一）——
    // 用户要求：并进**同一个成员格**、格内保留 ` / `（如 `[迪奥娜 / 阿罗夏]`），不加任何中文标注
    const members = []
    const list = Array.isArray(row?.members) ? row.members : []
    for (const raw of list) {
      const name = inlineLabel(String(raw?.name ?? raw ?? '').replace(/\s*[/／]\s*/g, ' / ').trim())
      if (!name) continue
      members.push(toMember({ ...(raw && typeof raw === 'object' ? raw : {}), name }))
    }
    const kept = members.filter(m => m.name && !isBlankText(m.name))
    // members 为空但写了说明（如「其他：自由选择」）时保留说明，模板按备注渲染
    if (!kept.length && !text) continue
    out.push({ tag: inlineLabel(label), members: kept, options: [], text: text ? inlineLabel(text) : '' })
  }
  return out
}

/** v2 字段 → 行构造器 */
const V2_ROW_BUILDERS = {
  weapons: v2WeaponRows,
  artifacts: v2ArtifactRows,
  talents: v2TalentRows,
  panels: v2PanelRows,
  constellations: v2ConstellationRows
}

/**
 * v2 结构化字段 → 段落数组
 *
 * 逐段构造；某段在 v2 里没有内容时回退到同标题的旧版文本行（data.sections），
 * 因此「部分角色已结构化、部分还没」的过渡期不会出现整段丢失。
 * @param {object} data - 角色攻略 JSON（已确认带 v2）
 * @param {string} fileDir - 数据文件所在目录
 * @returns {Array} 段落数组；v2 完全没产出内容时返回空数组（交由调用方回退）
 */
function buildV2Sections (data, fileDir) {
  const v2 = data.v2 || {}
  const unparsed = data.unparsed && typeof data.unparsed === 'object' ? data.unparsed : {}

  /** v2 该段为空时的兜底：同标题的旧版文本行段落 */
  const fallback = keyword => {
    const src = (Array.isArray(data.sections) ? data.sections : [])
      .find(section => String(section?.title || '').includes(keyword))
    return src ? toSection(src, fileDir) : null
  }
  /** 未结构化的补充文本行（unparsed）：按标题关键词取 */
  const extraLines = keyword => {
    for (const [key, lines] of Object.entries(unparsed)) {
      if (String(key).includes(keyword)) return cleanLines(lines)
    }
    return []
  }

  const parts = []
  /** 构造「标签 + 内容 / 数值」段落；v2 无内容则回退文本行段落，再不行标空（模块显示「暂无」） */
  const addRows = (keyword, renderType, rows) => {
    const lines = extraLines(keyword)
    const kept = (rows || []).filter(rowHasContent).concat(lines.length ? textLinesToRows(lines) : [])
    if (kept.length) {
      parts.push({ keyword, parsed: { type: renderType, rows: kept, iconRef: firstRef(kept), image: '' } })
      return
    }
    const fb = fallback(keyword)
    parts.push(fb ? { keyword, parsed: fb } : { keyword, parsed: null })
  }

  for (const [key, , keyword, type] of V2_ROW_SECTIONS) {
    addRows(keyword, type, V2_ROW_BUILDERS[key](v2[key]))
  }

  // 配队：成员是对象数组，与「标签 + 内容」行不同形，单独处理
  const teamLines = extraLines('配队')
  const teams = v2TeamRows(v2.teams).concat(teamLines.length ? linesToTeams(teamLines) : [])
  if (teams.some(team => (team.members || []).length || team.text)) {
    parts.push({ keyword: '配队', parsed: { type: 'teams', teams, iconRef: '', image: '' } })
  } else {
    const fb = fallback('配队')
    parts.push(fb ? { keyword: '配队', parsed: fb } : { keyword: '配队', parsed: null })
  }

  const out = []
  const covered = V2_ROW_SECTIONS.map(([, , keyword]) => keyword).concat('配队')
  /** 模块在显示顺序里的位置（与网页版 DISPLAY_SECTIONS 同一套：武器→圣遗物→天赋→命座→面板→配队） */
  const displayAt = keyword => DISPLAY_SECTIONS.findIndex(d => d.title === keyword)
  for (const part of parts) {
    const parsed = part.parsed
    const idx = displayAt(part.keyword)
    const base = parsed ? { ...parsed } : { rows: [], teams: [] }
    out.push({ ...base, badge: String(idx + 1), title: part.keyword, __order: idx })
  }

  // v2 没覆盖到的段落（仓库以后新加的段）照样按旧版文本行渲染，避免结构化改造吃掉新内容
  for (const section of Array.isArray(data.sections) ? data.sections : []) {
    const title = String(section?.title || '')
    if (covered.some(keyword => title.includes(keyword))) continue
    const parsed = toSection(section, fileDir)
    if (!parsed) continue
    if (out.some(item => item.title === parsed.title)) continue
    out.push({ ...parsed, __order: 100 })
  }

  // ---- 纯显示级归一（与网页版 build-html.mjs 同一份规则，见 ./display.js）----
  // 标题简称、档位标签（推荐/可选/过渡）、副词条 ＞、简写展开、皇冠并入天赋、
  // 命座「命之座X」、配队括注移行尾「注：」全部在这里做；JSON 原文一个字都不改。
  const displayed = normalizeGuideSections(out)
  displayed.sort((a, b) => (a.__order ?? 100) - (b.__order ?? 100))
  return displayed.map(section => {
    const { __order, ...rest } = section
    return rest
  })
}

/* ============================================================
 *  JSON 数据入口
 * ============================================================ */

/** 标签既接受字符串，也接受 { text, style }；v2 的 meta 作为 tags 缺失时的兜底 */
function normalizeTags (data) {
  const raw = Array.isArray(data.tags) && data.tags.length ? data.tags : Object.entries(data.meta || {}).map(([key, value]) => `${key}：${value}`)
  return raw
    .map(tag => (typeof tag === 'string' ? tag : tag?.text))
    .map(tag => stripMarks(String(tag || '')).trim())
    // 「建议等级：」这类只有标签没有值的、以及 ___ 占位的一律不显示
    .filter(tag => tag && !tag.includes('___') && !/：\s*$/.test(tag))
}

/**
 * 解析一个角色攻略 JSON
 * @param {object} data - 文件内容
 * @param {object} [meta] - { fileDir, fileName } 文件所在目录与文件名（缺 name 字段时用文件名兜底）
 * @returns {object|null} { name, tags, desc, sections, docTitle }；非攻略 JSON 返回 null
 */
export function parseGuideJson (data, meta = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null

  const name = String(data.name || meta.fileName || '').trim()
  if (!name) return null

  const tags = normalizeTags(data)

  // v2 优先：结构化字段产出段落就用它；没有 v2 / v2 为空则逐字回退旧版文本行解析
  const structured = isV2(data) ? buildV2Sections(data, meta.fileDir) : []
  const sections = structured.length
    ? structured
    : (Array.isArray(data.sections) ? data.sections : [])
      .map(section => toSection(section, meta.fileDir))
      .filter(Boolean)

  return {
    name,
    tags,
    desc: data.highlight && !isBlankText(data.highlight) ? inlineHtml(data.highlight) : '',
    sections,
    docTitle: String(data.source?.guide || '').trim()
  }
}

/* ============================================================
 *  HTML 页面（旧格式，兼容尚未更新数据的克隆）
 * ============================================================ */

/**
 * 解码常见 HTML 实体（仅用于名称、标题、标签等纯文本字段）
 * @param {string} text
 * @returns {string}
 */
function decodeEntities (text) {
  return String(text || '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (raw, code) => {
    if (code[0] === '#') {
      const hex = code[1] === 'x' || code[1] === 'X'
      const num = parseInt(hex ? code.slice(2) : code.slice(1), hex ? 16 : 10)
      if (!Number.isFinite(num) || num <= 0 || num > 0x10ffff) return raw
      try {
        return String.fromCodePoint(num)
      } catch {
        return raw
      }
    }
    const key = code.toLowerCase()
    return key in ENTITY_MAP ? ENTITY_MAP[key] : raw
  })
}

/**
 * 归一空白：源码以 <br> 换行，行首缩进与换行一并去掉
 * @param {string} text
 * @returns {string}
 */
function compact (text) {
  return String(text || '')
    .replace(/\s*\n\s*/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/**
 * 剥除全部标签并解码实体（用于标题、标签等纯文本字段）
 * @param {string} html
 * @returns {string}
 */
function plainText (html) {
  return compact(decodeEntities(String(html || '').replace(/<[^>]*>/g, '')))
}

/**
 * 内联 HTML 清洗：放行 br / span.must / span.highlight / img，其余标签与属性剥除
 * @param {string} html - 段正文或高亮行
 * @param {string} fileDir - 攻略文件所在目录
 * @returns {string}
 */
export function sanitizeInline (html, fileDir) {
  let out = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')

  // 图片：仅保留仓库内真实存在的文件
  out = out.replace(/<img\b[^>]*\/?>/gi, (tag) => {
    const url = resolveImage(fileDir, decodeEntities(attrOf(tag, 'src')))
    if (!url) return ''
    const alt = decodeEntities(attrOf(tag, 'alt'))
    return `<img class="codex-img" src="${url}"${alt ? ` alt="${escapeAttr(alt)}"` : ''}/>`
  })

  // 行内强调：must / highlight 保留类名，其余 span 只去壳（嵌套残留由末尾白名单兜底）
  out = out.replace(/<span\b[^>]*>([\s\S]*?)<\/span>/gi, (tag, inner) => {
    const keep = attrOf(tag, 'class').split(/\s+/).find(c => ALLOWED_SPAN_CLASS.has(c))
    return keep ? `<span class="${keep}">${inner}</span>` : inner
  })

  out = out.replace(/<br\b[^>]*\/?>/gi, '<br/>')

  // 白名单过滤：清洗后只应存在下列标签，其余一律丢弃（模板用 {{@}} 注入，必须收敛）
  const allowed = /^(?:<br\/>|<\/span>|<span class="(?:must|highlight)">|<img class="codex-img" src="[^"]*"(?: alt="[^"]*")?\/>)$/
  out = out.split(/(<[^>]*>)/).map(part => {
    if (!/^<[^>]*>$/.test(part)) return part
    return allowed.test(part) ? part : ''
  }).join('')

  return compact(out)
}

/**
 * 旧格式 HTML 正文 → 纯文本行（`<br/>` 分行；must/highlight 还原成 **…** / ==…==，实体解码）
 * 旧克隆也走同一套「结构化数组」管线，不把长文本直接丢给模板
 * @param {string} html
 * @param {string} fileDir - 攻略文件所在目录（相对图片按此解析）
 * @returns {string[]}
 */
function htmlToLines (html, fileDir) {
  return sanitizeInline(html, fileDir)
    .split(/<br\/>/i)
    .map(line => line
      .replace(/<span class="must">([\s\S]*?)<\/span>/g, '**$1**')
      .replace(/<span class="highlight">([\s\S]*?)<\/span>/g, '==$1==')
      .replace(/<[^>]*>/g, ''))
    .map(line => decodeEntities(line).trim())
    .filter(Boolean)
}

/**
 * 解析一个攻略 HTML 页面为角色卡片数组（旧格式：每角色一张 .guide-card）
 * @param {string} html - 文件文本
 * @param {string} filePath - 文件绝对路径
 * @returns {{docTitle: string, cards: Array}}
 */
export function parseGuideHtml (html, filePath) {
  const text = String(html || '')
  const fileDir = path.dirname(filePath)
  const docTitle = plainText((text.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '')

  const starts = []
  const startRe = /<div\b[^>]*\bclass\s*=\s*"[^"]*\bguide-card\b[^"]*"[^>]*>/gi
  let m
  while ((m = startRe.exec(text)) !== null) {
    starts.push({ tagStart: m.index, bodyStart: m.index + m[0].length, tag: m[0] })
  }

  const cards = []
  for (let i = 0; i < starts.length; i++) {
    const chunk = text.slice(starts[i].bodyStart, i + 1 < starts.length ? starts[i + 1].tagStart : text.length)

    const name = plainText(attrOf(starts[i].tag, 'data-name'))
    if (!name) continue

    const tags = [...chunk.matchAll(/<span\b[^>]*\bclass\s*=\s*"[^"]*\btag\b[^"]*"[^>]*>([\s\S]*?)<\/span>/gi)]
      .map(t => plainText(t[1]))
      .filter(Boolean)

    const highlight = chunk.match(/<div\b[^>]*\bclass\s*=\s*"[^"]*\btext-block\b[^"]*"[^>]*\bstyle\s*=\s*"[^"]*"[^>]*>([\s\S]*?)<\/div>/i)

    // 旧格式正文同样走结构化管线：先还原成纯文本行，再按标题分行分档
    const sections = []
    const sectionRe = /<div\b[^>]*\bclass\s*=\s*"[^"]*\bsection-title\b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div\b[^>]*\bclass\s*=\s*"[^"]*\btext-block\b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi
    for (const s of chunk.matchAll(sectionRe)) {
      const title = plainText(s[1])
      const section = toSection({ title: plainText(s[1]), lines: htmlToLines(s[2], fileDir) }, fileDir)
      if (section) sections.push(section)
    }

    const highlightLines = highlight ? htmlToLines(highlight[1], fileDir) : []
    cards.push({
      name,
      tags,
      desc: highlightLines.length ? inlineHtml(highlightLines.join(' ')) : '',
      sections
    })
  }

  return { docTitle, cards }
}
