/**
 * 角色攻略 HTML 解析（Character-Codex-Data）
 *
 * 攻略仓库以人工维护的 HTML 页面发布，结构为「每个角色一张 .guide-card 卡片」：
 *   标签行（.tag）→ 可选高亮行（带 style 的 .text-block）→ 若干段（.section-title 紧跟 .text-block）
 * 本模块把该结构归一为模板可消费的数据，并在交给模板 {{@}} 注入前做最小化清洗：
 *   - 正文只放行 br / span.must / span.highlight / img 四类标签，其余标签与属性一律剥除
 *   - img 的 src 解析为仓库内文件的 file:// 绝对路径；站外地址与不存在的文件直接丢弃（运行期不联网）
 *
 * 输入：单个攻略 HTML 文件的文本 + 该文件绝对路径（相对路径图片按文件所在目录解析）
 * 输出：{ docTitle, cards: [{ name, tags, desc, sections }] }
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** 正文中允许保留的内联类名（样式见 resources/common/codex.css） */
const ALLOWED_SPAN_CLASS = new Set(['must', 'highlight'])

/** 纯文本字段需要解码的 HTML 实体 */
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

/** 取出标签属性值（兼容单/双引号），返回首个非空捕获 */
function attrOf (tag, name) {
  const m = String(tag).match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'))
  if (!m) return ''
  return m[1] ?? m[2] ?? ''
}

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

/** 属性值转义（用于本模块自行写出的 alt） */
function escapeAttr (text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 攻略仓库内的相对图片路径 → file:// 绝对路径
 * 只接受仓库内存在的相对路径；站外地址（http/https/data）、带协议或盘符的路径、越界路径与缺失文件返回空串
 * @param {string} fileDir - 攻略文件所在目录的绝对路径
 * @param {string} src - 源码中的 src
 * @returns {string} file:// URL；不可用时为空串
 */
function resolveImage (fileDir, src) {
  const raw = decodeEntities(src).trim()
  if (!raw) return ''
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
    const url = resolveImage(fileDir, attrOf(tag, 'src'))
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
 * 解析一个攻略 HTML 文件为角色卡片数组
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
