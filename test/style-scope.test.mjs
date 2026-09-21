/**
 * 样式归属守卫：共享词汇不得被页面 CSS 重定义，页面 CSS 只能被自己的模板引用
 *
 * 起因：攻略页的 hero 小字覆盖（.hero-game / .hero-subtitle / .hero-info-item）是仓库里
 * 唯一一处「页面 CSS 定义共享词汇」的例子，加规则时无人可拦；另外历史上出现过
 * 「CSS 搬了目录、模板引用没跟」，攻略页整片样式静默失效（不报错、别的套件也不红）。
 * 本套件把这两条变成可执行边界：**零前置**（只读文件，不需要图鉴数据/浏览器/git）。
 *
 * 新增共享样式文件（如 print.css）时，把它加进 SHARED 列表，否则会被当成页面样式检查。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pluginRoot, checker } from './_helper.mjs'

const cssDir = path.join(pluginRoot, 'resources/common')
const tplDir = path.join(pluginRoot, 'resources/atlas')

/** 共享词汇所在文件：所有页面都能引用它们定义的类 */
const SHARED = ['base', 'components', 'detail', 'hero']

/**
 * 允许页面 CSS 覆盖的共享类白名单
 *
 * 唯一例外：codex.css 对 hero 小字的 3 条定向覆盖（名刺图上对比度不足，2026-09-20 定稿）。
 * 换成共享件后请连同 CONTRIBUTING「样式与组件准入」里的登记一起删掉。
 */
const OVERRIDE_ALLOW = new Set(['hero-game', 'hero-subtitle', 'hero-info-item'])

/** 去掉注释块：注释里提到的类名不算定义，也不算引用 */
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * 取一条 CSS 里「被定义」的类名
 *
 * 定义 = 选择器**最右复合**里的类：`.a .b.c` 定义 b 与 c，`.a` 只是被引用；
 * `.codex-cell-empty .empty-text` 定义 empty-text。只有这样才能把「覆盖共享词汇」
 * 与「在选择器里引用共享词汇」分开（否则 `.codex-page .hero .hero-game` 会连 `.hero` 一起算作定义）。
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
  const hit = [...mine].filter(c => sharedClasses.has(c))
  const bad = hit.filter(c => !OVERRIDE_ALLOW.has(c))
  const allowed = hit.filter(c => OVERRIDE_ALLOW.has(c))
  check(`${page}.css 未定义共享类`, bad.length === 0,
    bad.length ? `越界：${bad.join('、')}` : (allowed.length ? `白名单内：${allowed.join('、')}` : ''))
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

finish()
