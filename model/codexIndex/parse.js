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
 * 同时保留旧版 HTML 页面的解析（parseGuideHtml），供尚未拉取到 JSON 数据的旧克隆兜底；
 * 仓库里一旦存在 JSON 数据，索引层就只认 JSON（见 index.js）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** 正文中允许保留的内联类名（样式见 resources/common/codex.css） */
const ALLOWED_SPAN_CLASS = new Set(['must', 'highlight'])

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

/* ============================================================
 *  JSON 数据（当前格式）
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
      const teams = lines
        .map(line => {
          const { label, value } = splitLabel(line)
          const members = splitTop(value, '+').map(member => inlineHtml(member)).filter(member => !isBlankText(member))
          return { tag: inlineHtml(label), members }
        })
        // 成员全为空的（待补栏位）不显示
        .filter(team => team.members.length)
      return teams.length ? { badge, title, type: 'teams', teams, image } : null
    }

    // 并列内容（如「时之沙(攻击力) / 空之杯(冰伤) / 理之冠(暴击)」）各占一行，标签只在首行出现；
    // 行内再用「>」「≥」拆成档位条目，模板渲染成条目标签，方便扫读
    const rows = []
    for (const line of lines) {
      const { label, value } = splitLabel(line)
      splitTop(value, ' / ').forEach((part, i) => {
        const { items, seps } = splitRank(part)
        rows.push({
          label: i === 0 ? inlineHtml(label) : '',
          items: items.map((text, idx) => ({
            text: decorateValue(text),
            sepAfter: idx < items.length - 1 ? escapeHtml(seps[idx] || '>') : ''
          }))
        })
      })
    }
    // 空栏位（只有标签没有内容）与「皇冠只有可选/无需」的行都不显示
    const kept = rows.filter(row => {
      if (isOptionalCrown(row)) return false
      return (row.items || []).some(item => !isBlankText(item.text))
    })
    return kept.length ? { badge, title, type: kind === 'stats' ? 'stats' : 'rows', rows: kept, image } : null
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

  // 标签既接受字符串，也接受 { text, style }（style 供网页配色，展示只用 text）
  const tags = (Array.isArray(data.tags) ? data.tags : [])
    .map(tag => (typeof tag === 'string' ? tag : tag?.text))
    .map(tag => String(tag || '').trim())
    // 「建议等级：」这类只有标签没有值的、以及 ___ 占位的一律不显示
    .filter(tag => tag && !tag.includes('___') && !/：\s*$/.test(tag))

  const sections = (Array.isArray(data.sections) ? data.sections : [])
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
