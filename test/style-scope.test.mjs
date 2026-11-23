/**
 * 样式归属守卫：共享词汇不得被页面 CSS 重定义，页面 CSS 只能被自己的模板引用
 *
 * 起因：历史上出现过「CSS 搬了目录、模板引用没跟」，页面整片样式静默失效
 * （不报错、别的套件也不红）；也曾出现页面 CSS 就地覆盖共享类、无人登记的情况。
 * 本套件把这两条变成可执行边界：**零前置**（只读文件，不需要图鉴数据/浏览器/git）。
 *
 * 新增共享样式文件（如 print.css）时，把它加进 SHARED 列表，否则会被当成页面样式检查。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pluginRoot, checker, mod } from './_helper.mjs'

const cssDir = path.join(pluginRoot, 'resources/common')
const tplDir = path.join(pluginRoot, 'resources/atlas')

/** 共享词汇所在文件：所有页面都能引用它们定义的类 */
const SHARED = ['base', 'components', 'detail', 'hero']

/** 去掉注释块：注释里提到的类名不算定义，也不算引用 */
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * 取一条 CSS 里「被定义」的类名
 *
 * 定义 = 选择器**最右复合**里的类：`.a .b.c` 定义 b 与 c，`.a` 只是被引用；
 * `.outer .inner` 定义 inner。只有这样才能把「定义共享词汇」与「在选择器里引用共享词汇」分开。
 * @param {string} css
 * @returns {Set<string>}
 */
function definedClasses (css) {
  const out = new Set()
  for (const chunk of strip(css).split('}')) {
    const brace = chunk.lastIndexOf('{')
    if (brace < 0) continue
    // 丢掉 @media 之类的包裹前缀，只留紧邻 { 的那段选择器
    const prelude = chunk.slice(0, brace).split('{').pop() || ''
    for (const sel of prelude.split(',')) {
      const right = sel.trim().split(/[\s>+~]+/).filter(Boolean).pop() || ''
      for (const m of right.matchAll(/\.([a-zA-Z][\w-]*)/g)) out.add(m[1])
    }
  }
  return out
}

const readCss = (name) => fs.readFileSync(path.join(cssDir, `${name}.css`), 'utf8')

const sharedClasses = new Set()
for (const name of SHARED) for (const c of definedClasses(readCss(name))) sharedClasses.add(c)

const pages = fs.readdirSync(cssDir)
  .filter(f => f.endsWith('.css'))
  .map(f => f.replace(/\.css$/, ''))
  .filter(n => !SHARED.includes(n))
  .sort()

const templates = fs.readdirSync(tplDir).filter(f => f.endsWith('.html')).sort()
const tplSource = new Map(templates.map(t => [t, fs.readFileSync(path.join(tplDir, t), 'utf8')]))

const { check, finish } = checker()

console.log(`\n=== ① 页面 CSS 不得定义共享词汇（共享类共 ${sharedClasses.size} 个）===`)
for (const page of pages) {
  const mine = definedClasses(readCss(page))
  const bad = [...mine].filter(c => sharedClasses.has(c))
  check(`${page}.css 未定义共享类`, bad.length === 0, bad.length ? `越界：${bad.join('、')}` : '')
}

console.log('\n=== ② 页面 CSS 只被自己的模板引用（且不是孤儿）===')
for (const page of pages) {
  const re = new RegExp(`common/${page}\\.css`)
  const users = templates.filter(t => re.test(tplSource.get(t)))
  const foreign = users.filter(t => !t.startsWith(page))
  check(`${page}.css 的引用者同前缀`, users.length > 0 && foreign.length === 0,
    users.length === 0 ? '没有任何模板引用（孤儿样式）' : (foreign.length ? `被 ${foreign.join('、')} 引用` : users.join('、')))
}

