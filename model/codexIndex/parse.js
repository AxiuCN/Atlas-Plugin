/**
 * 角色攻略数据解析（Character-Codex-Data）
 *
 * 攻略仓库当前以 JSON 发布：data/<gameId>/<角色名>.json，字段规范见该仓库 README。
 * 本模块负责把 JSON 归一为模板可消费的卡片结构，并把行内强调约定转成 HTML：
 *   - `**文字**` → <span class="must">，`==文字==` → <span class="highlight">
 *   - 正文是纯文本，标签由本模块生成（不信任数据里的 HTML）
 *   - 段落配图 image 为仓库内相对路径，解析为 file:// 绝对路径；站外地址与缺失文件丢弃（运行期不联网）
 *
 * 同时保留旧版 HTML 页面的解析（parseGuideHtml），供尚未拉取到 JSON 数据的旧克隆兜底；
 * 仓库里一旦存在 JSON 数据，索引层就只认 JSON（见 index.js）。
 *
 * 输入：JSON 对象（+ 文件路径）/ HTML 文本（+ 文件路径）
 * 输出：{ name, tags, desc, sections } 卡片结构
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

/**
 * 行数组 → 模板用的正文片段
 * @param {Array} lines
 * @returns {string} 以 <br/> 连接的 HTML
 */
function linesToHtml (lines) {
  return lines
    .map(line => inlineHtml(line).trim())
    .filter(Boolean)
    .join('<br/>')
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
  const title = String(section.title || '').trim()
  if (!title) return null

  if (Array.isArray(section.lines) && section.lines.length) {
    const text = linesToHtml(section.lines)
    if (!text) return null
    const image = section.image ? resolveImage(fileDir, section.image) : ''
    return { title, type: 'text', text: image ? `${text}<img class="codex-img" src="${image}"/>` : text }
  }

  if (Array.isArray(section.items) && section.items.length) {
    const items = section.items
      .filter(item => item && item.name)
      .map(item => ({
        name: inlineHtml(item.name),
        desc: item.desc ? inlineHtml(item.desc) : ''
      }))
    return items.length ? { title, type: 'list', items } : null
  }

  if (Array.isArray(section.fields) && section.fields.length) {
    const fields = section.fields
      .filter(field => field && field.label != null)
      .map(field => ({
        label: inlineHtml(field.label),
        value: inlineHtml(field.value)
      }))
    return fields.length ? { title, type: 'fields', fields } : null
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
    .filter(Boolean)

  const sections = (Array.isArray(data.sections) ? data.sections : [])
    .map(section => toSection(section, meta.fileDir))
    .filter(Boolean)

  return {
    name,
    tags,
    desc: data.highlight ? inlineHtml(data.highlight) : '',
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
 * 解析一个攻略 HTML 页面为角色卡片数组
 *
 * 卡片内部只有文本与 <br>，段落由 .section-title + .text-block 成对出现，
 * 故按卡片开标签切块后用成对正则提取，不引入 DOM 依赖。
 * @param {string} html - 文件文本
 * @param {string} filePath - 文件绝对路径
 * @returns {{docTitle: string, cards: Array<{name: string, tags: string[], desc: string,
 *   sections: Array<{title: string, type: string, text: string}>}>}}
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

    const sections = []
    const sectionRe = /<div\b[^>]*\bclass\s*=\s*"[^"]*\bsection-title\b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div\b[^>]*\bclass\s*=\s*"[^"]*\btext-block\b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi
    for (const s of chunk.matchAll(sectionRe)) {
      const title = plainText(s[1])
      const body = sanitizeInline(s[2], fileDir)
      if (title && body) sections.push({ title, type: 'text', text: body })
    }

    cards.push({ name, tags, desc: highlight ? sanitizeInline(highlight[1], fileDir) : '', sections })
  }

  return { docTitle, cards }
}
