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
check('来源去重且按出现顺序', buildCredit(['alioth', 'gensri', 'alioth']) === 'alioth.wiki · gensri.wiki', buildCredit(['alioth', 'gensri', 'alioth']))
check('单源用带域名的全名', buildCredit(['alioth']) === '玉璃 alioth.wiki', buildCredit(['alioth']))
check('多源并列用短名（一行放得下）', buildCredit(['nanoka', 'alioth']) === 'nanoka.cc · alioth.wiki', buildCredit(['nanoka', 'alioth']))
check('缺来源时回落四源短名', buildCredit([]) === 'nanoka.cc · alioth.wiki · lunaris.moe · gensri.wiki', buildCredit([]))

const heroCss = fs.readFileSync(path.join(pluginRoot, 'resources/common/hero.css'), 'utf8')
check('hero.css 有版本徽标样式', /\.hero-version\s*\{/.test(heroCss))
// 徽标与立绘/遮罩同为绝对定位且排在它们之前，没有 z-index 就会被压住（只剩缝隙里的半截字）
check('版本徽标压在立绘与遮罩之上', /\.hero-version\s*\{[^}]*z-index:\s*\d+/.test(heroCss))

const componentsCss = fs.readFileSync(path.join(pluginRoot, 'resources/common/components.css'), 'utf8')
check('页脚版本号用高亮色（深金棕）', /\.copyright \.version\s*\{[^}]*#8a6b2f/.test(componentsCss))

// 玉璃正文高亮：只有 rich() 产标签，模板对正文用 {{@…}}，样式在 detail.css
const { rich } = await import(mod('components/challenge/view.js'))
check('rich 保留 <color> 为 .hl', rich('A<color style="color:var(--alioth-highlight-color)">B</color>C', 200, { highlight: true }).includes('<span class="hl">B</span>'),
  rich('A<color style="color:var(--alioth-highlight-color)">B</color>C', 200, { highlight: true }))
// 玉璃的官方解析文案用 `@高亮#` 标记（Buff 才用 <color>），两套都得转成 .hl，且不残留标记字符
const atMarked = rich('受到@雷元素攻击#时，扣除 @0.1%# / 每单位 @0.25%#', 200, { highlight: true })
check('rich 把 @高亮# 也转成 .hl',
  atMarked.includes('<span class="hl">雷元素攻击</span>') && atMarked.includes('<span class="hl">0.1%</span>') && !atMarked.includes('@') && !atMarked.includes('#'),
  atMarked)
check('rich 默认不解析 <color>', !rich('A<color=#FFD780>B</color>C').includes('hl'), rich('A<color=#FFD780>B</color>C'))
check('rich 剥标签但转义残留尖括号与 &', !rich('<b>x</b> & y').includes('<b>') && rich('HP<50% & 冰').includes('&lt;50%') && rich('a & b').includes('&amp;'),
  `${rich('<b>x</b> & y')} / ${rich('HP<50% & 冰')}`)
const detailCss = fs.readFileSync(path.join(pluginRoot, 'resources/common/detail.css'), 'utf8')
check('detail.css 有 .hl 高亮样式', /\.hl\s*\{[^}]*#8a6b2f/.test(detailCss))
const challengeTpl = fs.readFileSync(path.join(pluginRoot, 'resources/atlas/challenge.html'), 'utf8')
check('challenge 正文槽位按 HTML 渲染', /\{\{@text\}\}/.test(challengeTpl) && /\{\{@card\.lead\}\}/.test(challengeTpl) && /\{\{@field\.value\}\}/.test(challengeTpl))
check('challenge 怪物名等仍是转义槽位', /\{\{monster\.name\}\}/.test(challengeTpl) && /\{\{card\.title\}\}/.test(challengeTpl))
const { buildCopyright, pluginVersion, yunzaiVersion, hesperidesVersion } = await import(mod('components/pluginVersion.js'))
const copyright = buildCopyright()
check('版权行带三处版本号',
  copyright.includes('Atlas-Plugin') && (!pluginVersion || copyright.includes(pluginVersion)) && (!yunzaiVersion || copyright.includes(yunzaiVersion)) && (!hesperidesVersion || copyright.includes(hesperidesVersion)),
  copyright)

finish()