console.log('\n=== ③ 模板与 CSS 引用的资源必须真实存在 ===')
const missing = []
for (const t of templates) {
  for (const m of tplSource.get(t).matchAll(/href="\{\{_res_path\}\}\/([\w/.-]+)"/g)) {
    if (!fs.existsSync(path.join(pluginRoot, 'resources', m[1]))) missing.push(`${t} → ${m[1]}`)
  }
}
for (const page of pages) {
  for (const m of strip(readCss(page)).matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
    const ref = m[1].trim()
    if (/^(data:|https?:|#)/.test(ref)) continue
    if (!fs.existsSync(path.resolve(cssDir, ref))) missing.push(`${page}.css → ${ref}`)
  }
}
check('模板 link 与 CSS url() 的目标都存在', missing.length === 0, missing.join('、'))

console.log('\n=== ④ 长文本断点（不缩字号）===')
// 缩字号方案已撤：模板里不应再出现 fit-text 接线
const fitRefs = templates.filter((t) => /fit-text|data-fit/.test(tplSource.get(t) || ''))
check('模板不再引用缩字号脚本', fitRefs.length === 0, fitRefs.join('、'))

const { splitTextSegments } = await import(mod('components/sections/character/skillParams.js'))
const longCell = splitTextSegments('每层伪秘之帷+技能伤害')
check('参数长文本在语义边界切段', longCell.length >= 3 && longCell.includes('每层') && !longCell.includes('每层伪秘之帷+技能伤害'), longCell.join('|'))
check('纯数值段不切', JSON.stringify(splitTextSegments('381.9%')) === '["381.9%"]')
check('斜杠处可断', splitTextSegments('（12%/15%/18%）').length >= 2, splitTextSegments('（12%/15%/18%）').join('|'))

console.log('\n=== ⑤ Hero 版本徽标接线 ===')
const heroTemplates = templates.filter((t) => /class="hero"/.test(tplSource.get(t) || ''))
const missingBadge = heroTemplates.filter((t) => !/\{\{if versionBadge\}\}/.test(tplSource.get(t) || ''))
check('所有 hero 模板都渲染版本徽标', heroTemplates.length > 0 && missingBadge.length === 0,
  missingBadge.length ? missingBadge.join('、') : `${heroTemplates.length} 个模板`)
// 页脚两行：第一行动态数据库（{{credit}}），第二行版本署名（{{@copyright}}）
const footerBad = templates.filter((t) => /copyright[^\n]*nanoka\.cc/.test(tplSource.get(t) || ''))
check('页脚不再写死 nanoka.cc', footerBad.length === 0, footerBad.join('、'))
const footerCredit = templates.filter((t) => /Data from \{\{credit\}\}/.test(tplSource.get(t) || ''))
check('页脚第一行用动态数据库列表', footerCredit.length >= 10, `${footerCredit.length} 个模板`)
const footerCopyright = templates.filter((t) => /\{\{@copyright\}\}/.test(tplSource.get(t) || ''))
check('页脚第二行用版本署名', footerCopyright.length >= 10, `${footerCopyright.length} 个模板`)

const { buildCredit } = await import(mod('components/sourceCredit.js'))
check('来源去重且按出现顺序', buildCredit(['alioth', 'gensri', 'alioth']) === '玉璃 alioth.wiki · 强度研究院 gensri.wiki', buildCredit(['alioth', 'gensri', 'alioth']))
check('缺来源时回落四源', buildCredit([]) === 'nanoka.cc · 玉璃 alioth.wiki · Lunaris lunaris.moe · 强度研究院 gensri.wiki', buildCredit([]))
const { buildCopyright, pluginVersion, yunzaiVersion, hesperidesVersion } = await import(mod('components/pluginVersion.js'))
const copyright = buildCopyright()
check('版权行带三处版本号',
  copyright.includes('Atlas-Plugin') && (!pluginVersion || copyright.includes(pluginVersion)) && (!yunzaiVersion || copyright.includes(yunzaiVersion)) && (!hesperidesVersion || copyright.includes(hesperidesVersion)),
  copyright)
check('hero.css 有版本徽标样式', /\.hero-version\s*\{/.test(fs.readFileSync(path.join(pluginRoot, 'resources/common/hero.css'), 'utf8')))

finish()
